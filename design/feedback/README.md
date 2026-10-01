# Phản hồi giao diện

Nơi bỏ ảnh chụp màn hình có chú thích để yêu cầu sửa layout.

## Cách dùng

1. `Win + Shift + S` chụp trang cần sửa.
2. Mở bằng Paint / Snipping Tool, vẽ mũi tên, khoanh vùng, ghi chữ lên đúng chỗ.
3. Lưu vào thư mục này, đặt tên theo trang: `product-page-1.png`, `checkout-2.png`, `blog-mobile-1.png`.
4. Nhắn: "xem `design/feedback/<tên file>`".

## Mẹo để sửa được ngay từ lần đầu

- **Ghi rõ hướng, không chỉ "xấu"**: "to quá" → "giảm còn khoảng một nửa"; "lệch" → "canh giữa"; "chật" → "giãn gấp đôi khoảng cách".
- **Chụp cả desktop và mobile** nếu chỗ đó khác nhau giữa hai khổ. Thu trình duyệt còn ~390px để xem bản mobile.
- **Một ảnh nhiều ghi chú vẫn tốt hơn nhiều ảnh**, miễn là mỗi ghi chú chỉ về một chỗ.
- Nếu chỉ là màu hoặc cỡ chữ thì **không cần ảnh** — nói tên trang và phần tử là đủ.

## Những phần tử đã có tên trong code

Nói tên này là chính xác nhất, khỏi mô tả:

| Trang | Phần |
|---|---|
| Mọi trang | thanh thông báo (`Freeship…`), header, nav, nút `Cart (n)`, footer |
| `/` | tiêu đề lớn "Shop Tất Cả Sản Phẩm", thanh "Sắp xếp theo", lưới sản phẩm, thẻ sản phẩm (ảnh / giá / tên) |
| `/products/[handle]` | breadcrumb, ảnh sản phẩm, cột phải (SKU, tên, giá, dòng phí vận chuyển, tồn kho), bộ đếm số lượng, nút "Thêm vào giỏ hàng", nút "Mua ngay", mục "Mô tả sản phẩm" |
| Giỏ | drawer bên phải: tiêu đề "Giỏ hàng", dòng hàng, "Tổng phụ", nút "Tiếp tục thanh toán" |
| `/checkout` | form bên trái, cột tóm tắt đơn bên phải |
| `/success` | tiêu đề trạng thái, thẻ thông báo, bảng chi tiết |
| `/blog` | dải hero "Nhâm nhi và đọc", lưới bài viết, thẻ bài viết |
| `/blog/[slug]` | tiêu đề, dòng ngày/tác giả, ảnh bìa, thân bài, danh sách thẻ |
| Khối CMS | văn bản, slider ảnh, bảng thông số, câu hỏi thường gặp, video, khối nhấn mạnh |

## Lưu ý

Giá trị màu, cỡ chữ, khoảng cách, bán kính đều nằm trong `@theme` ở đầu `app/globals.css`. Sửa một token là đổi đồng loạt toàn site — thường đó là thứ bạn muốn, thay vì sửa lẻ một trang.
