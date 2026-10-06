/**
 * Order orchestration: checkout validation and the IPN → Sapo state machine.
 * Framework-independent (no Next.js imports) so it can be tested on its own.
 *
 * Storage lives in `lib/store.ts`, which is Redis when configured and an in-memory Map otherwise.
 * That module also owns the cross-instance claim this file relies on to keep two concurrent IPNs
 * from both creating a Sapo order. Sapo's own lookup in `createOrderOnce` is the second guard.
 */
import { getDiscountsEnabled, getSapoConfig, getVnpayConfig } from "./config";
import { DiscountRejected, quoteDiscount, normaliseCode, type DiscountQuote } from "./discount";
import { errorMessage, log } from "./log";
import { resolveAddress } from "./locations";
import {
  MAX_CART_LINES,
  COD_ENABLED,
  MAX_COD_TOTAL_VND,
  MAX_QUANTITY,
  formatVnd,
  isSoldOut,
  maxOrderableQuantity,
  type CartLine,
} from "./product";
import { quoteShipping, type ShippingQuote } from "./shipping";
import { getVariantIndex } from "./catalog";
import {
  createOrderOnce,
  fetchOrderDetailByRef,
  type PaymentMethod,
  type SapoOrderDetail,
  type SapoOrderInput,
  type SapoOrderRef,
} from "./sapo";
import { getOrderStore, type OrderStatus, type OrderStore, type PendingOrder, type PendingOrderLine } from "./store";
import {
  CANCELLED_RESPONSE_CODE,
  createPaymentUrl,
  createTxnRef,
  isPaymentSuccess,
  verifySignature,
  type IpnResponse,
  type VnpParams,
} from "./vnpay";

export type { OrderStatus, PendingOrder, PendingOrderLine } from "./store";
export { _resetStore } from "./store";
export type { SapoOrderRef };

// ---------------------------------------------------------------------------
// Checkout validation
// ---------------------------------------------------------------------------

export interface CheckoutInput {
  name: string;
  phone: string;
  email: string;
  /** Street line only; the three administrative levels arrive as ids and are resolved from Sapo. */
  address: string;
  provinceId: number;
  /**
   * Absent when Sapo has no district level for the chosen province — the two-tier shape Vietnam's
   * 2025 reorganisation moves to. Leaving it out is **not** a way to skip the containment check:
   * `resolveAddress` refuses a missing district whenever Sapo still has one for that province.
   */
  districtId?: number;
  wardId: number;
  /** What the browser asked for. Quantities only — every price is resolved in startCheckout. */
  lines: CartLine[];
  /**
   * A code the customer typed, or nothing. Never an amount: what it is worth is decided in
   * startCheckout, against the cart the server has just repriced. See lib/discount.ts.
   */
  discountCode?: string;
  paymentMethod: PaymentMethod;
}

export type ValidationResult = { ok: true; value: CheckoutInput } | { ok: false; errors: Record<string, string> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const VN_PHONE_RE = /^(\+84|84|0)(3|5|7|8|9)\d{8}$/;

/**
 * Reads the cart out of a request body. Variants are only checked for plausibility here; whether
 * they exist and can be bought is settled against the live catalog in startCheckout, because this
 * function is synchronous and the catalog comes from Sapo.
 */
function readCartLines(value: unknown): { lines: CartLine[] } | { error: string } {
  if (!Array.isArray(value) || value.length === 0) return { error: "Giỏ hàng đang trống" };
  if (value.length > MAX_CART_LINES) return { error: `Giỏ hàng chỉ nhận tối đa ${MAX_CART_LINES} sản phẩm` };

  const merged = new Map<number, number>();
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return { error: "Dòng giỏ hàng không hợp lệ" };
    const r = raw as Record<string, unknown>;
    const variantId = typeof r.variantId === "string" ? Number(r.variantId) : r.variantId;
    const quantity = typeof r.quantity === "string" ? Number(r.quantity) : r.quantity;
    if (typeof variantId !== "number" || !Number.isSafeInteger(variantId) || variantId <= 0)
      return { error: "Sản phẩm trong giỏ không hợp lệ" };
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1)
      return { error: `Số lượng phải là số nguyên từ 1 đến ${MAX_QUANTITY}` };
    // The same variant listed twice is a client bug, not a reason to refuse a sale: fold it.
    merged.set(variantId, (merged.get(variantId) ?? 0) + quantity);
  }

  const lines = [...merged].map(([variantId, quantity]) => ({ variantId, quantity }));
  if (lines.some((l) => l.quantity > MAX_QUANTITY))
    return { error: `Mỗi sản phẩm chỉ được từ 1 đến ${MAX_QUANTITY}` };
  return { lines };
}

/** A positive integer id as the browser sends it (JSON number or the string a `<select>` gives). */
function readId(raw: unknown): number | undefined {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0) return undefined;
  return n;
}

export function validateCheckout(body: unknown): ValidationResult {
  const errors: Record<string, string> = {};
  if (typeof body !== "object" || body === null) return { ok: false, errors: { body: "Dữ liệu gửi lên không hợp lệ" } };
  const b = body as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");

  const name = str("name");
  const phone = str("phone").replace(/[\s.-]/g, "");
  const email = str("email").toLowerCase();
  const address = str("address");

  if (name.length < 2 || name.length > 100) errors.name = "Họ tên phải từ 2 đến 100 ký tự";
  if (!VN_PHONE_RE.test(phone)) errors.phone = "Số điện thoại di động không hợp lệ";
  if (!EMAIL_RE.test(email) || email.length > 254) errors.email = "Email không hợp lệ";
  if (address.length < 5 || address.length > 255) errors.address = "Địa chỉ phải từ 5 đến 255 ký tự";

  // Only plausibility here. Whether these three actually exist, and whether the ward really sits in
  // that district, is settled against Sapo's own tables in startCheckout — this function is
  // synchronous and those tables come over the network.
  const provinceId = readId(b.provinceId);
  const districtId = readId(b.districtId);
  const wardId = readId(b.wardId);
  if (provinceId === undefined) errors.provinceId = "Hãy chọn tỉnh/thành phố";
  if (wardId === undefined) errors.wardId = "Hãy chọn phường/xã";
  // districtId is deliberately not required here. Whether it may be absent depends on Sapo's own
  // tables for that province, which this synchronous function cannot read; resolveAddress decides.

  const rawMethod = str("paymentMethod") || "vnpay";
  if (rawMethod !== "vnpay" && rawMethod !== "cod") errors.paymentMethod = "Hãy chọn cách thanh toán";
  else if (rawMethod === "cod" && !COD_ENABLED) errors.paymentMethod = "Cửa hàng hiện chỉ nhận thanh toán qua VNPAY";
  const paymentMethod = rawMethod as PaymentMethod;

  // An unreadable code is treated as no code rather than an error: the customer is mid-typing or
  // sent junk, and refusing the whole checkout over an optional field would be worse. A code that
  // is readable but wrong is refused later, loudly, by lib/discount.ts.
  const discountCode = normaliseCode(b.discountCode);

  const cart = readCartLines(b.lines);
  if ("error" in cart) errors.lines = cart.error;

  if (Object.keys(errors).length > 0 || !("lines" in cart)) {
    return { ok: false, errors: Object.keys(errors).length > 0 ? errors : { lines: "Giỏ hàng đang trống" } };
  }
  return {
    ok: true,
    value: {
      name,
      phone,
      email,
      address,
      provinceId: provinceId as number,
      districtId,
      wardId: wardId as number,
      lines: cart.lines,
      discountCode,
      paymentMethod,
    },
  };
}

// ---------------------------------------------------------------------------
// Reading order state
// ---------------------------------------------------------------------------

export async function getOrder(txnRef: string): Promise<PendingOrder | undefined> {
  return getOrderStore().get(txnRef);
}

/** Which backend holds the orders, so the result page can word a miss correctly. */
export function orderStoreKind(): "redis" | "memory" {
  return getOrderStore().kind;
}

/** Statuses the IPN must not re-apply: the outcome is already recorded. */
function isTerminal(status: OrderStatus): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}

// ---------------------------------------------------------------------------
// Checkout: validated input → pending order + VNPAY payment URL
// ---------------------------------------------------------------------------

/** A checkout the customer cannot proceed with, carrying the HTTP status the route should use. */
export class CheckoutError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

/**
 * What a started checkout hands back. VNPAY gets a URL to send the browser to; COD has no payment
 * step, so it comes back with the Sapo order it already created.
 */
export type CheckoutStarted =
  | { method: "vnpay"; txnRef: string; paymentUrl: string }
  | { method: "cod"; txnRef: string; sapoOrder: SapoOrderRef };

/** The three money lines of an order, each computed on the server. */
export interface OrderTotals {
  goodsVnd: number;
  discount?: DiscountQuote;
  shipping: ShippingQuote;
  /** goods − discount + shipping. The amount VNPAY is asked for and Sapo is told about. */
  totalVnd: number;
}

export async function startCheckout(input: CheckoutInput, ipAddr: string): Promise<CheckoutStarted> {
  // Second guard behind validateCheckout: this function is exported, and a caller that builds its
  // own input must not be able to create a COD order while COD is switched off.
  if (input.paymentMethod === "cod" && !COD_ENABLED) {
    throw new CheckoutError("Cửa hàng hiện chỉ nhận thanh toán qua VNPAY.", 409, {
      paymentMethod: "Cửa hàng hiện chỉ nhận thanh toán qua VNPAY",
    });
  }
  const sapo = getSapoConfig(); // fail fast before taking payment if Sapo is not configured
  // Only VNPAY needs a signing secret and a return URL. Demanding them for a COD order would make
  // cash-on-delivery impossible to run on a store that has not finished its VNPAY paperwork.
  const vnpay = input.paymentMethod === "vnpay" ? getVnpayConfig() : undefined;

  // Prices and stock come from the live catalog, never from the browser. Reading it here also
  // means a Sapo outage stops checkout before we take money.
  const byVariant = await getVariantIndex();

  const lines: PendingOrderLine[] = [];
  let goodsVnd = 0;
  for (const wanted of input.lines) {
    const product = byVariant.get(wanted.variantId);
    if (product === undefined) {
      // Withdrawn from Sapo, set to draft, or never existed. Either way it cannot be sold now.
      throw new CheckoutError("Một sản phẩm trong giỏ không còn bán.", 409, {
        lines: "Một sản phẩm trong giỏ không còn bán",
      });
    }
    // The size is part of what is being bought, so it is part of what the customer is told.
    const shown = product.variantLabel !== undefined ? `${product.name} (${product.variantLabel})` : product.name;
    if (isSoldOut(product)) {
      throw new CheckoutError(`${shown} đã hết hàng.`, 409, { lines: `${shown} đã hết hàng` });
    }
    const maxQty = maxOrderableQuantity(product);
    if (wanted.quantity > maxQty) {
      throw new CheckoutError(`${shown} chỉ còn ${maxQty} sản phẩm.`, 409, {
        lines: `${shown} chỉ còn ${maxQty} sản phẩm`,
      });
    }
    lines.push({
      variantId: product.variantId,
      sku: product.sku,
      productName: product.name,
      ...(product.variantLabel !== undefined ? { variantLabel: product.variantLabel } : {}),
      unitPriceVnd: product.priceVnd,
      quantity: wanted.quantity,
    });
    goodsVnd += product.priceVnd * wanted.quantity; // server-side price, never from the browser
  }

  // Where it is going. Three ids from the browser become names and codes out of Sapo's own tables,
  // and a ward that does not sit in that district is refused here rather than shipped nowhere.
  const address = await resolveAddress(input.provinceId, input.districtId, input.wardId);
  if (address === undefined) {
    throw new CheckoutError("Địa chỉ giao hàng không hợp lệ. Hãy chọn lại tỉnh/thành, quận/huyện và phường/xã.", 400, {
      wardId: "Hãy chọn lại địa chỉ",
    });
  }

  const totals = await resolveTotals(sapo, {
    goodsVnd,
    totalUnits: lines.reduce((n, l) => n + l.quantity, 0),
    provinceId: address.provinceId,
    discountCode: input.discountCode,
  });

  // The COD ceiling is tested on the **final** total, after discount and delivery, because that is
  // the sum the courier would have to collect and the sum the shop is exposed to if nobody is home.
  // Checked here rather than in the route: it depends on numbers only this function has resolved.
  if (input.paymentMethod === "cod" && totals.totalVnd > MAX_COD_TOTAL_VND) {
    throw new CheckoutError(
      `Đơn hàng trên ${formatVnd(MAX_COD_TOTAL_VND)} không áp dụng thanh toán khi nhận hàng. Vui lòng thanh toán qua VNPAY.`,
      409,
      { paymentMethod: "Đơn quá lớn để thu khi nhận hàng" },
    );
  }

  const store = getOrderStore();

  // A txnRef is a GMT+7 timestamp plus 6 random digits, so a collision needs two checkouts in the
  // same second that also drew the same digits; a handful of retries is more than enough.
  let txnRef = createTxnRef();
  for (let attempt = 0; attempt < 5 && (await store.has(txnRef)); attempt++) txnRef = createTxnRef();

  const order: PendingOrder = {
    txnRef,
    createdAt: new Date().toISOString(),
    customer: {
      name: input.name,
      phone: input.phone,
      email: input.email,
      address: input.address,
      ward: address.ward,
      wardCode: address.wardCode,
      district: address.district,
      districtCode: address.districtCode,
      province: address.province,
      provinceCode: address.provinceCode,
      provinceId: address.provinceId,
    },
    lines,
    goodsVnd: totals.goodsVnd,
    discount:
      totals.discount !== undefined
        ? { code: totals.discount.code, amountVnd: totals.discount.amountVnd, summary: totals.discount.summary }
        : undefined,
    shipping: { title: totals.shipping.title, code: totals.shipping.code, priceVnd: totals.shipping.feeVnd },
    amountVnd: totals.totalVnd,
    paymentMethod: input.paymentMethod,
    status: "pending",
  };

  // Deliberately not guarded: if the store cannot record the order we must not hand out a payment
  // URL, because the IPN would later have nothing to confirm. The route turns this into a 500.
  await store.put(order);

  log.info("checkout.created", {
    txnRef,
    method: input.paymentMethod,
    goodsVnd: totals.goodsVnd,
    discountVnd: totals.discount?.amountVnd ?? 0,
    shippingVnd: totals.shipping.feeVnd,
    amountVnd: totals.totalVnd,
    province: address.province,
    lines: lines.length,
    units: lines.reduce((n, l) => n + l.quantity, 0),
    store: store.kind,
  });

  if (input.paymentMethod === "cod") return placeCodOrder(order);

  const paymentUrl = createPaymentUrl(vnpay as NonNullable<typeof vnpay>, {
    txnRef,
    // The one amount: the same number the summary showed and the same number Sapo will be told.
    amountVnd: totals.totalVnd,
    orderInfo: `Thanh toan don hang ${txnRef}`,
    ipAddr,
  });
  return { method: "vnpay", txnRef, paymentUrl };
}

/**
 * Goods → discount → shipping → total, in that order, and the order matters.
 *
 * The discount applies to the goods, and the shipping threshold is then tested against what is
 * left: a code that drops the basket below the free-delivery line also drops the free delivery.
 * The alternative — waive delivery on the pre-discount figure — lets a customer stack a code on a
 * just-qualifying basket and get both, which is the shop paying twice for one sale.
 *
 * Exported through `quoteTotals` so the checkout page can show the same numbers without a second
 * implementation.
 */
async function resolveTotals(
  sapo: ReturnType<typeof getSapoConfig>,
  args: { goodsVnd: number; totalUnits: number; provinceId: number; discountCode?: string },
): Promise<OrderTotals> {
  let discount: DiscountQuote | undefined;
  if (args.discountCode !== undefined && !getDiscountsEnabled()) {
    // Refused, not ignored — for the same reason a rejected code is refused: charging more than the
    // page showed is the one outcome worse than saying no.
    log.info("discount.disabled", {});
    throw new CheckoutError("Hiện chưa áp dụng mã giảm giá.", 409, {
      discountCode: "Hiện chưa áp dụng mã giảm giá",
    });
  }
  if (args.discountCode !== undefined) {
    try {
      discount = await quoteDiscount(sapo, args.discountCode, {
        goodsSubtotalVnd: args.goodsVnd,
        totalUnits: args.totalUnits,
      });
    } catch (err) {
      if (err instanceof DiscountRejected) {
        // Refused, not dropped. Silently continuing without the discount would charge the customer
        // more than the page they are looking at says — the one outcome worse than a rejection.
        log.info("discount.rejected", { reason: err.reason });
        throw new CheckoutError(err.message, 409, { discountCode: err.message });
      }
      throw err;
    }
  }

  const afterDiscount = Math.max(0, args.goodsVnd - (discount?.amountVnd ?? 0));
  const shipping = quoteShipping(args.provinceId, afterDiscount);
  return { goodsVnd: args.goodsVnd, discount, shipping, totalVnd: afterDiscount + shipping.feeVnd };
}

/**
 * Price a cart without starting a checkout, for the summary on the checkout page.
 *
 * Same function the real checkout uses, so what the customer reads is what they will be charged.
 * It takes the cart as quantities and reprices from Sapo, exactly like `startCheckout`.
 */
export async function quoteTotals(args: {
  lines: CartLine[];
  provinceId?: number;
  discountCode?: string;
}): Promise<OrderTotals | undefined> {
  const sapo = getSapoConfig();
  if (args.provinceId === undefined) return undefined;
  const byVariant = await getVariantIndex();

  let goodsVnd = 0;
  let totalUnits = 0;
  for (const wanted of args.lines) {
    const product = byVariant.get(wanted.variantId);
    if (product === undefined) {
      // Refuse, exactly as checkout does. Skipping it would price the cart *lower* than checkout
      // will charge — a summary the customer reads as the total and then does not get.
      throw new CheckoutError("Một sản phẩm trong giỏ không còn bán.", 409, {
        lines: "Một sản phẩm trong giỏ không còn bán",
      });
    }
    goodsVnd += product.priceVnd * wanted.quantity;
    totalUnits += wanted.quantity;
  }
  return resolveTotals(sapo, { goodsVnd, totalUnits, provinceId: args.provinceId, discountCode: args.discountCode });
}

// ---------------------------------------------------------------------------
// COD: the second, and only other, place a Sapo order is created
// ---------------------------------------------------------------------------

/**
 * Create the Sapo order for a cash-on-delivery checkout, right now, unpaid.
 *
 * This is the second door into Sapo, and the reason security rule 2 had to be rewritten rather than
 * bent. The old rule — "only a checksum-verified IPN may create an order" — exists because for a
 * *card* payment, anything else would let an unpaid order look paid. COD has no payment to verify
 * at all, so the rule it needs is a different one, and both now stand side by side:
 *
 * - A VNPAY order is created **only** by `handleIpn`, and only ever as `financial_status: paid`.
 * - A COD order is created here, **only** as `financial_status: pending`, and never carries a
 *   transaction. Nothing on this path can mark an order paid; no amount of calling it can produce
 *   a false payment record, only an unpaid order a human will confirm by phone.
 *
 * What it can produce is junk orders, which is what the rate limit on `/api/checkout` is for.
 * `createOrderOnce` keeps a retry from doubling an order, as it does for the IPN.
 */
async function placeCodOrder(order: PendingOrder): Promise<CheckoutStarted> {
  const store = getOrderStore();
  const sapo = getSapoConfig();
  try {
    const { order: sapoOrder, created } = await createOrderOnce(sapo, toSapoInput(order));
    order.sapoOrder = sapoOrder;
    order.status = "completed";
    await store.put(order);
    log.info(created ? "cod.order_created" : "cod.order_already_existed", {
      txnRef: order.txnRef,
      sapoOrderId: sapoOrder.id,
      sapoOrderName: sapoOrder.name,
      amountVnd: order.amountVnd,
    });
    return { method: "cod", txnRef: order.txnRef, sapoOrder };
  } catch (err) {
    order.status = "sapo_error";
    order.lastError = errorMessage(err);
    const e = err as { status?: number; body?: string };
    log.error("cod.order_failed", { txnRef: order.txnRef, error: order.lastError, status: e.status, body: e.body });
    try {
      await store.put(order);
    } catch (persistErr) {
      log.error("cod.store_write_failed", { txnRef: order.txnRef, error: errorMessage(persistErr) });
    }
    // No money has moved, so the honest answer is to fail the checkout and let the customer retry.
    throw new CheckoutError("Không tạo được đơn hàng. Vui lòng thử lại.", 502);
  }
}

/**
 * The stored order, as Sapo wants it. One place, so a VNPAY order and a COD order can never
 * disagree about how a cart becomes a payload.
 */
function toSapoInput(order: PendingOrder, params?: VnpParams): SapoOrderInput {
  const c = order.customer;
  return {
    txnRef: order.txnRef,
    method: order.paymentMethod ?? "vnpay",
    vnpTransactionNo: params?.vnp_TransactionNo ?? order.vnpTransactionNo,
    vnpBankCode: params?.vnp_BankCode,
    vnpPayDate: params?.vnp_PayDate,
    customer: {
      name: c.name,
      phone: c.phone,
      email: c.email,
      address1: c.address,
      ward: c.ward,
      wardCode: c.wardCode,
      district: c.district,
      districtCode: c.districtCode,
      province: c.province,
      provinceCode: c.provinceCode,
    },
    lines: order.lines,
    shipping: order.shipping,
    discount: order.discount !== undefined ? { code: order.discount.code, amountVnd: order.discount.amountVnd } : undefined,
    totalVnd: order.amountVnd,
  };
}

// ---------------------------------------------------------------------------
// IPN: the ONLY place a Sapo order is created
// ---------------------------------------------------------------------------

/**
 * Follows the check order in the VNPAY docs:
 * checksum → order exists → amount matches → not already confirmed → apply result.
 */
export async function handleIpn(params: VnpParams): Promise<IpnResponse> {
  let hashSecret: string;
  try {
    hashSecret = getVnpayConfig().hashSecret;
  } catch (err) {
    log.error("ipn.config_error", { error: errorMessage(err) });
    return { RspCode: "99", Message: "Unknown error" };
  }

  if (!verifySignature(params, hashSecret)) {
    log.warn("ipn.invalid_signature", { txnRef: params.vnp_TxnRef });
    return { RspCode: "97", Message: "Invalid signature" };
  }
  log.info("ipn.checksum_verified", { txnRef: params.vnp_TxnRef });

  const txnRef = params.vnp_TxnRef ?? "";
  const store = getOrderStore();

  let order: PendingOrder | undefined;
  try {
    order = await store.get(txnRef);
  } catch (err) {
    // The store is unreachable, so whether this order exists is unknown. Answering 01 would tell
    // VNPAY the reference is wrong; 99 asks it to retry, which is what a transient outage needs.
    log.error("ipn.store_unavailable", { txnRef, error: errorMessage(err) });
    return { RspCode: "99", Message: "Unknown error" };
  }
  if (!order) {
    log.warn("ipn.order_not_found", { txnRef });
    return { RspCode: "01", Message: "Order not found" };
  }

  if (Number(params.vnp_Amount) !== order.amountVnd * 100) {
    log.warn("ipn.invalid_amount", { txnRef, received: params.vnp_Amount, expected: order.amountVnd * 100 });
    return { RspCode: "04", Message: "invalid amount" };
  }

  if (isTerminal(order.status)) {
    log.info("ipn.duplicate", { txnRef, status: order.status });
    return { RspCode: "02", Message: "Order already confirmed" };
  }

  // Past this point only one caller may run for this txnRef, across every instance. A claim that
  // is already held means a concurrent IPN is mid-flight: ask VNPAY to retry, and that retry will
  // see "completed" and get 02. A claim left behind by a crash expires on its own.
  let claimed: boolean;
  try {
    claimed = await store.claim(txnRef);
  } catch (err) {
    log.error("ipn.claim_failed", { txnRef, error: errorMessage(err) });
    return { RspCode: "99", Message: "Unknown error" };
  }
  if (!claimed) {
    log.info("ipn.concurrent", { txnRef });
    return { RspCode: "99", Message: "Order is being processed" };
  }

  try {
    // Re-read under the claim: another instance may have finished between the read above and the
    // claim, which makes this a duplicate rather than a retry.
    const current = (await store.get(txnRef)) ?? order;
    if (isTerminal(current.status)) {
      log.info("ipn.duplicate", { txnRef, status: current.status });
      return { RspCode: "02", Message: "Order already confirmed" };
    }
    return await applyIpnResult(store, current, params);
  } catch (err) {
    log.error("ipn.unexpected_error", { txnRef, error: errorMessage(err) });
    return { RspCode: "99", Message: "Unknown error" };
  } finally {
    try {
      await store.release(txnRef);
    } catch (err) {
      // The claim expires by itself, so a failed release only delays the next retry.
      log.warn("ipn.claim_release_failed", { txnRef, error: errorMessage(err) });
    }
  }
}

/** Applies a verified IPN to an order the caller already holds the claim for. */
async function applyIpnResult(store: OrderStore, order: PendingOrder, params: VnpParams): Promise<IpnResponse> {
  const txnRef = order.txnRef;
  order.vnpResponseCode = params.vnp_ResponseCode;
  order.vnpTransactionNo = params.vnp_TransactionNo;

  if (!isPaymentSuccess(params)) {
    order.status = params.vnp_ResponseCode === CANCELLED_RESPONSE_CODE ? "cancelled" : "failed";
    try {
      await store.put(order);
    } catch (err) {
      // Nothing was recorded, so do not claim success: 99 makes VNPAY re-send the notification.
      log.error("ipn.store_write_failed", { txnRef, status: order.status, error: errorMessage(err) });
      return { RspCode: "99", Message: "Unknown error" };
    }
    log.info("ipn.payment_not_successful", {
      txnRef,
      responseCode: params.vnp_ResponseCode,
      transactionStatus: params.vnp_TransactionStatus,
    });
    return { RspCode: "00", Message: "Confirm Success" };
  }

  order.status = "processing";
  try {
    await store.put(order);
  } catch (err) {
    // Without a recorded "processing" we would lose track of an order we are about to create in
    // Sapo. Stop here and let VNPAY retry instead.
    log.error("ipn.store_write_failed", { txnRef, status: order.status, error: errorMessage(err) });
    return { RspCode: "99", Message: "Unknown error" };
  }

  try {
    const sapo = getSapoConfig();
    // A VNPAY IPN always creates a VNPAY order, whatever the stored record says: this is the paid
    // path, and nothing reached it without a checksum-verified payment for this exact reference.
    const { order: sapoOrder, created } = await createOrderOnce(sapo, {
      ...toSapoInput(order, params),
      method: "vnpay",
    });
    order.sapoOrder = sapoOrder;
    order.status = "completed";
    order.lastError = undefined;
    await store.put(order);
    log.info(created ? "sapo.order_created" : "sapo.order_already_existed", {
      txnRef,
      sapoOrderId: sapoOrder.id,
      sapoOrderName: sapoOrder.name,
    });
    return { RspCode: "00", Message: "Confirm Success" };
  } catch (err) {
    order.status = "sapo_error";
    order.lastError = errorMessage(err);
    const e = err as { status?: number; body?: string };
    log.error("sapo.order_failed", { txnRef, error: order.lastError, status: e.status, body: e.body });
    try {
      await store.put(order);
    } catch (persistErr) {
      log.error("ipn.store_write_failed", { txnRef, status: order.status, error: errorMessage(persistErr) });
    }
    // Payment is verified but the Sapo order is not created yet: answer 99 so VNPAY
    // retries the IPN (up to 10 times, every 5 minutes per the docs), which retries Sapo.
    return { RspCode: "99", Message: "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Return URL: display only, never changes order state
// ---------------------------------------------------------------------------

export type ReturnOutcome = "success" | "cancelled" | "failed" | "invalid";

export function classifyReturn(params: VnpParams): { outcome: ReturnOutcome; txnRef?: string; code?: string } {
  let hashSecret: string;
  try {
    hashSecret = getVnpayConfig().hashSecret;
  } catch (err) {
    log.error("return.config_error", { error: errorMessage(err) });
    return { outcome: "invalid" };
  }
  if (!verifySignature(params, hashSecret)) {
    log.warn("return.invalid_signature", { txnRef: params.vnp_TxnRef });
    return { outcome: "invalid" };
  }
  const txnRef = params.vnp_TxnRef;
  const code = params.vnp_ResponseCode;
  if (isPaymentSuccess(params)) return { outcome: "success", txnRef, code };
  if (code === CANCELLED_RESPONSE_CODE) return { outcome: "cancelled", txnRef, code };
  return { outcome: "failed", txnRef, code };
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/** One policy: how many hits of this kind an IP may make, and over how long. */
export interface RatePolicy {
  limit: number;
  windowSeconds: number;
}

/**
 * Policies live here rather than in the routes, so the numbers can be read in one place and
 * compared against each other.
 *
 * `checkout` is the one that matters: with COD, a request on that route creates a real Sapo order,
 * so an unthrottled endpoint is a way to fill the shop's order list with rubbish. `discount` is
 * about guessing codes — it is also the only place where a slow Sapo lookup is triggered by an
 * anonymous caller. `lookup` protects customer data: an order reference plus a phone number is the
 * key to someone's address, so it gets the tightest window.
 */
export const RATE_POLICIES = {
  checkout: { limit: 10, windowSeconds: 600 },
  discount: { limit: 20, windowSeconds: 600 },
  lookup: { limit: 10, windowSeconds: 900 },
  /**
   * COD, per IP — tighter than `checkout` because the two paths are not symmetric: card spam costs
   * the spammer money before it costs the shop anything, while a COD request creates a real order
   * and moves real stock for free.
   */
  cod: { limit: 3, windowSeconds: 600 },
  /**
   * COD, per phone number — the axis an IP limit misses entirely, since IPs rotate and a mobile
   * network puts many real customers behind one.
   *
   * Deliberately **COD only**. Counting card checkouts here would lock out the customer whose card
   * keeps failing and who is retrying in good faith — the opposite of who this is for.
   */
  codPhone: { limit: 5, windowSeconds: 3600 },
} as const satisfies Record<string, RatePolicy>;

/**
 * Count one request and say whether it is over the line.
 *
 * `key` is whatever axis the policy limits: an IP for most, a phone number for `codPhone`. The
 * store just counts strings, so adding an axis costs a policy and a call rather than a mechanism.
 *
 * Fails **open**: a store that cannot be reached must not take checkout down with it. A rate limit
 * is a guard against nuisance, and trading away the ability to sell to keep it is the wrong trade.
 */
export async function overRateLimit(kind: keyof typeof RATE_POLICIES, key: string): Promise<boolean> {
  const policy = RATE_POLICIES[kind];
  try {
    const count = await getOrderStore().hit(`${kind}:${key}`, policy.windowSeconds);
    if (count > policy.limit) {
      log.warn("rate.limited", { kind, count, limit: policy.limit });
      return true;
    }
    return false;
  } catch (err) {
    log.warn("rate.check_failed", { kind, error: errorMessage(err) });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Customer-facing order lookup (T7.6)
// ---------------------------------------------------------------------------

export type OrderLookupResult =
  | { outcome: "found"; order: SapoOrderDetail; paymentMethod: PaymentMethod }
  | { outcome: "not_found" }
  | { outcome: "rate_limited" };

/**
 * The last 9 digits of a phone number, which is the part that identifies it: +84912345678,
 * 84912345678 and 0912345678 all reduce to the same key, so a rate limit on one form cannot be
 * sidestepped by typing another.
 */
export function phoneRateKey(phone: string): string {
  return phone.replace(/\D+/g, "").slice(-9);
}

/** Compare the last 9 digits, so +84 / 84 / 0 prefixes of the same number match. */
function samePhone(a: string, b: string): boolean {
  const tail = (s: string) => s.replace(/\D+/g, "").slice(-9);
  const x = tail(a);
  return x.length === 9 && x === tail(b);
}

/**
 * Find a customer's order from the reference and the phone number on it.
 *
 * The phone number is the whole access check, so two things are deliberate. A wrong phone answers
 * exactly like a reference that does not exist — otherwise the page becomes an oracle for which
 * references are real — and the attempt is counted against the caller's IP whether it succeeded or
 * not, so the pair cannot be brute-forced. A reference is a timestamp plus six digits, which is
 * guessable given enough tries; this is what makes "enough tries" not happen.
 */
export async function lookupOrder(txnRef: string, phone: string, ip: string): Promise<OrderLookupResult> {
  if (await overRateLimit("lookup", ip)) return { outcome: "rate_limited" };

  const ref = txnRef.trim();
  if (!/^[0-9]{6,40}$/.test(ref)) return { outcome: "not_found" };

  const detail = await fetchOrderDetailByRef(getSapoConfig(), ref);
  if (detail === null) {
    log.info("lookup.miss", { reason: "no_order" });
    return { outcome: "not_found" };
  }
  if (!samePhone(detail.phoneDigits, phone)) {
    log.info("lookup.miss", { reason: "phone_mismatch", sapoOrderId: detail.id });
    return { outcome: "not_found" };
  }

  // Which path placed it, read from the record rather than guessed from the status: a COD order
  // that has since been paid in cash is "paid" in Sapo and still was never a card payment.
  const stored = await getOrderStore()
    .get(ref)
    .catch(() => undefined);
  log.info("lookup.hit", { sapoOrderId: detail.id });
  return { outcome: "found", order: detail, paymentMethod: stored?.paymentMethod ?? "vnpay" };
}
