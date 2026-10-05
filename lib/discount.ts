/**
 * Discount codes, read from Sapo's `price_rules` and **evaluated entirely here, on the server**.
 *
 * This is the one module in the project where a mistake hands out money. Two rules hold it
 * together, and both are load-bearing:
 *
 * 1. **The browser sends a code, never an amount.** `/api/discount` returns a quote for display,
 *    and `startCheckout` throws that quote away and recomputes from the code — against the cart it
 *    has just repriced from Sapo. A tampered request can change which code is claimed; it can
 *    never change what the code is worth.
 * 2. **A rule we cannot fully evaluate is refused, not approximated.** Sapo rules can carry
 *    conditions this project has no way to check (customer groups, saved searches, collections,
 *    locations, buy-X-get-Y ratios). Honouring the *parts* we understand would mean charging a
 *    discount the shop did not actually offer, so `evaluateRule` demands a shape it fully
 *    understands and says so for everything else.
 *
 * API shape verified against a live store (2026-10-02, re-verified 2026-10-05 on rule `TEST10`):
 *
 * - `GET /admin/price_rules.json` is the discount system. `/admin/discounts.json` answers
 *   `access_denied` even with the Khuyến mãi scope on, and a top-level `/admin/discount_codes.json`
 *   is not a route. Neither is needed.
 * - **The customer-facing code is not the rule's `title`.** It lives on the nested resource
 *   `GET /admin/price_rules/{id}/discount_codes.json` →
 *   `{"discount_codes":[{id, code, usage_count, created_on, modified_on}]}`. A title is a label an
 *   editor renames freely; matching on it would be matching on nothing.
 * - **`?code=` and `?title=` are silently ignored and return every rule.** Only `?query=` filters,
 *   and it is a fuzzy case-insensitive substring search: `?query=T` returns `TEST10`,
 *   `?query=ZZZZ` returns `[]`. So it narrows candidates and never identifies one — the exact
 *   `code` is re-checked on the nested resource, the same way `findOrderByTxnRef` re-checks the tag.
 * - `value` is a **negative string** (`"-10"`) with `value_type: "percentage"` | `"fixed_amount"`.
 * - `summary` carries a ready-made Vietnamese sentence worth showing the customer rather than
 *   re-deriving.
 */
import type { SapoConfig } from "./config";
import { log } from "./log";
import { sapoGet } from "./sapo";

/** The fields of a price rule this module reads. Everything else on the object is ignored. */
interface RawPriceRule {
  id?: number;
  title?: string;
  value?: string | number | null;
  value_type?: string | null;
  status?: string | null;
  starts_on?: string | null;
  ends_on?: string | null;
  usage_limit?: number | null;
  times_used?: number | null;
  once_per_customer?: boolean | null;
  value_limit_amount?: number | string | null;
  target_type?: string | null;
  target_selection?: string | null;
  customer_selection?: string | null;
  discount_class?: string | null;
  summary?: string | null;
  prerequisite_subtotal_range?: { greater_than_or_equal_to?: number | string | null } | null;
  prerequisite_quantity_range?: { greater_than_or_equal_to?: number | string | null } | null;
  prerequisite_sale_total_range?: unknown;
  prerequisite_shipping_price_range?: unknown;
  prerequisite_to_entitlement_purchase?: unknown;
  prerequisite_to_entitlement_quantity_ratio?: unknown;
  entitled_product_ids?: number[] | null;
  entitled_variant_ids?: number[] | null;
  entitled_collection_ids?: number[] | null;
  entitled_country_ids?: number[] | null;
  entitled_province_ids?: number[] | null;
  prerequisite_product_ids?: number[] | null;
  prerequisite_variant_ids?: number[] | null;
  prerequisite_collection_ids?: number[] | null;
  prerequisite_customer_ids?: number[] | null;
  prerequisite_customer_group_ids?: number[] | null;
  prerequisite_saved_search_ids?: number[] | null;
  prerequisite_location_ids?: number[] | null;
}

interface RawDiscountCode {
  id?: number;
  code?: string;
  usage_count?: number;
}

/** What the cart contributes to the decision. Both numbers are server-resolved, never from input. */
export interface DiscountBasis {
  goodsSubtotalVnd: number;
  totalUnits: number;
}

export interface DiscountQuote {
  /** The code exactly as Sapo spells it, not as the customer typed it. */
  code: string;
  amountVnd: number;
  /** Sapo's own Vietnamese sentence describing the rule, for the summary line. */
  summary: string;
  priceRuleId: number;
}

/** Why a code was refused. The message is shown to the customer as-is. */
export class DiscountRejected extends Error {
  constructor(
    message: string,
    /** Short machine reason for the log; never shown. */
    public readonly reason: string,
  ) {
    super(message);
    this.name = "DiscountRejected";
  }
}

const MAX_CODE_LENGTH = 64;

/** Codes are typed by hand, so compare on a trimmed, case-folded form — of the whole value. */
function sameCode(a: string, b: string): boolean {
  return a.trim().toLocaleUpperCase() === b.trim().toLocaleUpperCase();
}

export function normaliseCode(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const code = raw.trim();
  if (code.length === 0 || code.length > MAX_CODE_LENGTH) return undefined;
  return code;
}

function toNumber(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function isEmptyList(value: number[] | null | undefined): boolean {
  return value === null || value === undefined || value.length === 0;
}

/**
 * Conditions we have no way to evaluate. Each one present means the rule is refused rather than
 * guessed at: there is no customer account in this project, no collection membership, and no
 * buy-X-get-Y engine.
 */
function hasUncheckableConditions(rule: RawPriceRule): string | undefined {
  if (!isEmptyList(rule.entitled_product_ids)) return "entitled_product_ids";
  if (!isEmptyList(rule.entitled_variant_ids)) return "entitled_variant_ids";
  if (!isEmptyList(rule.entitled_collection_ids)) return "entitled_collection_ids";
  if (!isEmptyList(rule.entitled_country_ids)) return "entitled_country_ids";
  if (!isEmptyList(rule.entitled_province_ids)) return "entitled_province_ids";
  if (!isEmptyList(rule.prerequisite_product_ids)) return "prerequisite_product_ids";
  if (!isEmptyList(rule.prerequisite_variant_ids)) return "prerequisite_variant_ids";
  if (!isEmptyList(rule.prerequisite_collection_ids)) return "prerequisite_collection_ids";
  if (!isEmptyList(rule.prerequisite_customer_ids)) return "prerequisite_customer_ids";
  if (!isEmptyList(rule.prerequisite_customer_group_ids)) return "prerequisite_customer_group_ids";
  if (!isEmptyList(rule.prerequisite_saved_search_ids)) return "prerequisite_saved_search_ids";
  if (!isEmptyList(rule.prerequisite_location_ids)) return "prerequisite_location_ids";
  if (rule.prerequisite_to_entitlement_purchase) return "prerequisite_to_entitlement_purchase";
  if (rule.prerequisite_to_entitlement_quantity_ratio) return "prerequisite_to_entitlement_quantity_ratio";
  if (rule.prerequisite_sale_total_range) return "prerequisite_sale_total_range";
  if (rule.prerequisite_shipping_price_range) return "prerequisite_shipping_price_range";
  if ((rule.customer_selection ?? "all") !== "all") return "customer_selection";
  // A shipping-target rule discounts delivery, not goods. The marker for it is not verified
  // against a live rule, so it is refused rather than applied to the wrong number.
  if ((rule.target_type ?? "line_item") !== "line_item") return "target_type";
  if ((rule.target_selection ?? "all") !== "all") return "target_selection";
  return undefined;
}

/**
 * Decide one rule against one cart, and compute the money.
 *
 * Exported for its own sake: it is pure, so the order of the checks and the rounding can be
 * asserted without touching the network.
 */
export function evaluateRule(rule: RawPriceRule, code: string, basis: DiscountBasis, now = new Date()): DiscountQuote {
  const ruleId = rule.id ?? 0;

  if ((rule.status ?? "").toLowerCase() !== "active") {
    throw new DiscountRejected("Mã này hiện không còn hiệu lực.", "status");
  }

  const startsOn = rule.starts_on ? Date.parse(rule.starts_on) : undefined;
  if (startsOn !== undefined && Number.isFinite(startsOn) && now.getTime() < startsOn) {
    throw new DiscountRejected("Mã này chưa tới ngày áp dụng.", "not_started");
  }
  const endsOn = rule.ends_on ? Date.parse(rule.ends_on) : undefined;
  if (endsOn !== undefined && Number.isFinite(endsOn) && now.getTime() > endsOn) {
    throw new DiscountRejected("Mã này đã hết hạn.", "expired");
  }

  const usageLimit = toNumber(rule.usage_limit);
  const timesUsed = toNumber(rule.times_used) ?? 0;
  if (usageLimit !== undefined && timesUsed >= usageLimit) {
    throw new DiscountRejected("Mã này đã hết lượt sử dụng.", "usage_limit");
  }

  const unchecked = hasUncheckableConditions(rule);
  if (unchecked !== undefined) {
    // Not the customer's fault and not a lie: we genuinely cannot honour this rule correctly.
    log.warn("discount.unsupported_rule", { priceRuleId: ruleId, condition: unchecked });
    throw new DiscountRejected("Mã này có điều kiện mà trang web chưa áp dụng được.", `unsupported:${unchecked}`);
  }

  const minSubtotal = toNumber(rule.prerequisite_subtotal_range?.greater_than_or_equal_to);
  if (minSubtotal !== undefined && basis.goodsSubtotalVnd < minSubtotal) {
    throw new DiscountRejected(
      `Đơn hàng phải từ ${minSubtotal.toLocaleString("vi-VN")}₫ mới dùng được mã này.`,
      "min_subtotal",
    );
  }
  const minQuantity = toNumber(rule.prerequisite_quantity_range?.greater_than_or_equal_to);
  if (minQuantity !== undefined && basis.totalUnits < minQuantity) {
    throw new DiscountRejected(`Đơn hàng phải có từ ${minQuantity} sản phẩm mới dùng được mã này.`, "min_quantity");
  }

  const rawValue = toNumber(rule.value);
  if (rawValue === undefined || rawValue === 0) {
    throw new DiscountRejected("Mã này không hợp lệ.", "value_unreadable");
  }
  // Sapo stores the value as a negative number ("-10"); the magnitude is the discount.
  const magnitude = Math.abs(rawValue);
  const valueType = (rule.value_type ?? "").toLowerCase();

  let amountVnd: number;
  if (valueType === "percentage") {
    if (magnitude > 100) throw new DiscountRejected("Mã này không hợp lệ.", "percentage_over_100");
    amountVnd = Math.round((basis.goodsSubtotalVnd * magnitude) / 100);
    const cap = toNumber(rule.value_limit_amount);
    if (cap !== undefined && cap > 0) amountVnd = Math.min(amountVnd, Math.round(cap));
  } else if (valueType === "fixed_amount") {
    amountVnd = Math.round(magnitude);
  } else {
    log.warn("discount.unsupported_value_type", { priceRuleId: ruleId, valueType });
    throw new DiscountRejected(
      "Mã này có kiểu giảm giá trang web chưa áp dụng được.",
      `unsupported_value_type:${valueType}`,
    );
  }

  // Never more than the goods are worth: a discount must not become a payment to the customer,
  // and a VNPAY amount of 0 is not a transaction we can take.
  amountVnd = Math.max(0, Math.min(amountVnd, basis.goodsSubtotalVnd));
  if (amountVnd <= 0) {
    throw new DiscountRejected("Mã này không giảm được gì cho đơn hàng hiện tại.", "zero_amount");
  }

  if (rule.once_per_customer === true) {
    // There are no customer accounts here, so this cannot be enforced. The exposure is bounded by
    // the discount itself and visible in Sapo; refusing every such code would be worse. Recorded
    // in CLAUDE.md "Known MVP limitations".
    log.warn("discount.once_per_customer_unenforced", { priceRuleId: ruleId });
  }

  return {
    code,
    amountVnd,
    summary: (rule.summary ?? "").trim() || `Giảm ${magnitude}${valueType === "percentage" ? "%" : "₫"}`,
    priceRuleId: ruleId,
  };
}

/**
 * Resolve a customer-typed code to a quote, or throw `DiscountRejected`.
 *
 * The three steps are the algorithm from docs/plan/T7-ban-hang-that.md § T7.3, in that order:
 * narrow with `?query=`, then re-check the exact code on each candidate's nested resource, then
 * evaluate. Step two is not optional — without it, typing `T` would earn `TEST10`'s 10%.
 */
export async function quoteDiscount(
  cfg: SapoConfig,
  rawCode: string,
  basis: DiscountBasis,
  now = new Date(),
): Promise<DiscountQuote> {
  const code = normaliseCode(rawCode);
  if (code === undefined) throw new DiscountRejected("Hãy nhập mã giảm giá.", "empty");

  const qs = new URLSearchParams({ query: code, limit: "50" });
  const listed = (await sapoGet(cfg, `/admin/price_rules.json?${qs.toString()}`)) as { price_rules?: RawPriceRule[] };
  const candidates = (listed.price_rules ?? []).filter((r) => typeof r.id === "number");
  if (candidates.length === 0) throw new DiscountRejected("Mã giảm giá không đúng.", "no_candidate");

  for (const rule of candidates) {
    const nested = (await sapoGet(cfg, `/admin/price_rules/${rule.id}/discount_codes.json`)) as {
      discount_codes?: RawDiscountCode[];
    };
    const exact = (nested.discount_codes ?? []).find((c) => typeof c.code === "string" && sameCode(c.code, code));
    if (exact === undefined) continue; // the fuzzy search matched a rule whose code is not this one
    return evaluateRule(rule, exact.code as string, basis, now);
  }

  throw new DiscountRejected("Mã giảm giá không đúng.", "no_exact_match");
}
