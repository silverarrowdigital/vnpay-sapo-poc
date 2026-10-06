import type { Metadata } from "next";
import { BUSINESS } from "@/lib/business";

export const metadata: Metadata = {
  title: "Chuyện của The Hour",
  description: `Câu chuyện thương hiệu ${BUSINESS.brand}: khởi đầu, người sáng lập và chặng đường phát triển.`,
  alternates: { canonical: "/ve-chung-toi" },
};

/**
 * The brand story, the founder and the timeline from the existing site's "Chuyện của The Hour"
 * page (read 2026-10-06), in the owner's words. **Left out on purpose:** that page's product and
 * factory section, which makes health claims (cancer prevention, weight loss, anti-ageing) that
 * nobody has verified here — the progress doc lists them as awaiting the owner's approval. The
 * timeline is the owner's own account of the company and is reproduced as published, **except** the
 * 08.2024 FDA line: the old site says the brand registered as "safe and meeting export standards",
 * but registering a food facility with the FDA is not an approval or a safety certification, so the
 * sentence overstates it. It can return, reworded, once the owner has confirmed what was registered.
 */
const STORY = [
  "The Hour bắt đầu câu chuyện của mình từ cái chạm vào những “khoảnh khắc” mà mỗi chúng ta đều mong muốn lưu giữ lại. Mỗi ngày với những tia nắng mới, đó chính là khung giờ The Hour yêu thích nhất, thật lý tưởng nếu được pha một tách trà, ngắm nhìn và thưởng thức từng ngụm trọn vẹn ấy.",
  "Cùng với tình yêu dành cho những đồi trà xanh mướt dưới ánh mặt trời và những bàn tay của người nông dân chăm chút chọn lựa từng lá trà; từ đó nuôi dưỡng nên sự trân quý và tự hào về nông sản Việt Nam, để The Hour luôn ấp ủ và nỗ lực mang những tách trà thơm ngon vào từng khoảnh khắc từ hàng ngày đến đặc biệt của người Việt và đi xa ra thế giới.",
];

const FOUNDER = [
  "Chloe Nguyễn sinh ra và lớn lên ở thành phố Biên Hoà, có niềm đam mê với du lịch và trải nghiệm nhiều nơi với sự đa dạng sắc màu văn hoá; đặc biệt các vùng cao ở Việt Nam với nhiều nông sản trù phú mà cô tin rằng chỉ có thổ nhưỡng địa phương cùng với những đôi bàn tay chăm chỉ của nghệ nhân Việt mới có thể cho ra sản phẩm tốt.",
  "Chloe tốt nghiệp RMIT với bằng Cử nhân Thương Mại Truyền Thông; có 3 năm kinh nghiệm làm việc trong ngành xuất nhập khẩu, 5 năm làm việc trong ngành truyền thông cho các tập đoàn lớn như P&G, Acecook, Samsung và 5 năm trong hành trình khởi nghiệp của mình.",
  "Chloe điều hành hoạt động kinh doanh trong lĩnh vực Thực phẩm & Đồ uống (F&B) với thương hiệu The Hour trong vai trò Managing Director & CEO từ năm 2019.",
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

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-12">
      <p className="m-0 font-mono text-xs tracking-widest text-ink-soft uppercase">Thương hiệu {BUSINESS.brand}</p>
      <h1 className="font-display mt-3 mb-8 text-[clamp(1.75rem,4vw,2.75rem)] leading-tight font-normal">
        Chuyện của The Hour
      </h1>
      <div className="grid gap-4 text-sm leading-relaxed">
        {STORY.map((p) => (
          <p key={p} className="m-0">
            {p}
          </p>
        ))}
      </div>

      <h2 className="font-display mt-14 mb-1 text-2xl font-normal">Chloe Hương Nguyễn</h2>
      <p className="m-0 mb-5 text-xs tracking-wide text-ink-soft uppercase">Người sáng lập &amp; CEO</p>
      <div className="grid gap-4 text-sm leading-relaxed">
        {FOUNDER.map((p) => (
          <p key={p} className="m-0">
            {p}
          </p>
        ))}
      </div>

      <h2 className="font-display mt-14 mb-6 text-2xl font-normal">Chặng đường phát triển</h2>
      <ol className="m-0 grid list-none gap-8 p-0">
        {TIMELINE.map((block) => (
          <li key={block.when}>
            <h3 className="mb-2 text-base font-medium">{block.when}</h3>
            <ul className="m-0 grid gap-2 pl-5 text-sm leading-relaxed">
              {block.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
