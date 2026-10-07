import type { Metadata } from "next";
import { BUSINESS, OPEN_GRAPH } from "@/lib/business";
import { SHOW_HEALTH_CLAIMS } from "@/lib/home";

export const metadata: Metadata = {
  title: "Chuyện của The Hour",
  description: `Câu chuyện thương hiệu ${BUSINESS.brand}: khởi đầu, người sáng lập và chặng đường phát triển.`,
  alternates: { canonical: "/ve-chung-toi" },
  openGraph: { ...OPEN_GRAPH, title: "Chuyện của The Hour", url: "/ve-chung-toi" },
};

/**
 * The brand story, the founder and the timeline from the existing site's "Chuyện của The Hour"
 * page (read 2026-10-06), in the owner's words. **Left out on purpose:** the health claims (cancer
 * prevention, weight loss, anti-ageing) and certifications in that page's product and factory
 * section, which nobody has verified here — the progress doc lists them as awaiting the owner's
 * approval. The rest of that section is back since T12.3 (see `PRODUCT_BLOCKS`). The
 * timeline is the owner's own account of the company and is reproduced as published, **except** the
 * 08.2024 FDA line: the old site says the brand registered as "safe and meeting export standards",
 * but registering a food facility with the FDA is not an approval or a safety certification, so the
 * sentence overstates it. It can return, reworded, once the owner has confirmed what was registered.
 *
 * T12.3 redraws the page from design/site-v3/about.html. The "Sản phẩm The Hour" section the page
 * once left out entirely is back, minus its health claims and certifications (see `PRODUCT_BLOCKS`).
 */
const STORY = [
  "The Hour bắt đầu câu chuyện của mình từ cái chạm vào những “khoảnh khắc” mà mỗi chúng ta đều mong muốn lưu giữ lại. Mỗi ngày với những tia nắng mới, đó chính là khung giờ The Hour yêu thích nhất, thật lý tưởng nếu được pha một tách trà, ngắm nhìn và thưởng thức từng ngụm trọn vẹn ấy.",
  "Cùng với tình yêu dành cho những đồi trà xanh mướt dưới ánh mặt trời và những bàn tay của người nông dân chăm chút chọn lựa từng lá trà; từ đó nuôi dưỡng nên sự trân quý và tự hào về nông sản Việt Nam, để The Hour luôn ấp ủ và nỗ lực mang những tách trà thơm ngon vào từng khoảnh khắc từ hàng ngày đến đặc biệt của người Việt và đi xa ra thế giới.",
];

const FOUNDER = [
  "Chloe Nguyễn sinh ra và lớn lên ở thành phố Biên Hoà, có niềm đam mê với du lịch và trải nghiệm nhiều nơi với sự đa dạng sắc màu văn hoá; đặc biệt các vùng cao ở Việt Nam với nhiều nông sản trù phú mà cô tin rằng chỉ có thổ nhưỡng địa phương cùng với những đôi bàn tay chăm chỉ của nghệ nhân Việt mới có thể cho ra sản phẩm tốt.",
  "Chloe tốt nghiệp RMIT với bằng Cử nhân Thương Mại Truyền Thông; có 3 năm kinh nghiệm làm việc trong ngành xuất nhập khẩu, 5 năm làm việc trong ngành truyền thông cho các tập đoàn lớn như P&G, Acecook, Samsung và 5 năm trong hành trình khởi nghiệp của mình.",
  "Chloe điều hành hoạt động kinh doanh trong lĩnh vực Thực phẩm & Đồ uống (F&B) với thương hiệu The Hour trong vai trò Managing Director & CEO từ năm 2019.",
  // The design's text says "an toàn tuyệt đối" here; an absolute safety claim is left out (T12, question 1).
  "The Hour luôn chọn lựa những nguồn trà cao cấp nhất ở Việt Nam, nhà máy công nghệ hiện đại để tạo ra những vị trà ngon với hương vị tự nhiên mà không dùng đến chất tạo hương hoặc tạo màu. Cô tin rằng người Việt có thể dùng nguyên liệu Việt để tạo ra sản phẩm với chất lượng quốc tế; và người Việt xứng đáng được dùng sản phẩm tốt.",
  "Cùng với bao bì sản phẩm thân thiện và bền vững với môi trường, The Hour còn cung cấp các giải pháp R&D và tư vấn sáng tạo cho các nhãn hàng muốn hợp tác B2B sản xuất quà tặng doanh nghiệp và trà nguyên liệu pha chế giúp đưa trà Việt đến tay nhiều người Việt hơn.",
];

const TIMELINE: { when: string; items: string[] }[] = [
  { when: "2020 · Khởi đầu", items: ["Tháng 10.2020: Công ty The Hour chính thức được thành lập. Hình ảnh mock up đầu tiên của branding và bao bì."] },
  {
    when: "2021",
    items: [
      "T2.2021: The Hour chính thức lên kệ chuỗi siêu thị cao cấp Annam Gourmet ở TP HCM và Hà Nội.",
      "T10.2021: The Hour được Takashimaya chọn làm thương hiệu trà tham gia event Tết 2022.",
      "T10.2021: hộp quà Tết đầu tiên được ra mắt.",
      "Tháng 12.2021 – Tháng 2.2022: The Hour được các thương hiệu nổi tiếng về gifting chọn làm nhãn hiệu cung cấp dòng trà cao cấp.",
    ],
  },
  {
    when: "2022 – 2023",
    items: [
      "T3.2022: The Hour được chọn làm partner đào tạo kiến thức về trà và cung cấp trà cho chuỗi beauty salon ở TP HCM.",
      "T6.2022: Trà Oolong Sữa The Hour được Listerine chọn làm quà tặng các KOL trong dịp ra mắt sản phẩm mới.",
      "T2.2023: Trà Lài The Hour được Annam Gourmet xếp hạng là 1 trong 3 thương hiệu trà bán chạy nhất (Best Choice) tại hệ thống 20 cửa hàng Annam Gourmet toàn quốc.",
      "T6.2023: The Hour cung cấp giải pháp sáng tạo làm quà tặng doanh nghiệp sử dụng hoa quả tươi.",
      "T10.2023: The Hour ra mắt branding và packaging mới, thể hiện rõ câu chuyện thương hiệu qua hình ảnh và cải thiện bao bì thân thiện, bảo vệ môi trường.",
    ],
  },
  {
    when: "Hiện tại",
    items: [
      "Hiện tại, The Hour vẫn tập trung vào sứ mệnh đưa trà Việt chất lượng quốc tế đến với nhiều người dân Việt Nam.",
    ],
  },
];

/**
 * "Sản phẩm The Hour" from the design. The sentences that make a health claim or cite a certification
 * (cancer prevention, weight loss, "FDA ... phê duyệt và chứng nhận", QUATEST, HACCP, "nhiều dinh dưỡng
 * và lợi ích cho sức khỏe") are in `claims` and drawn only when `SHOW_HEALTH_CLAIMS` is on
 * (lib/home.ts) — the owner confirms the paperwork first. What is left is what the design says about
 * the leaf, the old trees and the roasting, without the outcomes.
 */
const PRODUCT_BLOCKS: { title: string; paragraphs: string[]; claims: string[] }[] = [
  {
    title: "Lá trà",
    paragraphs: [
      "Lá trà được trà nhân tuyển chọn kĩ càng và hái tay từ những búp oolong hoặc lá trà; sau đó sấy khô bằng dây chuyền hiện đại khép kín, giữ lại độ tươi của lá trà. Vậy nên hương vị vẫn giữ được sự tinh khiết và hậu vị đậm đà nhưng thanh nhã.",
    ],
    claims: [],
  },
  {
    title: "Dòng trà đặc biệt",
    paragraphs: [
      "Đặc biệt các dòng trà cổ thụ của The Hour như Trà Shan Tuyết Lài, Trà Shan Tuyết Gừng được làm từ trà Shan Tuyết Cổ Thụ rất quý và hương vị độc đáo. Những cây trà cổ thụ sinh trưởng trên các dãy núi cao từ 1000 mét trở lên ở phía Bắc Việt Nam.",
      "Đặc biệt, trà nhân chỉ dọn cỏ, tỉa cành và hoàn toàn không sử dụng phân bón hay thuốc bảo vệ thực vật trên cây trà.",
    ],
    claims: ["Vậy nên trà cổ thụ rất “sạch”, nhiều dinh dưỡng và lợi ích cho sức khỏe."],
  },
  {
    title: "Nhà máy",
    paragraphs: [
      "Nhà máy sản xuất trà The Hour được trang bị các máy móc, thiết bị và công nghệ hiện đại.",
      "Máy móc trong hệ thống rang chu trình khép kín, công suất 6-8 tấn/máy/tháng, công nghệ Đức với cơ cấu “hot air” tân tiến, nhiệt độ chuẩn và ổn định giữa các mẻ, không sử dụng nhiệt độ quá cao và chất xúc tác đốt cháy giai đoạn.",
    ],
    claims: [
      "Tất cả các sản phẩm trà The HOUR đều được kiểm nghiệm khắt khe về VSATTP, “Không chất bảo quản, Không hương liệu, Không phụ gia” của QUATEST 3, và đạt chuẩn được FDA của chính phủ Hoa Kỳ phê duyệt và chứng nhận.",
      "Quá trình sản xuất đáp ứng các tiêu chuẩn vệ sinh an toàn thực phẩm và tiêu chuẩn HACCP.",
      "Vì thế bảo toàn được tất cả EGCG trong trà, giúp cơ thể giảm cân, ngừa ung thư, chống lão hoá, tốt hơn cho sức khỏe.",
    ],
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-[1416px] px-4 lg:px-10">
      <div className="py-[clamp(48px,5vw,96px)]">
        <h1 className="m-0 text-[clamp(2.125rem,3.6vw,3rem)] leading-[1.3] font-normal">Thương Hiệu {BUSINESS.brand}</h1>
      </div>

      <section aria-labelledby="ab-story" className="grid gap-16 lg:grid-cols-2">
        <h2 id="ab-story" className="m-0 text-[clamp(1.875rem,3.4vw,3rem)] leading-[1.3] font-normal">
          Chuyện của The Hour
        </h2>
        <div className="grid max-w-[800px] gap-4 text-lg leading-7">
          {STORY.map((p) => (
            <p key={p} className="m-0">
              {p}
            </p>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="ab-founder"
        className="mt-[clamp(48px,5vw,96px)] grid items-start justify-between gap-16 lg:grid-cols-[minmax(0,736px)_minmax(0,600px)]"
      >
        <div className="grid max-w-[800px] gap-4 text-lg leading-7">
          <h2 className="m-0 text-xl leading-[26px] font-normal">Người sáng lập &amp; CEO</h2>
          <h3 id="ab-founder" className="m-0 text-[30px] leading-[34px] font-normal">
            Chloe Hương Nguyễn
          </h3>
          {FOUNDER.map((p) => (
            <p key={p} className="m-0">
              {p}
            </p>
          ))}
        </div>
        {/* No portrait has been supplied; the design draws a 600 × 700 grey box here. */}
        <div role="img" aria-label="Chloe Hương Nguyễn" className="aspect-[600/700] w-full rounded-sm bg-placeholder" />
      </section>

      <section aria-labelledby="ab-time" className="mt-[clamp(48px,5vw,96px)]">
        <h2 id="ab-time" className="m-0 mb-8 text-[clamp(1.75rem,3vw,2.25rem)] leading-[1.3] font-normal">
          Chặng đường phát triển
        </h2>
        <ol className="m-0 grid list-none gap-12 border-t border-line p-0 pt-8 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
          {TIMELINE.map((block) => (
            <li key={block.when}>
              <h3 className="m-0 mb-4 text-[26px] leading-[30px] font-normal">{block.when}</h3>
              <ul className="m-0 grid list-none gap-3 p-0 text-ink-soft">
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      {/* id: the menu's "Chuyện của Trà" lands here. */}
      <section id="san-pham" aria-labelledby="ab-prod" className="mt-[clamp(48px,5vw,96px)] scroll-mt-8">
        <h2 id="ab-prod" className="m-0 mb-8 text-[clamp(1.75rem,3vw,2.25rem)] leading-[1.3] font-normal">
          Sản phẩm The Hour
        </h2>
        <div className="grid gap-12 lg:grid-cols-3">
          {PRODUCT_BLOCKS.map((b) => (
            <div key={b.title}>
              <h3 className="m-0 mb-4 text-[26px] leading-[30px] font-normal">{b.title}</h3>
              <div className="grid gap-3">
                {[...b.paragraphs, ...(SHOW_HEALTH_CLAIMS ? b.claims : [])].map((p) => (
                  <p key={p} className="m-0">
                    {p}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section
        aria-label="Thông tin The Hour"
        className="mt-[clamp(48px,5vw,96px)] grid gap-12 pb-[clamp(64px,6vw,112px)] lg:grid-cols-2"
      >
        <div className="grid gap-3">
          <h2 className="m-0 text-xl leading-[26px] font-normal">Thông tin The Hour</h2>
          <p className="m-0">
            {BUSINESS.registration}. Địa chỉ đăng ký kinh doanh: {BUSINESS.address}.
          </p>
        </div>
        <div className="grid gap-3">
          <h2 className="m-0 text-xl leading-[26px] font-normal">Liên hệ</h2>
          <p className="m-0">
            Hotline: {BUSINESS.hotline} ({BUSINESS.hotlineHours})
            <br />
            Email: {BUSINESS.email}
          </p>
        </div>
      </section>
    </div>
  );
}
