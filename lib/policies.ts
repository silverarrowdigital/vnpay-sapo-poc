/**
 * The shop's policy pages, derived on 2026-10-06 from the owner's own published pages at
 * thehourtea.com/policies/* and adjusted ONLY where the old text states something that is not true
 * of this shop:
 *
 * - **Payment.** The old terms offered Zalopay/VISA and cash on delivery. This shop takes VNPAY only
 *   and cash on delivery is switched off (COD_ENABLED in lib/product.ts), so the payment section is
 *   rewritten (see `paymentSection` below).
 * - **Delivery fee.** The old page said free from 1.099.000đ. The shop's real numbers live in
 *   lib/shipping.ts, so `shippingSection` builds the fee and threshold from there at render time and
 *   the page cannot say something checkout does not charge.
 * - **Accounts.** The old privacy text described customer accounts; this shop has none, so those
 *   items are removed or reworded, and the data system named is no longer Shopify. The list of
 *   moments data is collected also gains the one this shop actually has: the checkout form.
 * - **Order tracking.** The shipping page now points to the order-lookup page, which exists for
 *   exactly that, ahead of "message the Fanpage".
 * - **Zalo.** The returns page asked for videos "via Facebook or Zalo"; no Zalo contact is published
 *   anywhere, so it names the two channels that are (Facebook, email).
 *
 * **Left as the owner wrote it, and worth a human look:** delivery times and the carriers named, the
 * mention of Covid, "thehourtea.com" as the site's name (this deployment has another address until a
 * domain is attached), and the
 * returns text, in which "no returns or refunds" sits beside a promise to refund an order that never
 * arrived, and which excludes discounted goods from exchange — now every order that used a discount
 * code.
 *
 * Everything else is the owner's wording, unchanged. **Nobody qualified has reviewed any of this
 * against Vietnamese e-commerce rules** — it is the old text, patched for facts, not a legal opinion.
 *
 * Client-safe (plain data and one pure function).
 */
import { BUSINESS } from "./business";
import { FREE_SHIPPING_THRESHOLD_VND, quoteShipping } from "./shipping";
import { COD_ENABLED, formatVnd } from "./product";

export interface PolicyPage {
  slug: string;
  title: string;
  /** Meta description for search results. */
  description: string;
  /** Plain lines. A line starting with "1. " is a section heading, "1.1. " a sub-heading; the rest are paragraphs. */
  lines: string[];
}

// One money format across the site (₫500,000, as the banner and the checkout show it).
const dong = formatVnd;

function shippingSection(): string[] {
  // One province from each zone (2 metro, 8 zone 1, 3 zone 2). Today all three cost the same and the
  // page says one number; the day they differ it says the range instead of quietly quoting one zone.
  const fees = [2, 8, 3].map((provinceId) => quoteShipping(provinceId, 0).listFeeVnd);
  const lowest = Math.min(...fees);
  const highest = Math.max(...fees);
  const feeText =
    lowest === highest
      ? `phí vận chuyển ${dong(lowest)} áp dụng toàn quốc`
      : `phí vận chuyển từ ${dong(lowest)} đến ${dong(highest)} tuỳ khu vực`;
  return [
    "Phí vận chuyển:",
    `Với đơn hàng từ ${dong(FREE_SHIPPING_THRESHOLD_VND)}: miễn phí vận chuyển toàn quốc.`,
    `Với đơn hàng dưới ${dong(FREE_SHIPPING_THRESHOLD_VND)}: ${feeText}. Giá trị đơn hàng để xét miễn phí là giá trị hàng sau khi trừ mã giảm giá.`,
    "Phí vận chuyển được hiển thị trong phần tóm tắt đơn hàng trước khi quý khách thanh toán.",
    ...[
  "Thời gian giao hàng:",
  "• Đơn hàng nội thành TP.HCM: Thời gian giao hàng là 2-3 ngày sau khi đặt hàng.",
  "• Đơn hàng ở ngoại thành Tp.HCM và các tỉnh thành khác: Thời gian là 2-15 ngày đối với khu vực trung tâm tỉnh thành phố, 5-15 ngày đối với khu vực huyện, xã, thị trấn… (Không tính chủ nhật hay các ngày lễ tết) Có thể thay đổi thời gian giao hàng trong một số trường hợp bất khả kháng như: chịu ảnh hưởng của thiên tai, dịch Covid hoặc các sự kiện đặc biệt khác.",
  "Tuy nhiên, vẫn có những giới hạn và sự chậm trễ do nguyên nhân khách quan như lễ, tết, địa chỉ nhận hàng khó tìm, sự chậm trễ từ dịch vụ chuyển phát,... The Hour mong quý khách thông cảm vì những lý do ngoài sự chi phối của chúng tôi.",
  "• Trường hợp có sự chậm trễ khi giao hàng xảy ra, The Hour sẽ thông báo ngay đến bạn đồng thời sẽ tiếp tục giao hàng hoặc hỗ trợ huỷ đơn hàng nếu bạn muốn. Chúng tôi sẽ không chịu trách nhiệm do việc giao hàng chậm trễ trừ trách nhiệm hoàn trả tiền nếu bạn đã thanh toán mà chưa nhận được sản phẩm.",
  "• Lưu ý: Đơn hàng đặt mua tại website thehourtea.com sẽ được chúng tôi chuyển phát đến quý khách thông qua các đơn vị vận chuyển như GIAO HÀNG NHANH hoặc J&T EXPRESS.",
  "Quý khách có thể tự tra cứu tình trạng đơn hàng tại trang Tra cứu đơn hàng (nhập mã đơn hàng và số điện thoại đặt hàng). Để được kiểm tra thêm, xin vui lòng nhắn tin vào Fanpage hoặc gọi số Hotline, cung cấp tên, số điện thoại, mã đơn hàng (nếu có) để được kiểm tra."
],
  ];
}

const paymentSection: string[] = [
  "Chính sách thanh toán:",
  "Hiện nay website nhận thanh toán trực tuyến thông qua cổng thanh toán VNPAY. Thông tin thanh toán được nhập trên trang của VNPAY; The HOUR không lưu số thẻ hay thông tin xác thực của quý khách.",
  // True while COD_ENABLED is false. Bringing COD back means writing its terms here, not just deleting this.
  ...(COD_ENABLED ? [] : ["Hiện website chưa áp dụng hình thức thanh toán khi nhận hàng (COD)."]),
  "Đơn hàng chỉ được ghi nhận sau khi VNPAY xác nhận thanh toán thành công. Nếu quý khách đã bị trừ tiền mà chưa thấy đơn hàng, vui lòng đừng thanh toán lại: hãy tra cứu đơn hàng trên website hoặc liên hệ hotline/email của The HOUR kèm mã giao dịch.",
  "",
  "Chính sách mua hàng:",
  ...[
  "Khi nhận sản phẩm, quý khách vui lòng kiểm tra kỹ tính nguyên vẹn, số lượng sản phẩm theo đơn đặt hàng trước khi nhận. Việc bạn ký xác nhận hoặc ảnh chụp nhận hàng của bạn do đơn vị vận chuyển thu thập trong quá trình giao nhận là chứng từ xác minh chúng tôi đã hoàn thành nghĩa vụ giao hàng đúng với đơn đặt hàng sau khi được bạn kiểm tra ngoại quan."
],
];

export const POLICIES: readonly PolicyPage[] = [
  {
    slug: "bao-mat",
    title: "Chính sách bảo mật",
    description: "Cách The Hour Tea thu thập, sử dụng và bảo mật thông tin cá nhân của khách hàng.",
    lines: [
  "The HOUR cam kết nghiêm túc thực hiện trách nhiệm của mình liên quan đến bảo mật thông tin, quyền riêng tư của khách hàng khi bạn tham gia giao dịch với chúng tôi theo các quy định của pháp luật Việt Nam. Chúng tôi nhận biết tầm quan trọng của dữ liệu cá nhân mà bạn đã tin tưởng cung cấp và chúng tôi có trách nhiệm quản lý, thực hiện các biện pháp để bảo vệ trong quá trình sử dụng, tiết lộ với bất kỳ bên thứ ba nào trong phạm vi cho phép và xử lý dữ liệu cá nhân của bạn một cách thích hợp. The HOUR tạo ra chính sách bảo mật này để quý khách có thể hiểu hơn về những cam kết mà The HOUR thực hiện trong việc thu thập, sử dụng và chia sẻ thông tin cũng như việc bảo mật thông tin khách hàng.",
  "1. Mục đích, phạm vi sử dụng và thời gian lưu trữ thông tin:",
  "1.1. Mục đích, phạm vi sử dụng thông tin:",
  "a. Để phục vụ quản lý, điều hành, xem xét và/hoặc xử lý đơn đặt hàng/giao dịch của bạn với chúng tôi hoặc với các bên thứ ba thông qua các đơn vị dịch vụ trung gian.",
  "b. Để giải quyết hoặc tạo điều kiện thuận lợi cho dịch vụ chăm sóc khách hàng, chúng tôi có thể sử dụng các thông tin này để hỗ trợ kịp thời theo các yêu cầu từ bạn.",
  "c. Để phục vụ mục đích xác minh, đánh giá pháp lý hoặc để nhận biết khách hàng.",
  "d. Để lập số liệu thống kê, nghiên cứu nhằm duy trì sổ sách nội bộ hoặc nhằm mục đích phát triển, nâng cao chất lượng phục vụ khách hàng.",
  "e. Để đáp ứng các thủ tục pháp lý hoặc các yêu cầu của cơ quan nhà nước có thẩm quyền khi được yêu cầu mà việc tiết lộ thông tin là cần thiết, đúng với pháp luật.",
  "f. Chúng tôi sẽ có thể thu thập, sử dụng, xử lý dữ liệu cá nhân của bạn phụ thuộc vào từng hoàn cảnh cụ thể mà mục đích đó có thể không được liệt kê ở trên. Tuy nhiên, The HOUR sẽ thông báo cho bạn về mục đích đó tại thời điểm chúng tôi xin sự cho phép của bạn, trừ khi được phép theo các quy định của pháp luật.",
  "1.2. Những người hoặc tổ chức có thể được tiếp cận với thông tin đó:",
  "a. The HOUR biết rằng việc bảo mật thông tin cá nhân của khách hàng là rất quan trọng. Chúng tôi sẽ áp dụng các biện pháp để bảo mật thông tin của bạn. Chúng tôi chỉ cho phép nhân viên của The HOUR, các đối tác của chúng tôi là các đơn vị dịch vụ trung gian như dịch vụ vận chuyển, dịch vụ thanh toán trung gian hoặc theo lệnh của tòa án hay bất kỳ cơ quan nhà nước có thẩm quyền nhằm (i) tuân thủ quy định của pháp luật; (ii) thực thi nghĩa vụ theo các điều khoản quy định tại hợp đồng/giao dịch; (iii) đáp ứng các yêu cầu của bạn về dịch vụ khách hàng; (iv) bảo vệ quyền, tài sản hoặc sự an toàn của chúng tôi và của bạn.",
  "b. Chúng tôi sẽ có thể thu thập, sử dụng, tiết lộ hoặc xử lý dữ liệu cá nhân của bạn phụ thuộc vào từng hoàn cảnh cụ thể mà những cá nhân, tổ chức đó có thể không được liệt kê ở trên. Tuy nhiên, The HOUR sẽ thông báo cho bạn về người tiếp cận và mục đích đó tại thời điểm chúng tôi xin sự cho phép của bạn, trừ khi được phép theo quy định của pháp luật. Các đối tác của chúng tôi cam kết chỉ sử dụng các thông tin này vào mục đích thực thi nghĩa vụ, có lợi cho khách hàng mà không được sử dụng vào mục đích thương mại hay mục đích khác khi chưa có sự đồng ý của chúng tôi và của bạn.",
  "1.3. Chúng tôi sẽ có thể thu thập dữ liệu cá nhân của bạn khi:",
  "a. Khi bạn đặt hàng trên Website và điền họ tên, số điện thoại, email, địa chỉ nhận hàng vào biểu mẫu thanh toán.",
  "b. Khi bạn đồng ý hoặc cung cấp các tài liệu, thông tin liên quan trong lúc tương tác giữa bạn với chúng tôi bao gồm nhưng không giới hạn qua các cuộc gọi điện thoại từ số hotline của The HOUR (có thể được ghi âm lại), email, ứng dụng truyền thông xã hội, thư từ, gặp gỡ trực tiếp.",
  "c. Khi bạn cung cấp ý kiến phản hồi hoặc gửi khiếu nại cho chúng tôi.",
  "d. Các trường hợp trên không nhằm mục đích liệt kê đầy đủ các trường hợp mà chỉ đưa ra một số trường hợp phổ biến về thời điểm dữ liệu cá nhân của bạn có thể bị thu thập.",
  "1.4. Phạm vi thu thập dữ liệu:",
  "a. Dữ liệu cá nhân mà The HOUR có thể thu thập bao gồm: họ tên; địa chỉ email; địa chỉ giao nhận hàng hóa và/hoặc thanh toán; thông tin thanh toán (số thẻ được nhập trên trang của VNPAY, The HOUR không lưu); số điện thoại; hình ảnh, âm thanh hoặc video mở hàng/kiểm tra hàng; các thông tin khác mà bạn nhập khi đặt hàng trên Website của chúng tôi hoặc bất kỳ thông tin nào mà chúng tôi đã thông báo xin sự cung cấp và cho phép từ bạn.",
  "b. Nếu bạn không muốn chúng tôi thu thập thông tin/dữ liệu cá nhân nói trên, bạn có thể không cung cấp hoặc vào bất kỳ lúc nào bằng cách thông báo bằng văn bản hoặc qua email đến chúng tôi. Tuy nhiên, lưu ý rằng việc từ chối hoặc hủy bỏ cho phép chúng tôi thu thập, sử dụng hoặc xử lý dữ liệu cá nhân của bạn có thể làm ảnh hưởng đến giao dịch của bạn với chúng tôi và/hoặc ảnh hưởng đến việc bạn sử dụng các dịch vụ với nền tảng được liên kết tại Website.",
  "c. Chúng tôi không cố ý thu thập thông tin cá nhân của trẻ em dưới 13 tuổi mà không có sự kiểm soát của cha mẹ hoặc người giám hộ hợp pháp. Nếu quý khách dưới 13 tuổi, xin vui lòng không cung cấp cho chúng tôi bất kỳ thông tin cá nhân gì. Nếu chúng tôi xác định được người dùng có độ tuổi dưới 13 và đã gửi thông tin cá nhân mà không có sự kiểm soát của người giám hộ, chúng tôi sẽ xoá bỏ thông tin cá nhân này khỏi dữ liệu của chúng tôi mà không cần thông báo trước.",
  "1.5. Thời gian lưu trữ và cam kết bảo mật:",
  "a. Thông tin giao hàng (họ tên, số điện thoại, email, địa chỉ) trong sổ giao dịch của website được tự động xoá sau 90 ngày kể từ khi đơn hàng được tạo. Đơn hàng đã được ghi vào hệ thống bán hàng của cửa hàng (Sapo) được lưu tại đó theo cách cửa hàng quản lý đơn hàng.",
  "b. Chúng tôi thực hiện các biện pháp bảo mật khác nhau và luôn nỗ lực để đảm bảo sự an toàn dữ liệu cá nhân của bạn trên các hệ thống quản lý của chúng tôi. Dữ liệu cá nhân của bạn sẽ được lưu trữ bằng các mạng bảo mật và chỉ có thể truy cập được bởi một số nhân viên được quyền truy cập đặc biệt. Tuy nhiên, chúng tôi không thể có sự đảm bảo an ninh tuyệt đối bởi các sự cố phát sinh, trường hợp có sự cố xảy ra chúng tôi sẽ dùng mọi biện pháp để khắc phục và hạn chế rủi ro nhất.",
  "c. Chúng tôi cam kết thực hiện duy trì dữ liệu cá nhân đúng quy định của pháp luật. Trong trường hợp cần thiết và trong phạm vi cho phép của pháp luật, chúng tôi có thể tiêu hủy dữ liệu cá nhân của bạn một cách an toàn mà không cần thông báo trước.",
  "2. Thương hiệu và bản quyền",
  "Mọi quyền sở hữu trí tuệ (đã đăng ký hoặc chưa đăng ký) bao gồm nhưng không giới hạn nội dung thông tin và tất cả các thiết kế, văn bản, đồ họa, phần mềm, hình ảnh, video, âm nhạc, âm thanh, biên dịch phần mềm, mã nguồn và phần mềm cơ bản đều là tài sản của chúng tôi. Toàn bộ nội dung của trang web được bảo vệ bởi luật pháp Việt Nam và các công ước quốc tế.",
  "3. Quy định sửa đổi và xoá thông tin",
  "a. Website này không có tài khoản khách hàng. Nếu quý khách muốn thay đổi thông tin đã cung cấp cho một đơn hàng, vui lòng liên hệ với chúng tôi qua email hoặc số hotline của The HOUR để được hướng dẫn và hỗ trợ.",
  "b. Nếu quý khách muốn xoá thông tin cá nhân và lịch sử mua hàng, vui lòng liên hệ với chúng tôi qua email: info@thehourtea.com",
  "4. Thay đổi về chính sách",
  "Chính sách bảo mật thông tin này có thể được thay đổi để phù hợp với nhu cầu của The HOUR cũng như của khách hàng và phù hợp với các quy định của pháp luật mà không cần thông báo trước (nếu có).",
  "5. Đơn vị thu thập, quản lý thông tin:",
  "Công Ty TNHH MTV The Hour",
  "Địa chỉ: 14/8 Lam Sơn, P6, Q. Bình Thạnh, TP. Hồ Chí Minh, Việt Nam",
  "Và hệ thống dữ liệu của các nhà cung cấp dịch vụ mà website sử dụng: hệ thống quản lý bán hàng Sapo, cổng thanh toán VNPAY, và các nhà cung cấp hạ tầng website.",
  "Nếu quý khách có bất kỳ thắc mắc hoặc khiếu nại nào về các quy định bảo mật thông tin khách hàng của chúng tôi hoặc phát hiện thông tin cá nhân của mình bị sử dụng sai mục đích, bị vi phạm thì vui lòng liên hệ qua các kênh như sau để được giải đáp và hỗ trợ:",
  "• Fanpage: https://www.facebook.com/thehourtea",
  "• Hotline: 0383882454 (9:00-16:30 từ thứ 2 đến thứ 6)",
  "• Email: info@thehourtea.com"
],
  },
  {
    slug: "doi-tra",
    title: "Chính sách đổi trả",
    description: "Điều kiện, thời hạn và cách thức đổi hàng, bảo hành sản phẩm của The Hour Tea.",
    lines: [
  "1/ Chính sách hoàn trả:",
  "The HOUR chỉ nhận đổi hàng và bảo hành khi lỗi đến từ nhà sản xuất hoặc do quá trình vận chuyển. Quý khách cần quay lại video mở hàng và kiểm tra chất lượng sản phẩm để làm bằng chứng trong trường hợp muốn liên hệ lại với The HOUR nhằm đổi, trả, bảo hành sản phẩm hoặc khiếu nại các vấn đề liên quan đến sản phẩm mà bạn đã mua.",
  "2/ Hình thức đổi hàng:",
  `Khách hàng có thể gửi video thể hiện sản phẩm bị lỗi từ nhà sản xuất hoặc do quá trình vận chuyển qua Facebook hoặc email (${BUSINESS.email}) của The HOUR. Chúng tôi sẽ liên lạc với bạn để hướng dẫn cách đóng gói hàng hoàn trả. Đồng thời gửi sản phẩm tương đương để thay thế theo chính sách giao hàng, tính từ ngày nhận được yêu cầu đổi trả.`,
  "3/ Thời hạn hoàn trả: chúng tôi chỉ hỗ trợ đổi hàng với điều kiện yêu cầu đổi hàng trong vòng 01 ngày kể từ ngày bạn nhận được hàng. Thời gian xử lý hoàn trả, bảo hành được thực hiện tối đa trong vòng 7 ngày tính từ ngày nhận được yêu cầu của bạn.",
  "4/ Chi phí hoàn trả: The HOUR sẽ chi trả chi phí vận chuyển cho việc đổi trả, bảo hành này.",
  "5/ Cách thức lấy lại tiền: The HOUR chỉ hỗ trợ đổi sản phẩm, và sẽ không hỗ trợ trả hàng, hoàn tiền.",
  "LƯU Ý: The HOUR sẽ không hỗ trợ bảo hành và đổi sản phẩm cho những trường hợp sau:",
  "Đối với trường hợp sản phẩm đã được bóc seal, tem bảo hành đã bể hoặc bị lỗi do quá trình sử dụng của khách hàng.",
  "Đối với sản phẩm pre-order hoặc khuyến mại, giảm giá.",
  "Đối với sản phẩm được mua trực tiếp tại cửa hàng."
],
  },
  {
    slug: "van-chuyen",
    title: "Chính sách vận chuyển",
    description: "Phí vận chuyển, thời gian giao hàng và đơn vị vận chuyển của The Hour Tea.",
    lines: [],
  },
  {
    slug: "thanh-toan",
    title: "Chính sách thanh toán và mua hàng",
    description: "Hình thức thanh toán và quy định khi mua hàng tại The Hour Tea.",
    lines: [],
  },
];

/** The lines to show for a policy. The two rewritten ones are computed so they stay true to the code. */
export function policyLines(p: PolicyPage): string[] {
  if (p.slug === "van-chuyen") return shippingSection();
  if (p.slug === "thanh-toan") return paymentSection;
  return p.lines;
}

export function getPolicy(slug: string): PolicyPage | undefined {
  return POLICIES.find((p) => p.slug === slug);
}

/** For the footer. The checkout's consent line names its own four links by hand, in its own order. */
export const POLICY_LINKS = POLICIES.map((p) => ({ href: `/chinh-sach/${p.slug}`, label: p.title }));

