# Thêm một sản phẩm mới — hướng dẫn cho chủ cửa hàng

Dành cho người **không phải lập trình viên**. Không cần cài gì, không cần gõ lệnh. Chỉ dùng
trình duyệt.

Bạn sẽ làm việc ở **hai nơi**, và thứ tự quan trọng:

| | Nơi | Giữ cái gì |
|---|---|---|
| **Bước A** | **Sapo** | Tên, **giá**, **tồn kho**, ảnh chính |
| **Bước B** | **Sanity Studio** | Phần mô tả dài phía dưới trang |

Sapo giữ tiền và hàng. Sanity chỉ giữ chữ và hình trang trí. **Làm Sapo trước**, vì phần
mô tả cần số id mà Sapo sinh ra.

---

## BƯỚC A — Tạo sản phẩm trên Sapo

1. Vào trang quản trị Sapo, tạo sản phẩm mới như bình thường.
2. Điền **tên**, **giá bán**, **số lượng tồn kho**, và tải **ảnh sản phẩm** lên.
3. Đặt trạng thái sản phẩm là **đang hoạt động** (active), **không** để ở dạng nháp/ẩn.

### Ba điều bắt buộc, thiếu là sản phẩm không lên web

- **Trạng thái phải là đang hoạt động.** Website chỉ lấy sản phẩm active; sản phẩm nháp sẽ
  không bao giờ xuất hiện, kể cả khi bạn đã làm xong bước B.
- **Phải có ít nhất một phiên bản (variant)** kèm giá. Sản phẩm không có phiên bản nào bị bỏ qua.
- **Tồn kho phải lớn hơn 0** thì mới có nút "Thêm vào giỏ hàng". Nếu bằng 0, trang vẫn hiện
  nhưng chỗ nút mua sẽ ghi "Hết hàng".

> **Lưu ý:** website chỉ lấy **phiên bản đầu tiên** của mỗi sản phẩm. Nếu bạn tạo nhiều phiên bản
> (95g, 200g…), khách chỉ mua được phiên bản đầu. Đây là giới hạn đã biết của phiên bản hiện tại.

4. Lưu sản phẩm.

**Kiểm tra ngay:** mở website, sản phẩm phải xuất hiện ở trang chủ **ngay lập tức**, không
phải chờ. Giá và tồn kho luôn đọc thẳng từ Sapo.

Lúc này trang sản phẩm đã bán được rồi, chỉ là phần mô tả phía dưới còn trống.

### Lấy "số id sản phẩm" — con số bạn cần cho bước B

Mở sản phẩm vừa tạo trong trang quản trị Sapo và **nhìn lên thanh địa chỉ của trình duyệt**.
Cuối địa chỉ có một dãy số dài, ví dụ:

```
.../admin/products/92442610
                   ^^^^^^^^  đây là số id sản phẩm
```

Bôi đen dãy số đó rồi copy. **Chép chính xác, đừng gõ tay** — sai một chữ số thì phần mô tả
sẽ không hiện, mà cũng không báo lỗi gì cả.

> Nếu thanh địa chỉ không có số nào, hãy nhắn cho người làm kỹ thuật để lấy giúp. Đừng đoán.

---

## BƯỚC B — Tạo phần mô tả trên Sanity Studio

Mở: **https://vnpay-sapo-poc.sanity.studio/**

### Cách nhanh nhất: nhân bản một sản phẩm cũ

Đừng dựng lại từ đầu. Khung nội dung gồm 5 phần, nhân bản thì có sẵn hết, bạn chỉ sửa chữ.

1. Trong danh sách bên trái, chọn **Nội dung sản phẩm**.
2. Bấm vào một mục đã có, ví dụ **Test Product 1 — nội dung sản phẩm**.
3. Tìm nút menu dấu **⋮** (hoặc **…**) của tài liệu, chọn **Duplicate** (Nhân bản).
   Bạn sẽ có một bản sao y hệt.
4. Trong bản sao, sửa **đúng ba ô ở trên cùng**:

   | Ô | Điền gì |
   |---|---|
   | **Tên nội bộ** | Tên để bạn dễ tìm, ví dụ `Trà Sen — nội dung sản phẩm`. Khách **không** nhìn thấy ô này; tên hiện trên web luôn lấy từ Sapo. |
   | **Sapo product id** | **Dán dãy số** bạn copy ở bước A. Đây là ô quan trọng nhất. |
   | **Alias trong Sapo (tham khảo)** | Phần đuôi địa chỉ trang sản phẩm, ví dụ `tra-sen`. Chỉ để bạn nhận ra, không ảnh hưởng gì. |

   > Nếu bạn dán nhầm id của một sản phẩm đã có mô tả, Studio sẽ báo đỏ:
   > *"Đã có nội dung khác dùng product id này. Mỗi sản phẩm chỉ một tài liệu."*
   > Đó là hệ thống đang bảo vệ bạn. Kiểm tra lại số id.

5. Kéo xuống phần **Khối nội dung** và sửa chữ trong 5 khối cho đúng sản phẩm mới.

### Năm khối trong khung, theo đúng thứ tự

| Thứ tự | Tên khối trong Studio | Dùng để |
|---|---|---|
| 1 | **Các bước** | Hướng dẫn pha, 5 bước. Số thứ tự **tự đánh**, bạn không phải nhập. |
| 2 | **Câu hỏi thường gặp** (tiêu đề: Mô tả sản phẩm) | Hương vị · Thành phần · Pha trà · Bảo quản |
| 3 | **Dãy ô đặc điểm** | 3 ô, mỗi ô một ảnh + tên + mô tả ngắn |
| 4 | **Bảng so sánh** (tiêu đề: Gợi ý pha) | Bảng 2 cột: lượng trà, nhiệt độ, thời gian hãm… |
| 5 | **Câu hỏi thường gặp** | 5 câu hỏi của khách và câu trả lời |

Bạn được phép **xoá bớt, thêm, hoặc kéo đổi thứ tự** các khối tuỳ ý. Kéo bằng chấu bên trái
mỗi khối.

### Khi thêm ảnh

Mỗi ảnh đều có ô **Mô tả ảnh (alt)** và ô này **bắt buộc**. Hãy viết *cái gì đang có trong ảnh*,
không phải tên khối.

- Nên: `Ống giấy kraft nhãn trắng, trà Sen 95g đặt trên nền be`
- Không nên: `Ảnh 1`, `trà ngon`, `80% polyphenol`

Lý do: người khiếm thị dùng phần mềm đọc màn hình, và họ chỉ nghe được câu bạn viết ở đây.

### Lưu lại

Bấm **Publish** (Xuất bản). Nếu nút còn xám thì còn ô bắt buộc chưa điền — Studio sẽ khoanh đỏ
ô đó.

---

## Kiểm tra kết quả — bước này đừng bỏ qua

Mở trang sản phẩm trên website:

```
https://vnpay-sapo-poc.vercel.app/products/<alias-của-bạn>
```

**Tải lại trang một lần nữa.** Lần mở đầu tiên sau khi Publish đôi khi vẫn còn hiện bản cũ; lần
thứ hai mới ra bản mới. Hệ thống cố ý làm vậy cho trang nhanh.

Bạn phải thấy đủ: phần hướng dẫn pha, mục mô tả mở ra đóng vào được, 3 ô đặc điểm có ảnh, bảng
gợi ý pha, và phần câu hỏi thường gặp.

---

## Khi không như ý

| Hiện tượng | Nguyên nhân thường gặp |
|---|---|
| Sản phẩm **không có trên web** | Trạng thái còn là nháp, hoặc chưa có phiên bản/variant nào |
| Có trang sản phẩm nhưng **không có nút mua** | Tồn kho đang bằng 0 → trang ghi "Hết hàng" |
| Có trang, **phần mô tả trống trơn** | **Sai số id.** Mở lại Studio, so từng chữ số với thanh địa chỉ bên Sapo |
| Sửa chữ xong mà web **vẫn hiện bản cũ** | Tải lại trang thêm một lần. Vẫn vậy thì kiểm tra đã bấm Publish chưa |
| Mô tả **hiện lúc đầu rồi biến mất** ở lần tải sau | Chờ 5 phút rồi tải lại. Nếu vẫn trống, báo người kỹ thuật — đây là sự cố đã biết và đã được sửa ngày 2026-10-02 |
| Studio báo đỏ ô id | Sản phẩm đó đã có một tài liệu mô tả rồi. Tìm và sửa tài liệu cũ, đừng tạo cái thứ hai |
| **Ảnh biến mất hết** sau một lần cập nhật kỹ thuật | Đây là việc của người kỹ thuật, không phải lỗi của bạn — xem mục "projection" trong `CLAUDE.md` |

**Điều quan trọng nhất cần nhớ:** sai số id **không báo lỗi**. Trang vẫn chạy, vẫn bán được,
chỉ là phần mô tả trống. Nên lần nào cũng phải mở trang ra xem.

---

## Những điều bạn không bao giờ phải lo

- **Sửa trên Sanity không thể làm sai giá hay sai tồn kho.** Hai thứ đó chỉ nằm ở Sapo.
- **Sửa trên Sanity không thể làm sập trang bán hàng.** Nếu phần mô tả gặp sự cố, trang vẫn
  hiện giá, tồn kho và nút mua như thường.
- **Không cần ai deploy lại** sau khi bạn Publish. Nội dung lên thẳng.
