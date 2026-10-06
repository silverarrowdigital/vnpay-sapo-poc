/**
 * Who runs this shop, as it is published on the shop's own existing site (thehourtea.com footer and
 * policy pages, read 2026-10-06). One place, so the footer, the contact page and the policies cannot
 * disagree about an address or a number.
 *
 * Client-safe: plain constants, no config, no client, no logger.
 *
 * These are the owner's own published business details, used here with the owner's agreement. They
 * are **not** legal advice and nobody qualified has checked them against the rules that apply to an
 * e-commerce site in Vietnam (CLAUDE.md "Known MVP limitations").
 */
export const BUSINESS = {
  /** The brand as customers know it. */
  brand: "The Hour Tea",
  /** The registered company, as written on the existing site's privacy policy. */
  legalName: "Công Ty TNHH MTV The Hour",
  taxId: "0316585235",
  registration: "Mã số doanh nghiệp/Mã số thuế 0316585235, cấp ngày 13/11/2020, thay đổi lần 1 ngày 09/03/2023, nơi cấp: Sở Kế hoạch và Đầu tư TP.HCM",
  address: "14/8 Lam Sơn, P6, Q. Bình Thạnh, TP. Hồ Chí Minh, Việt Nam",
  hotline: "0383882454",
  hotlineHours: "9:00–16:30, thứ 2 đến thứ 6",
  email: "info@thehourtea.com",
  facebook: "https://www.facebook.com/thehourtea",
  instagram: "https://www.instagram.com/thehourtea/",
  tiktok: "https://www.tiktok.com/@thehourtea",
} as const;

/**
 * The default openGraph fields. A page's own `openGraph` replaces the layout's entirely rather than
 * merging with it, so a page spreads these to keep the site name and locale.
 */
export const OPEN_GRAPH = { type: "website", locale: "vi_VN", siteName: BUSINESS.brand } as const;
