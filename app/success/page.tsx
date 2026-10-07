import Link from "next/link";
import { headers } from "next/headers";
import AutoRefresh from "@/components/AutoRefresh";
import ClearCartOnSuccess from "@/components/ClearCartOnSuccess";
import { getOrder, orderStoreKind, overRateLimit, type PendingOrder } from "@/lib/order";
import { formatVnd } from "@/lib/product";
import { describeResponseCode, normaliseIp } from "@/lib/vnpay";

export const dynamic = "force-dynamic";

// The address carries a payment reference. robots.txt already disallows it; this is the second layer,
// for a crawler that arrives through a link anyway.
export const metadata = { title: "Kết quả đơn hàng", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Restyled in T3.6. There is no reference design for this page, so it is built from the same
 * tokens and type as the copied ones. Outside production the "order not found" case also names
 * which store backend is in use, because that one sentence is what distinguishes "this instance
 * never saw the checkout" from "the record expired"; a customer never sees it.
 *
 * T7 added two things: a COD order is finished the moment it exists and must not be described as a
 * confirmed payment, and the money is now broken down (goods, discount, delivery) so the page
 * accounts for the exact amount that was taken.
 */
const TONE: Record<"ok" | "warn" | "err", string> = {
  ok: "border-primary text-[color:var(--ok)]",
  warn: "border-[color:var(--warn)] text-[color:var(--warn)]",
  err: "border-[color:var(--err)] text-[color:var(--err)]",
};

/** What the customer reads for each internal status. The raw value (`sapo_error`…) is not for them. */
const STATUS_LABEL: Record<PendingOrder["status"], string> = {
  pending: "Chờ thanh toán",
  processing: "Đang xử lý",
  completed: "Hoàn tất",
  sapo_error: "Đang chờ ghi nhận đơn",
  cancelled: "Đã huỷ",
  failed: "Thất bại",
};

export default async function ResultPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const outcome = one(sp.outcome); // from /api/vnpay/return, checksum already verified server-side
  const txnRef = one(sp.txnRef);
  const code = one(sp.code);

  // Counted before the order is read, and only when a reference is asked about: this page opens on
  // a guessable reference alone, so the limit is what stops someone walking through references to
  // see what others bought. Same IP source as the API routes. Fails open (see overRateLimit), so a
  // Redis outage never hides a paid order from its customer.
  if (txnRef) {
    const h = await headers();
    const ip = normaliseIp(h.get("x-forwarded-for") ?? h.get("x-real-ip"));
    if (await overRateLimit("result", ip)) return <RateLimited />;
  }

  // Server-side order state is authoritative (set only by the IPN).
  let order: PendingOrder | undefined;
  let storeUnavailable = false;
  if (txnRef) {
    try {
      order = await getOrder(txnRef);
    } catch {
      // A store outage must not be reported as "no such order": the payment may well have gone
      // through, and the IPN will retry. Details stay in the server log.
      storeUnavailable = true;
    }
  }
  const waiting = outcome === "success" && (!order || order.status === "pending" || order.status === "processing");

  let headline: string;
  let tone: "ok" | "warn" | "err";
  let detail: string;

  if (outcome === "invalid") {
    headline = "Không xác minh được phản hồi thanh toán";
    tone = "err";
    detail = "Dữ liệu VNPAY trả về không qua được kiểm tra chữ ký. Không có đơn hàng nào được tạo.";
  } else if (storeUnavailable) {
    headline = "Chưa đọc được trạng thái đơn hàng";
    tone = "warn";
    detail =
      "Không kết nối được tới kho lưu đơn, nên trang này chưa thể nói điều gì đã xảy ra. Nếu thanh toán đã thành công, xác nhận từ VNPAY vẫn sẽ được xử lý. Trang sẽ tự thử lại.";
  } else if (order?.status === "completed" && order.paymentMethod === "cod") {
    // COD has no payment to confirm, so "completed" here means the order exists and the money is
    // still to come. Saying "đã xác nhận thanh toán" would be a lie to the customer and to the shop.
    headline = "Đã nhận đơn hàng — thanh toán khi nhận";
    tone = "ok";
    detail = `Đơn ${order.sapoOrder?.name ?? ""} đã được tạo. Bạn trả ${formatVnd(order.amountVnd)} bằng tiền mặt khi nhận hàng. Shop sẽ gọi để xác nhận.`;
  } else if (order?.status === "completed") {
    headline = "Đã xác nhận thanh toán — đơn hàng được tạo";
    tone = "ok";
    detail = `VNPAY đã xác nhận thanh toán và đơn hàng ${order.sapoOrder?.name ?? ""} đã được tạo.`;
  } else if (order?.status === "sapo_error") {
    headline = "Đã nhận thanh toán — đang chờ đồng bộ đơn";
    tone = "warn";
    detail =
      "Thanh toán đã được xác nhận, nhưng đơn hàng chưa được ghi nhận xong. Hệ thống sẽ tự thử lại; bạn không cần thanh toán lại. Việc này có thể mất vài phút đến vài chục phút: hãy tải lại trang sau ít phút, và nếu đơn vẫn chưa hoàn tất thì liên hệ cửa hàng kèm mã giao dịch bên dưới.";
  } else if (outcome === "cancelled" || order?.status === "cancelled") {
    headline = "Đã huỷ thanh toán";
    tone = "warn";
    detail = "Bạn đã huỷ thanh toán ở VNPAY. Không có đơn hàng nào được tạo.";
  } else if (outcome === "failed" || order?.status === "failed") {
    headline = "Thanh toán thất bại";
    tone = "err";
    detail = `${describeResponseCode(order?.vnpResponseCode ?? code)}. Không có đơn hàng nào được tạo.`;
  } else if (waiting && order) {
    headline = "Đang chờ xác nhận thanh toán…";
    tone = "warn";
    detail =
      "VNPAY báo thành công. Đơn hàng được tạo ngay khi VNPAY xác nhận với hệ thống của chúng tôi; trang này sẽ tự cập nhật, bạn không cần tải lại.";
  } else {
    headline = "Không tìm thấy đơn hàng";
    tone = "err";
    // The customer gets a plain message. Which store backend answered is a developer's question, so it
    // is appended only outside production (it is what tells "this instance never saw the checkout"
    // from "the record expired" while debugging).
    detail =
      "Chưa tìm thấy giao dịch này. Nếu bạn đã thanh toán, đừng thanh toán lại: hãy liên hệ cửa hàng kèm mã giao dịch (nếu có) để được kiểm tra." +
      (process.env.NODE_ENV === "production"
        ? ""
        : orderStoreKind() === "memory"
          ? " [dev] Kho đang là bộ nhớ trong: khởi động lại hoặc instance khác sẽ không thấy đơn."
          : " [dev] Kho dùng chung không có bản ghi này, hoặc nó đã hết hạn.");
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-16">
      {((waiting && order) || storeUnavailable) && <AutoRefresh />}
      {order?.status === "completed" && <ClearCartOnSuccess />}

      <h1 className="font-display mb-5 text-[clamp(1.75rem,4vw,2.75rem)] leading-tight font-normal">{headline}</h1>
      <p className={`rounded-lg border px-4 py-3 text-sm ${TONE[tone]}`}>{detail}</p>

      <dl className="mt-8 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        {txnRef && (
          <>
            <dt className="text-ink-soft">Mã giao dịch</dt>
            <dd className="m-0 font-mono break-all">{txnRef}</dd>
          </>
        )}
        {order && (
          <>
            <dt className="text-ink-soft">Sản phẩm</dt>
            <dd className="m-0">
              {order.lines.map((line) => (
                <div key={line.sku + String(line.variantId)}>
                  {line.productName}
                  {line.variantLabel ? ` (${line.variantLabel})` : ""} × {line.quantity} — {formatVnd(line.unitPriceVnd * line.quantity)}
                </div>
              ))}
            </dd>
            {order.goodsVnd !== undefined && order.goodsVnd !== order.amountVnd && (
              <>
                <dt className="text-ink-soft">Tạm tính</dt>
                <dd className="m-0 font-mono">{formatVnd(order.goodsVnd)}</dd>
              </>
            )}
            {order.discount !== undefined && (
              <>
                <dt className="text-ink-soft">Giảm giá</dt>
                <dd className="m-0 font-mono">
                  {order.discount.code} −{formatVnd(order.discount.amountVnd)}
                </dd>
              </>
            )}
            {order.shipping !== undefined && (
              <>
                <dt className="text-ink-soft">Phí vận chuyển</dt>
                <dd className="m-0 font-mono">
                  {order.shipping.priceVnd === 0 ? "Miễn phí" : formatVnd(order.shipping.priceVnd)}
                </dd>
              </>
            )}
            <dt className="text-ink-soft">{order.paymentMethod === "cod" ? "Thu khi nhận" : "Số tiền"}</dt>
            <dd className="m-0 font-mono">{formatVnd(order.amountVnd)}</dd>
            {/* The delivery address is deliberately NOT shown here. This page is reached with only a
                reference, which is a timestamp plus six digits — guessable — so showing where an order
                is going would let anyone browse addresses. The lookup page asks for the phone number
                as well, and shows it there. */}
            <dt className="text-ink-soft">Trạng thái</dt>
            <dd className="m-0">{STATUS_LABEL[order.status] ?? order.status}</dd>
          </>
        )}
        {order?.vnpTransactionNo && (
          <>
            <dt className="text-ink-soft">Mã VNPAY</dt>
            <dd className="m-0 font-mono break-all">{order.vnpTransactionNo}</dd>
          </>
        )}
        {order?.sapoOrder && (
          <>
            <dt className="text-ink-soft">Mã đơn</dt>
            <dd className="m-0 font-mono">{order.sapoOrder.name}</dd>
          </>
        )}
      </dl>

      {order?.status === "completed" && txnRef && (
        <p className="mt-8 rounded-lg border border-line px-4 py-3 text-sm">
          Lưu lại mã <strong className="font-mono">{txnRef}</strong> — cùng số điện thoại, nó là cách xem lại đơn này và
          địa chỉ giao hàng ở <Link href={`/tra-cuu-don?txnRef=${encodeURIComponent(txnRef)}`}>trang tra cứu đơn hàng</Link>.
        </p>
      )}

      <p className="mt-10 flex flex-wrap gap-6">
        <Link href="/shop" className="text-sm">
          ← Về trang sản phẩm
        </Link>
        <Link href="/tra-cuu-don" className="text-sm">
          Tra cứu đơn hàng
        </Link>
      </p>
    </div>
  );
}

/**
 * Shown instead of the order when the result-page limit is hit. It reads no order and does not
 * auto-refresh — refreshing would only spend more of the limit.
 *
 * The wording blames no one and promises nothing it has not checked: the reader may be a customer
 * on a shared mobile address rather than someone who reloaded, and this page cannot know whether
 * the payment has been confirmed — so it says "do not pay again" and points to the lookup, without
 * claiming the order is being processed.
 */
function RateLimited() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-16">
      <h1 className="font-display mb-5 text-[clamp(1.75rem,4vw,2.75rem)] leading-tight font-normal">
        Tạm thời chưa hiển thị được đơn hàng
      </h1>
      <p className={`rounded-lg border px-4 py-3 text-sm ${TONE.warn}`}>
        Có quá nhiều lượt truy cập từ mạng của bạn nên trang đã ngừng tự cập nhật. Hãy tải lại sau ít phút, hoặc xem
        đơn ở trang tra cứu bằng mã giao dịch và số điện thoại. Nếu bạn đã thanh toán, đừng thanh toán lại.
      </p>
      <p className="mt-10 flex flex-wrap gap-6">
        <Link href="/shop" className="text-sm">
          ← Về trang sản phẩm
        </Link>
        <Link href="/tra-cuu-don" className="text-sm">
          Tra cứu đơn hàng
        </Link>
      </p>
    </div>
  );
}
