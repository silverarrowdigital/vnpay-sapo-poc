/**
 * Shipping fees — a flat table by province, computed here and nowhere else.
 *
 * **Client-safe**, on the same terms as `lib/product.ts`: pure data and pure functions, no config,
 * no logger, no network, no Sapo import. That is deliberate rather than convenient. The fee has to
 * appear in the checkout summary *and* be added to the amount the VNPAY URL is signed with *and*
 * be sent to Sapo as a `shipping_line`. Three places, and the plan's third big risk is those three
 * disagreeing. Sharing one function is what makes them agree by construction: the browser only
 * ever *displays* what `quoteShipping` returns, and the server calls the same function again on
 * the amount it resolved from Sapo, so a tampered browser can change the display and never the
 * charge.
 *
 * Why a flat table and not Sapo's own shipping zones: `GET /admin/shipping_zones.json` answers
 * `access_denied` even with the order + shipping scope enabled (verified twice, before and after
 * the Khuyến mãi scope was turned on), so it is not reachable by a private app at all. See
 * docs/plan/T7-ban-hang-that.md § T7.0.
 *
 * **The numbers below are the shop's to set.** They are placeholders with a defensible shape, not
 * a quote from a carrier: three zones keyed by Sapo's own province id, and free delivery over a
 * threshold. Edit `ZONE_FEE_VND`, `FREE_SHIPPING_THRESHOLD_VND` and the zone sets; nothing else in
 * the project needs to change.
 *
 * Province ids are Sapo's (`GET /admin/provinces.json`, id === code, 1–63, verified live
 * 2026-10-05). Sapo still serves the 63-province list, so these ids are stable for us even though
 * Vietnam's own administrative map has since merged units.
 */

/** Orders at or above this subtotal (after any discount) ship free. */
export const FREE_SHIPPING_THRESHOLD_VND = 500_000;

export type ShippingZone = "metro" | "zone1" | "zone2";

const ZONE_FEE_VND: Record<ShippingZone, number> = {
  metro: 25_000,
  zone1: 35_000,
  zone2: 45_000,
};

const ZONE_LABEL: Record<ShippingZone, string> = {
  metro: "Nội thành Hà Nội / TP Hồ Chí Minh",
  zone1: "Các tỉnh lân cận hai thành phố lớn",
  zone2: "Các tỉnh còn lại",
};

/** Hà Nội, TP Hồ Chí Minh. */
const METRO_PROVINCE_IDS = new Set([1, 2]);

/**
 * Provinces within short reach of the two metros: the Hanoi delta cluster and the Ho Chi Minh City
 * cluster. Everything not listed here and not a metro falls to `zone2`, so a province Sapo adds
 * later is charged the highest fee rather than silently charged nothing.
 */
const ZONE1_PROVINCE_IDS = new Set([
  // Bắc: Bắc Ninh, Hưng Yên, Hà Nam, Vĩnh Phúc, Hải Dương, Hải Phòng, Bắc Giang, Hòa Bình,
  //      Nam Định, Thái Nguyên, Thái Bình, Ninh Bình, Phú Thọ, Quảng Ninh
  8, 31, 25, 62, 27, 28, 5, 30, 40, 55, 54, 42, 44, 49,
  // Nam: Bình Dương, Đồng Nai, Long An, Tây Ninh, Bà Rịa-Vũng Tàu, Tiền Giang, Bình Phước
  10, 21, 39, 53, 4, 58, 12,
]);

export function shippingZoneOf(provinceId: number): ShippingZone {
  if (METRO_PROVINCE_IDS.has(provinceId)) return "metro";
  if (ZONE1_PROVINCE_IDS.has(provinceId)) return "zone1";
  return "zone2";
}

export interface ShippingQuote {
  zone: ShippingZone;
  /** What the customer pays for delivery. 0 when the free-shipping threshold is met. */
  feeVnd: number;
  /** The fee before the threshold waived it, so the summary can show what was saved. */
  listFeeVnd: number;
  isFree: boolean;
  /** Shown to the customer and sent to Sapo as the shipping line's title. */
  title: string;
  /** Sapo shipping_line.code — a reference to the method, not a tracking number. */
  code: string;
  zoneLabel: string;
}

/**
 * The quote for one province and one goods subtotal.
 *
 * `goodsSubtotalVnd` is the amount **after** any discount: a discount that drops the basket below
 * the threshold also drops the free delivery, which is the only reading that cannot be gamed by
 * stacking a code on top of a just-qualifying basket.
 */
export function quoteShipping(provinceId: number, goodsSubtotalVnd: number): ShippingQuote {
  const zone = shippingZoneOf(provinceId);
  const listFeeVnd = ZONE_FEE_VND[zone];
  const isFree = goodsSubtotalVnd >= FREE_SHIPPING_THRESHOLD_VND;
  return {
    zone,
    feeVnd: isFree ? 0 : listFeeVnd,
    listFeeVnd,
    isFree,
    title: isFree ? "Giao hàng tiêu chuẩn (miễn phí)" : "Giao hàng tiêu chuẩn",
    code: "standard",
    zoneLabel: ZONE_LABEL[zone],
  };
}
