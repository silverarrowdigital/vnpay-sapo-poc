/**
 * Order orchestration: checkout validation, the pending-order store, and the
 * IPN → Sapo state machine. Framework-independent (no Next.js imports) so it can be
 * tested on its own.
 *
 * MVP STORAGE LIMITATION: pending orders live in an in-memory Map on globalThis.
 * This works when the checkout request and the VNPAY IPN reach the SAME Node process
 * (`next dev` / `next start` on one machine). It is NOT reliable on serverless
 * (Vercel) where requests may hit different instances, and all state is lost on restart.
 * Sapo itself is used as a second idempotency guard (see createOrderOnce), so a
 * duplicate IPN can never create a second Sapo order even across instances.
 * Replace `store` with a real database/KV before production.
 */
import { getSapoConfig, getVnpayConfig } from "./config";
import { errorMessage, log } from "./log";
import { MAX_QUANTITY, isSoldOut, maxOrderableQuantity } from "./product";
import { getDisplayProduct } from "./catalog";
import { createOrderOnce, type SapoOrderRef } from "./sapo";
import {
  CANCELLED_RESPONSE_CODE,
  createPaymentUrl,
  createTxnRef,
  isPaymentSuccess,
  verifySignature,
  type IpnResponse,
  type VnpParams,
} from "./vnpay";

// ---------------------------------------------------------------------------
// Checkout validation
// ---------------------------------------------------------------------------

export interface CheckoutInput {
  name: string;
  phone: string;
  email: string;
  address: string;
  quantity: number;
  sku: string;
}

export type ValidationResult = { ok: true; value: CheckoutInput } | { ok: false; errors: Record<string, string> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const VN_PHONE_RE = /^(\+84|84|0)(3|5|7|8|9)\d{8}$/;

export function validateCheckout(body: unknown): ValidationResult {
  const errors: Record<string, string> = {};
  if (typeof body !== "object" || body === null) return { ok: false, errors: { body: "Invalid JSON body" } };
  const b = body as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");

  const name = str("name");
  const phone = str("phone").replace(/[\s.-]/g, "");
  const email = str("email").toLowerCase();
  const address = str("address");
  const sku = str("sku");
  const quantity = typeof b.quantity === "string" ? Number(b.quantity) : (b.quantity as number);

  if (name.length < 2 || name.length > 100) errors.name = "Name must be 2–100 characters";
  if (!VN_PHONE_RE.test(phone)) errors.phone = "Enter a valid Vietnamese mobile number";
  if (!EMAIL_RE.test(email) || email.length > 254) errors.email = "Enter a valid email";
  if (address.length < 5 || address.length > 255) errors.address = "Address must be 5–255 characters";
  // The sku is matched against the live catalog in startCheckout, not here: this function is
  // synchronous and the catalog entry may come from Sapo.
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY)
    errors.quantity = `Quantity must be a whole number from 1 to ${MAX_QUANTITY}`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, phone, email, address, quantity, sku } };
}

// ---------------------------------------------------------------------------
// Pending-order store (in-memory, see limitation above)
// ---------------------------------------------------------------------------

export type OrderStatus =
  | "pending" // payment URL issued, waiting for VNPAY
  | "processing" // IPN accepted, creating Sapo order (acts as a lock)
  | "completed" // paid + Sapo order exists
  | "sapo_error" // paid, but Sapo creation failed — will retry on next IPN
  | "cancelled" // customer cancelled at VNPAY
  | "failed"; // payment failed

export interface PendingOrder {
  txnRef: string;
  createdAt: string;
  customer: { name: string; phone: string; email: string; address: string };
  sku: string;
  productName: string;
  unitPriceVnd: number;
  quantity: number;
  amountVnd: number;
  status: OrderStatus;
  vnpResponseCode?: string;
  vnpTransactionNo?: string;
  sapoOrder?: SapoOrderRef;
  lastError?: string;
}

const g = globalThis as typeof globalThis & { __vnpaySapoOrders?: Map<string, PendingOrder> };
const store: Map<string, PendingOrder> = (g.__vnpaySapoOrders ??= new Map());

const TTL_MS = 24 * 60 * 60 * 1000;
function prune() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of store) if (Date.parse(v.createdAt) < cutoff) store.delete(k);
}

export function getOrder(txnRef: string): PendingOrder | undefined {
  return store.get(txnRef);
}

/** Test helper. */
export function _resetStore() {
  store.clear();
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

  // Price and stock come from the live catalog (Sapo when SAPO_VARIANT_ID is set), never from
  // the browser. Reading it here also means a Sapo outage stops checkout before we take money.
  const product = await getDisplayProduct();

  if (input.sku !== "" && input.sku !== product.sku) {
    throw new CheckoutError("Unknown product", 400, { sku: "Unknown product" });
  }
  if (isSoldOut(product)) {
    throw new CheckoutError("This product is out of stock.", 409);
  }
  const maxQty = maxOrderableQuantity(product);
  if (input.quantity > maxQty) {
    throw new CheckoutError(`Only ${maxQty} left in stock.`, 409, {
      quantity: `Only ${maxQty} left in stock`,
    });
  }

  prune();

  let txnRef = createTxnRef();
  while (store.has(txnRef)) txnRef = createTxnRef();

  const amountVnd = product.priceVnd * input.quantity; // server-side price, never from the browser
  store.set(txnRef, {
    txnRef,
    createdAt: new Date().toISOString(),
    customer: { name: input.name, phone: input.phone, email: input.email, address: input.address },
    sku: product.sku,
    productName: product.name,
    unitPriceVnd: product.priceVnd,
    quantity: input.quantity,
    amountVnd,
    status: "pending",
  });

  const paymentUrl = createPaymentUrl(vnpay, {
    txnRef,
    amountVnd,
    orderInfo: `Thanh toan don hang ${txnRef}`,
    ipAddr,
  });
  log.info("checkout.created", { txnRef, amountVnd, quantity: input.quantity });
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
  const order = store.get(txnRef);
  if (!order) {
    log.warn("ipn.order_not_found", { txnRef });
    return { RspCode: "01", Message: "Order not found" };
  }

  if (Number(params.vnp_Amount) !== order.amountVnd * 100) {
    log.warn("ipn.invalid_amount", { txnRef, received: params.vnp_Amount, expected: order.amountVnd * 100 });
    return { RspCode: "04", Message: "invalid amount" };
  }

  if (order.status === "completed" || order.status === "cancelled" || order.status === "failed") {
    log.info("ipn.duplicate", { txnRef, status: order.status });
    return { RspCode: "02", Message: "Order already confirmed" };
  }
  if (order.status === "processing") {
    // A concurrent IPN is creating the Sapo order right now. Ask VNPAY to retry later;
    // the retry will see "completed" and get 02.
    log.info("ipn.concurrent", { txnRef });
    return { RspCode: "99", Message: "Order is being processed" };
  }

  // status is "pending" or "sapo_error" (retry)
  order.vnpResponseCode = params.vnp_ResponseCode;
  order.vnpTransactionNo = params.vnp_TransactionNo;

  if (!isPaymentSuccess(params)) {
    order.status = params.vnp_ResponseCode === CANCELLED_RESPONSE_CODE ? "cancelled" : "failed";
    log.info("ipn.payment_not_successful", {
      txnRef,
      responseCode: params.vnp_ResponseCode,
      transactionStatus: params.vnp_TransactionStatus,
    });
    return { RspCode: "00", Message: "Confirm Success" };
  }

  order.status = "processing";
  try {
    const sapo = getSapoConfig();
    const { order: sapoOrder, created } = await createOrderOnce(sapo, {
      txnRef,
      vnpTransactionNo: params.vnp_TransactionNo ?? "",
      vnpBankCode: params.vnp_BankCode,
      vnpPayDate: params.vnp_PayDate,
      customer: order.customer,
      sku: order.sku,
      productName: order.productName,
      unitPriceVnd: order.unitPriceVnd,
      quantity: order.quantity,
      totalVnd: order.amountVnd,
    });
    order.sapoOrder = sapoOrder;
    order.status = "completed";
    order.lastError = undefined;
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
