# T0 — Lớp design token

**Mục đích**: trích bảng màu / font / thang kích thước từ trang mẫu của bạn vào `app/globals.css`, **chưa đổi layout**. Làm trước T1/T2 để hai task đó viết luôn đúng ngôn ngữ thị giác cuối, khỏi sơn lại lượt hai.

**Ranh giới rõ ràng**: T0 chỉ đổi *giá trị* (màu, font, bán kính, bóng, thang chữ). Đổi *cấu trúc* (header, grid, card, nav) là T3.2–T3.4. Sau T0, mọi trang hiện tại phải vẫn đúng bố cục cũ, chỉ khác tông.

---

## T0.1 — Nhận tài liệu tham chiếu (việc của bạn)

Tạo `design/reference/` rồi bỏ vào:

```
design/reference/
  site/                  ← Ctrl+S "Webpage, Complete", hoặc: wget -mkp -nH <url>
  shots/
    desktop-home.png     ← screenshot full-page, ~1440px
    desktop-detail.png
    mobile-home.png      ← ~390px
```

Nếu dùng `wget`: `wget -mkp -nH -P design/reference/site <url>` (`-k` sửa link thành tương đối, `-p` tải cả CSS/ảnh/font).

**Lọc rác trước khi commit** — bản lưu "Complete" kéo theo cả JS của site. Thêm vào `.gitignore`:

```gitignore
# Tài liệu tham chiếu giao diện: giữ HTML/CSS/font/ảnh, bỏ JS của site gốc
design/reference/**/*.js
design/reference/**/*.map
```

**Nghiệm thu**: `ls design/reference/site/**/*.css` ra ít nhất một file, và `shots/` có ảnh.

---

## T0.2 — Kiểm kê: trích ra `design/TOKENS.md`

Claude đọc CSS trong `design/reference/site` và lập bảng kiểm kê, **có dẫn nguồn** (file + dòng) cho từng giá trị, để bạn review được là lấy đúng hay đoán:

| Nhóm | Trích gì | Cách trích |
|---|---|---|
| Màu | Top ~15 màu theo tần suất, kèm vai trò đoán được (bg, text, border, accent, danger) | `grep -ohE '#[0-9a-fA-F]{3,8}\|rgba?\([^)]+\)\|hsla?\([^)]+\)' design/reference/site -r \| sort \| uniq -c \| sort -rn` |
| Font | `font-family` stack + `@font-face` (tên file woff2, weight, style) | `grep -rhE '@font-face\|font-family' -A4` |
| Thang chữ | Các `font-size` dùng thật + `line-height`, `letter-spacing`, `font-weight` đi kèm | grep + sort uniq |
| Khoảng cách | Các giá trị `padding`/`margin`/`gap` hay gặp → suy ra bước thang (4/8px?) | grep + tần suất |
| Bán kính | `border-radius` | grep |
| Bóng | `box-shadow` | grep |
| Breakpoint | `@media` | `grep -rhoE '@media[^{]+'` |
| Container | `max-width` của wrapper chính | đọc tay |

`design/TOKENS.md` ghi: giá trị → vai trò → nguồn. Giá trị nào không chắc thì ghi rõ **"cần bạn xác nhận"** thay vì chọn bừa.

**Nghiệm thu**: `design/TOKENS.md` tồn tại; mỗi dòng có nguồn; danh sách "cần xác nhận" nằm ở cuối file.

---

## T0.3 — Chốt dark mode

`app/globals.css` hiện có cặp biến sáng/tối. Trang mẫu của bạn gần như chắc chắn **chỉ có một theme**. Ba lựa chọn, Claude sẽ hỏi lại ở bước này:

| | Hệ quả |
|---|---|
| **Bỏ dark mode** (đơn giản nhất) | Xoá block `prefers-color-scheme` trong `globals.css`. Giao diện giống trang mẫu 100%. |
| Suy ra dark từ token sáng | Đảo luminance, giữ hue/accent. Phải tự kiểm contrast — không có bản mẫu để đối chiếu. |
| Giữ dark hiện tại | Rẻ nhất nhưng hai theme sẽ không cùng một ngôn ngữ thiết kế. |

**Nghiệm thu**: quyết định được ghi vào `design/TOKENS.md` (mục "Dark mode") trước khi sang T0.4.

---

## T0.4 — Áp token vào `app/globals.css`

- Thay khối `:root` hiện có bằng lớp token từ `TOKENS.md`, **đặt tên theo vai trò, không theo màu**: `--bg`, `--surface`, `--text`, `--text-muted`, `--border`, `--accent`, `--accent-text`, `--danger`, `--warn`, `--ok`; `--radius-sm/md/lg`; `--shadow-sm/md`; `--step--1 … --step-4` cho thang chữ; `--space-1 … --space-8`; `--container`.
- **Không đổi tên class nào đang dùng** (`.card`, `.grid`, `.tile`, `.price`, `.stock`, `.alert`, `.crumb`, `.detail`, `.thumb`, …). Mọi khai báo bên trong chuyển sang dùng biến. Mục tiêu: diff của T0 nằm gần hết trong `:root` và trong phần giá trị của các rule, không trong selector.
- Font: nếu trang mẫu dùng Google Fonts → `next/font/google` trong `app/layout.tsx` (self-host, không FOUT, không request sang Google lúc runtime). Nếu dùng font riêng (file woff2) → copy vào `app/fonts/` và dùng `next/font/local`. **Đọc `node_modules/next/dist/docs/` phần font trước khi viết** — API Next 16 có thể khác.
- Giữ `prefers-reduced-motion` nếu thêm transition.

**Nghiệm thu**:
- `npm run typecheck && npm run lint && npm run build`
- `npm run dev` rồi xem 4 trang: `/`, `/products/<alias>`, `/checkout`, `/success?...` — bố cục **không đổi**, chỉ tông màu/chữ đổi.
- `git diff --stat` cho thấy gần như chỉ `app/globals.css` (+ `app/layout.tsx` nếu đổi font).

---

## T0.5 — Ghi chú lại

Thêm vào `CLAUDE.md`, mục "Coding conventions":

> Giao diện dựng từ lớp token trong `app/globals.css` (`--bg`, `--text`, `--accent`, `--step-*`, `--space-*`, …), trích từ trang mẫu trong `design/reference/` và ghi nguồn ở `design/TOKENS.md`. Component mới dùng biến, không hardcode màu hay px.
