/**
 * Stand-in blog data for T3.7.
 *
 * The blog layout is copied from the reference now so T2 only has to swap the data source, not
 * rewrite the markup. Everything here is placeholder copy written for this repo — T2 replaces this
 * module with `lib/blog.ts` reading Sanity, and then deletes it.
 */
export interface PlaceholderPost {
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  author: string;
}

export const PLACEHOLDER_POSTS: PlaceholderPost[] = [
  {
    slug: "cach-pha-tra-dung-nhiet-do",
    title: "Pha trà đúng nhiệt độ: vì sao nước sôi không phải lúc nào cũng tốt",
    excerpt:
      "Mỗi loại trà có một khoảng nhiệt độ riêng. Pha quá nóng làm lá cháy và vị chát lấn át, pha quá nguội thì hương không mở.",
    publishedAt: "2026-09-28",
    author: "Hour PoC",
  },
  {
    slug: "tra-va-giac-ngu",
    title: "Trà và giấc ngủ: uống buổi tối có thực sự gây mất ngủ?",
    excerpt: "Câu trả lời phụ thuộc vào loại trà, thời điểm uống và cơ địa — không phải một quy tắc chung.",
    publishedAt: "2026-09-21",
    author: "Hour PoC",
  },
  {
    slug: "chon-tra-lam-qua-tang",
    title: "Chọn trà làm quà tặng: ba điều nên cân nhắc trước khi mua",
    excerpt: "Người nhận đã quen uống trà chưa, họ thích vị đậm hay nhẹ, và hộp quà sẽ được mở ở đâu.",
    publishedAt: "2026-09-14",
    author: "Hour PoC",
  },
  {
    slug: "bao-quan-tra-dung-cach",
    title: "Bảo quản trà đúng cách để giữ hương trong nhiều tháng",
    excerpt: "Ánh sáng, độ ẩm và mùi lạ là ba thứ làm hỏng trà nhanh nhất. Cả ba đều tránh được.",
    publishedAt: "2026-09-07",
    author: "Hour PoC",
  },
  {
    slug: "tra-o-long-khac-tra-xanh",
    title: "Trà ô long khác trà xanh ở điểm nào?",
    excerpt: "Cùng một cây trà, khác nhau ở mức độ oxy hoá — và đó là thứ quyết định toàn bộ hương vị.",
    publishedAt: "2026-08-30",
    author: "Hour PoC",
  },
  {
    slug: "mot-ngay-bon-tach-tra",
    title: "Một ngày bốn tách trà: gợi ý theo từng khung giờ",
    excerpt: "Sáng cần tỉnh táo, trưa cần nhẹ bụng, chiều cần tập trung, tối cần thư giãn.",
    publishedAt: "2026-08-21",
    author: "Hour PoC",
  },
];

export const findPlaceholderPost = (slug: string): PlaceholderPost | undefined =>
  PLACEHOLDER_POSTS.find((p) => p.slug === slug);

/** Dates render the same way on the server and the client, so hydration cannot disagree. */
export function formatPostDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return `${d.getUTCDate()} tháng ${d.getUTCMonth() + 1}, ${d.getUTCFullYear()}`;
}
