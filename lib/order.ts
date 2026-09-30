/**
 * Order orchestration: checkout validation and the IPN → Sapo state machine.
 * Framework-independent (no Next.js imports) so it can be tested on its own.
 *
 * Storage lives in `lib/store.ts`, which is Redis when configured and an in-memory Map otherwise.
 * That module also owns the cross-instance claim this file relies on to keep two concurrent IPNs
 * from both creating a Sapo order. Sapo's own lookup in `createOrderOnce` is the second guard.
 */
import { getSapoConfig, getVnpayConfig } from "./config";
import { errorMessage, log } from "./log";
import {
  MAX_CART_LINES,
  MAX_QUANTITY,
  isSoldOut,
  maxOrderableQuantity,
  type CartLine,
  type DisplayProduct,
} from "./product";
import { getDisplayProducts } from "./catalog";
import { createOrderOnce, type SapoOrderRef } from "./sapo";
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
  address: string;
  /** What the browser asked for. Quantities only — every price is resolved in startCheckout. */
  lines: CartLine[];
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
  if (!Array.isArray(value) || value.length === 0) return { error: "Your cart is empty" };
  if (value.length > MAX_CART_LINES) return { error: `A cart can hold at most ${MAX_CART_LINES} products` };

  const merged = new Map<number, number>();
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return { error: "Invalid cart line" };
    const r = raw as Record<string, unknown>;
    const variantId = typeof r.variantId === "string" ? Number(r.variantId) : r.variantId;
    const quantity = typeof r.quantity === "string" ? Number(r.quantity) : r.quantity;
    if (typeof variantId !== "number" || !Number.isSafeInteger(variantId) || variantId <= 0)
      return { error: "Invalid product in cart" };
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1)
      return { error: `Quantity must be a whole number from 1 to ${MAX_QUANTITY}` };
    // The same variant listed twice is a client bug, not a reason to refuse a sale: fold it.
    merged.set(variantId, (merged.get(variantId) ?? 0) + quantity);
  }

  const lines = [...merged].map(([variantId, quantity]) => ({ variantId, quantity }));
  if (lines.some((l) => l.quantity > MAX_QUANTITY))
    return { error: `Quantity must be a whole number from 1 to ${MAX_QUANTITY} per product` };
  return { lines };
}

export function validateCheckout(body: unknown): ValidationResult {
  const errors: Record<string, string> = {};
  if (typeof body !== "object" || body === null) return { ok: false, errors: { body: "Invalid JSON body" } };
  const b = body as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");

  const name = str("name");
  const phone = str("phone").replace(/[\s.-]/g, "");
  const email = str("email").toLowerCase();
  const address = str("address");

  if (name.length < 2 || name.length > 100) errors.name = "Name must be 2–100 characters";
  if (!VN_PHONE_RE.test(phone)) errors.phone = "Enter a valid Vietnamese mobile number";
  if (!EMAIL_RE.test(email) || email.length > 254) errors.email = "Enter a valid email";
  if (address.length < 5 || address.length > 255) errors.address = "Address must be 5–255 characters";

  const cart = readCartLines(b.lines);
  if ("error" in cart) errors.lines = cart.error;

  if (Object.keys(errors).length > 0 || !("lines" in cart)) {
    return { ok: false, errors: Object.keys(errors).length > 0 ? errors : { lines: "Your cart is empty" } };
  }
  return { ok: true, value: { name, phone, email, address, lines: cart.lines } };
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

export async function startCheckout(
  input: CheckoutInput,
  ipAddr: string,
): Promise<{ txnRef: string; paymentUrl: string }> {
  const vnpay = getVnpayConfig(); // throws MissingEnvError if not configured
  getSapoConfig(); // fail fast before taking payment if Sapo is not configured

  // Prices and stock come from the live catalog, never from the browser. Reading it here also
  // means a Sapo outage stops checkout before we take money.
  const catalog = await getDisplayProducts();
  const byVariant = new Map<number, DisplayProduct>();
  for (const p of catalog) if (p.variantId !== undefined) byVariant.set(p.variantId, p);

  const lines: PendingOrderLine[] = [];
  let amountVnd = 0;
  for (const wanted of input.lines) {
    const product = byVariant.get(wanted.variantId);
    if (product === undefined) {
      // Withdrawn from Sapo, set to draft, or never existed. Either way it cannot be sold now.
      throw new CheckoutError("A product in your cart is no longer available.", 409, {
        lines: "A product in your cart is no longer available",
      });
    }
    if (isSoldOut(product)) {
      throw new CheckoutError(`${product.name} is out of stock.`, 409, { lines: `${product.name} is out of stock` });
    }
    const maxQty = maxOrderableQuantity(product);
    if (wanted.quantity > maxQty) {
      throw new CheckoutError(`Only ${maxQty} of ${product.name} left in stock.`, 409, {
        lines: `Only ${maxQty} of ${product.name} left in stock`,
      });
    }
    lines.push({
      variantId: product.variantId,
      sku: product.sku,
      productName: product.name,
      unitPriceVnd: product.priceVnd,
      quantity: wanted.quantity,
    });
    amountVnd += product.priceVnd * wanted.quantity; // server-side price, never from the browser
  }

  const store = getOrderStore();

  // A txnRef is a GMT+7 timestamp plus 6 random digits, so a collision needs two checkouts in the
  // same second that also drew the same digits; a handful of retries is more than enough.
  let txnRef = createTxnRef();
  for (let attempt = 0; attempt < 5 && (await store.has(txnRef)); attempt++) txnRef = createTxnRef();

  // Deliberately not guarded: if the store cannot record the order we must not hand out a payment
  // URL, because the IPN would later have nothing to confirm. The route turns this into a 500.
  await store.put({
    txnRef,
    createdAt: new Date().toISOString(),
    customer: { name: input.name, phone: input.phone, email: input.email, address: input.address },
    lines,
    amountVnd,
    status: "pending",
  });

  const paymentUrl = createPaymentUrl(vnpay, {
    txnRef,
    amountVnd,
    orderInfo: `Thanh toan don hang ${txnRef}`,
    ipAddr,
  });
  log.info("checkout.created", {
    txnRef,
    amountVnd,
    lines: lines.length,
    units: lines.reduce((n, l) => n + l.quantity, 0),
    store: store.kind,
  });
  return { txnRef, paymentUrl };
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
    const { order: sapoOrder, created } = await createOrderOnce(sapo, {
      txnRef,
      vnpTransactionNo: params.vnp_TransactionNo ?? "",
      vnpBankCode: params.vnp_BankCode,
      vnpPayDate: params.vnp_PayDate,
      customer: order.customer,
      lines: order.lines,
      totalVnd: order.amountVnd,
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
