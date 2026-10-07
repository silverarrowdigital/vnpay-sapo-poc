/**
 * Words and switches for the home page (T12.2), taken from design/site-v3/index.html. Client-safe:
 * plain constants.
 *
 * The copy is the shop owner's own, as written in the design file. Two things in the design are
 * deliberately **not** live yet, each behind a constant here so that turning it on is one line:
 *
 * - `SHOW_HEALTH_CLAIMS` — the "Lợi ích của trà" section says tea prevents cancer and slows ageing.
 *   `/ve-chung-toi` leaves such claims out and the progress doc still lists them as awaiting the
 *   owner's sign-off, so they are drawn only when the owner confirms there is paperwork behind them.
 * - `PARTNER_LOGOS` — the design has a strip of partner logos and none has been supplied.
 */

export const SHOW_HEALTH_CLAIMS = false;

/**
 * The "New Season, New Hour — 3 vị trà mới" block. **Off** (owner, 2026-10-07): the shop sells one
 * product, so "three new teas" is untrue. Switch on, with the text edited, when there is a launch.
 */
export const SHOW_NEW_SEASON = false;

/** Logos for the partners strip: `{ src, alt }`. Empty ⇒ the section is not drawn. */
export const PARTNER_LOGOS: readonly { src: string; alt: string }[] = [];

/**
 * Sapo product ids shown under "Các sản phẩm bán chạy", in this order. Sapo does not report what
 * sells best, so the owner chooses. Empty, or ids that are no longer listed ⇒ the first in-stock
 * products stand in, up to `BEST_SELLER_COUNT`.
 */
export const BEST_SELLER_PRODUCT_IDS: readonly number[] = [];
export const BEST_SELLER_COUNT = 4;
/** The best-sellers grid is drawn only when it can be filled: fewer products than this and it is left out. */
export const BEST_SELLER_MIN = BEST_SELLER_COUNT;

/**
 * Customer quotes for "Lan tỏa tình yêu trà". **Empty on purpose** (owner, 2026-10-07): the one quote in
 * the design was a named person with five stars, and nobody has asked her. Add a quote here only once
 * the customer has agreed to be quoted by name; the section is not drawn while the list is empty.
 */
export const TESTIMONIALS: readonly { quote: string; author: string }[] = [];

export const MARQUEE_WORDS = ["Chiêm nghiệm", "Khởi đầu", "Rạng rỡ", "Rộn ràng", "Bình Yên", "Thư Thái", "Tinh Khôi"] as const;

export const HOME = {
  heroTitle: ["Tự hào trà", "Việt Nam"],
  newSeason: { title: "New Season, New Hour", text: "3 vị trà mới, 3 khoảnh khắc mới", cta: "Khám phá ngay!" },
  promo: {
    title: "Giá hời bất ngờ – Trà thơm đợi bạn",
    text: "Nhanh tay chọn vị trà yêu thích và tận hưởng ưu đãi ngay hôm nay!",
    cta: "Mua ngay!",
  },
  origin: {
    title: "Ủng hộ nghệ nhân trà Việt.",
    text: "Lá trà The Hour được trà nhân tuyển chọn và hái tay; sau đó sấy khô bằng dây chuyền hiện đại khép kín, giúp giữ lại độ tươi của lá trà, hương vị vẫn giữ được sự tinh khiết và hậu vị đậm đà mà không cần sử dụng hương liệu hoá học.",
  },
  benefits: {
    title: "Lợi ích của trà The Hour",
    items: [
      {
        title: "Năng lượng / Energy",
        text: "Lựa chọn tuyệt vời để khởi đầu một ngày hoặc để duy trì sự tỉnh táo trong khoảng thời gian dài. Bổ sung năng lượng tự nhiên chứa caffeine, giúp bạn tỉnh táo và tăng cường tập trung.",
      },
      {
        title: "Tiêu hóa / Digestion",
        text: "Trà The Hour chứa các chất chống oxy hóa và enzym giúp tăng cường quá trình tiêu hóa thức ăn, giảm triệu chứng khó tiêu, ợ nóng và tăng cường sự thoải mái trong dạ dày.",
      },
      {
        title: "Ngừa ung thư / Anticancer Potential",
        text: "EGCG trong trà có tác dụng ngăn chặn hình thành nitrosamine - một trong những tác nhân hàng đầu gây ung thư.",
      },
      {
        title: "Chống lão hóa / anti-aging",
        text: "Chứa các chất chống oxy hóa mạnh mẽ giúp bảo vệ da khỏi tác động của các gốc tự do gây hại, làm chậm quá trình lão hóa và giúp da trở nên sáng hơn.",
      },
    ],
  },
  testimonialTitle: "Lan tỏa tình yêu trà",
  journalTitle: "Nhâm nhi và đọc",
} as const;
