# The Hour Tea — Design Reference

## Source and scope

- [Figma source: 02 - Core website pages](https://www.figma.com/design/WSdaP4RIo7Qg8oyKRMverX/?node-id=216-168)
- File key: `WSdaP4RIo7Qg8oyKRMverX`
- Referenced page: `216:168`
- Primary homepage: `253:2318` (`Home`)
- Inspected: 1 October 2026.

This document describes the actual frames on the linked canvas, including the homepage and supporting commerce and editorial pages. Measurements, font values, colors, and copy below come from Figma node properties. Visual direction is based on the inspected homepage and shop renders. Responsive and interaction guidance is explicitly marked as a recommendation; those behaviors are not established by static desktop frames.

## Design direction

Create a quiet, contemporary Vietnamese tea brand experience. The design balances generous open space, restrained sans-serif typography, warm photography, and clear amber actions. Product packaging carries its own color and decorative lettering; the interface stays simple around it.

The homepage moves from the intimacy of holding a cup, through teas for different moments of the day, to seasonal stories, tea origins, everyday rituals, and journal content. Preserve that narrative rhythm and the contrast between cream sections, dark editorial sections, and full-width photographs.

- Warm, tactile photographs: ceramic cups, amber tea, sunlight, tea leaves, hands, and paper packaging.
- Large regular-weight headings, compact uppercase labels, and relaxed body copy.
- Flat surfaces, thin dividers, mostly square corners, and small radii on images and controls.
- Product and article cards are open compositions, without enclosing panels or prominent shadows.
- Vietnamese is the principal interface language. Preserve diacritics and intentional headline line breaks.

## Color system

Use the active colors from the referenced canvas. The Figma file also contains other directional palettes; their existence does not make them part of this page's interface palette.

| Role | Figma variable | Value | Usage |
| --- | --- | --- | --- |
| Background / cream | `sp-cream` | `#F3F0EC` | Main canvas, light sections, navigation capsules, origin-story panel |
| Ink | `sp-ink` | `#0B1012` | Primary text, dark editorial strip, footer |
| Amber action | `sp-light` | `#F1A400` | Primary actions, selected shop filter, newsletter action |
| White | `ab-white` | `#FFFFFF` | Supporting light surfaces and reversed text where applicable |
| Logo black | Literal paint | `#000000` | Vector logo details |

The homepage benefits divider uses ink at 22% node opacity. Use subdued hairlines consistent with their surrounding section, rather than treating every divider as solid ink.

The hero photograph has a black gradient scrim with alpha stops of 16% at 0%, 34% at 40%, 34% at 65%, and 52% at 100%. Match the Figma gradient orientation when implementing; this is a photographic readability treatment.

Suggested implementation names, mapped to the verified values:

```css
:root {
  --color-paper: #f3f0ec;
  --color-ink: #0b1012;
  --color-action: #f1a400;
  --color-white: #ffffff;
  --color-divider: rgb(11 16 18 / 22%);
}
```

## Typography

All inspected interface text uses **Manrope**, primarily Regular (400) and Medium (500). The lettering printed on product packaging is image content, not an interface font.

| Role | Weight | Size / line height | Reference |
| --- | --- | --- | --- |
| Homepage hero | 400 | 48 / 58 px | “Chậm một chút. / Đậm một giờ.” |
| Main page and section heading | 400 | 48 / 62 px | Shop heading, product title, origin story |
| Benefits section heading | 400 | 36 / 47 px | “Một khoảng trà, nhiều cách tận hưởng.” |
| Subheading / price emphasis | 400 | 30 / 34 px | Product price, founder name, article subheadings |
| Product card title | 400 | 26 / 35 px | Catalogue cards |
| Benefit-card title | 400 | 26 / 30 px | Product benefits |
| Homepage benefit title | 400 | 22 / 30 px | Four ritual benefits |
| FAQ / story copy | 400 | 20 / 26 px | FAQ questions, origin story paragraph |
| Article body | 400 | 18 / 28 px | Brewing guide |
| Hero supporting copy | 400 | 18 / 26 px | Homepage introduction |
| Product chapter supporting copy | 400 | 18 / 23 px | Homepage product introduction |
| Standard body | 400 | 16 / 24 px | Descriptions, footer links, forms |
| Product metadata | 400 | 16 / 22 px | Flavor notes, price and weight |
| Action / card link | 500 | 14 / 20 px | “XEM TRÀ →”, commerce actions |
| Eyebrow / navigation label | 500 | 12 / 16 px | Navigation, categories, field labels |
| Small editorial action | 500 | 12 / 20 px | Seasonal promotional links |
| Legal text | 400 | 12 / 16 px | Footer registration information |

Tracking is generally zero. Uppercase labels gain their character from size, weight, and spacing around them rather than wide letter spacing. Some contact text uses 34 px and 22 px with 115% line height. Do not flatten these local exceptions into the main heading scale.

## Layout and spacing

The desktop reference width is **1920 px**. Treat these as reference measurements, not mandatory fixed browser dimensions.

- Primary content inset: **96 px** per side, leaving **1728 px**.
- Navigation and homepage journal inset: **40 px**, leaving **1840 px**.
- Shared internal-page header: **124 px** high; navigation sits at x=40, y=32 and is **60 px** high.
- Three-column grid: **544 px** columns with **48 px** gaps.
- Four-column grid: **396 px** columns with **48 px** gaps.
- Main spacing variables: **8, 12, 16, 24, 32, 40, 48, 64, 96 px**.
- Large homepage section padding also uses **112 px**; the contact layout uses **128 px**.
- Radius variables: **0, 4, 6 px**. Main surfaces are square; product images commonly use 4 px, navigation capsules 6 px.
- Repeated divider thickness: **1 px**.

Use flexible column layouts with explicit gaps. Full-width photographic sections should extend beyond the constrained content grid. Match proportions and text wrapping before forcing exact section heights on smaller screens.

## Homepage

Frame `253:2318`: **1920 × 5225 px**. Section order below follows the actual canvas positions; the numbered layer names do not consistently reflect visual order.

| Order | Section | Node | Height | Composition |
| --- | --- | --- | --- | --- |
| 1 | Hero | `253:2319` | 880 px | Two photographs, centered copy, floating navigation |
| 2 | Three tea moments | `253:2341` | 1340 px | Heading row and staggered three-column products |
| 3 | Seasonal editorial / offers | `253:2356` | 500 px | Two equal dark editorial columns |
| 4 | Origin story | `253:2380` | 920 px | Full-width tea harvest photograph with cream inset panel |
| 5 | Benefits | `253:2387` | 414 px | Heading and four icon-and-copy columns |
| 6 | Journal | `253:2435` | 626 px | Introduction column and two article features |
| 7 | Footer | `253:2450` | 545 px | Links, contact, newsletter, legal row |

### Hero

- Two **960 × 880 px** image halves: hands holding a ceramic cup on the left; light passing through tea on the right.
- Navigation at **40 px** from the sides and **32 px** from the top.
- Centered copy container: **720 × 268 px**, positioned at x=600, y=306.
- Headline: “Chậm một chút.\nĐậm một giờ.”
- Supporting copy: “Trà Việt cho từng khoảnh khắc.\nTìm hương vị bạn yêu, theo nhịp của riêng mình.”
- Vertical copy gaps: **24 px**.
- Centered amber action: **202 × 52 px**, 24 px horizontal and 16 px vertical padding, 4 px radius. Visible label: “TÌM VỊ TRÀ CỦA BẠN”.
- Light text sits over the photographic scrim.

### Three tea moments

- Cream background; **112 px** top and bottom padding, **96 px** side padding.
- Heading: “Một ngày.\nNhiều vị để yêu.” A supporting paragraph occupies the right column.
- **56 px** separates the chapter heading from the product composition.
- Three **544 px** columns with **48 px** gaps.
- Columns are staggered through top padding: **0, 104, 208 px**.
- Moment labels: **07:00 / RẠNG RỠ**, **14:00 / THƯ THÁI**, **20:00 / ẤM ÁP**.
- Products shown: Trà Lài, Oolong Hương Sữa, Trà Cam Quế.
- Each product combines a square photograph, name, flavor notes, hairline, price, and right-aligned “XEM TRÀ →”.

### Seasonal stories and offers

- Full-width dark ink section with two columns, **960 px** and **959 px**, separated by a **1 px** divider.
- Each story combines small category metadata, a square image, heading, brief description, and text action.
- Left story: “New Season, New Hour”. Right story: “Giá hời bất ngờ - Trà thơm đợi bạn”.
- Use the rendered composition as the alignment reference: nested story frames sit at y=48 despite differing parent padding values.

### Origin story

- Full-bleed **1920 × 920 px** photograph of a hand picking tea leaves.
- Cream panel: **704 × 494 px**, positioned at x=1120, y=272; **64 px** internal padding and **32 px** content gaps.
- Eyebrow: “ỦNG HỘ NGHỆ NHÂN TRÀ VIỆT”.
- Heading: “Vị ngon bắt đầu\ntừ một chiếc lá.”
- Paragraph introduces the care of Vietnamese tea makers; amber action: “GẶP GỠ THE HOUR →”.

### Benefits and journal

- Benefits: one hairline, 36 px heading, then four **396 px** columns separated by **48 px**.
- Use fine outline icons above “Khởi đầu ngày mới”, “Sau một bữa ngon”, “Khám phá hương vị”, and “Dành một giờ cho mình”.
- Journal uses **40 px** side insets and **32 px** column gaps: **384 px** introduction plus two **696 px** features.
- Article features use large landscape images, a compact title, and “BÀI VIẾT →”. Preserve the source image/title pairings unless editorial content is intentionally updated.

## Shared components

### Header and exploration menu

- Left navigation capsule: approximately **266 × 60 px**, 6 px radius, cream fill; a **34 × 34 px** vector logo followed by “CHỌN TRÀ” and “KHÁM PHÁ”.
- Left capsule uses **16 px** side padding and **40 px** gaps.
- Right cart capsule: **109 × 60 px**, 6 px radius, “GIỎ HÀNG (0)”.
- The homepage floats these over photography. Internal pages place them within a cream header shell.
- Open menu frame `259:664`: **1920 × 1080 px**. Its **499 px** menu panel follows the header and shows two navigation groups, an editorial feature, and “ĐÓNG ×”; underlying photography is dimmed.
- Menu groups cover brand story, journal, brewing guides, partnerships and gifts, and contact.

### Product cards

- Catalogue card reference `223:523`: **544 × 688 px** with **16 px** vertical gaps.
- Photograph: **544 × 544 px**, 4 px radius.
- Title: 26 / 35 px; flavor notes and metadata: 16 / 22 px.
- Hairline precedes the price-and-link row. Price sits left; “XEM TRÀ →” sits right.
- Keep the image, title, and action linked to the same product destination.

### Actions, filters, and quantities

- Amber is the primary action fill, with dark text and compact labels.
- Common action heights are **52 px** and **56 px**. Radius varies by instance: homepage actions use 4 px; several form and commerce actions are square.
- Selected shop filter is amber; unselected filters use restrained outlines on cream. Filter gap: **12 px**; height approximately **36–38 px**.
- Quantity stepper reference: **144 × 48 px** with decrement, current count, and increment.

### Forms

- Fields are visually open, with a label, input text, and a bottom hairline.
- Standard field reference: **73 px** overall height, **8 px** label-to-surface gap, **49 px** input surface.
- Textarea reference: **168 px** overall, including **144 px** surface.
- Form stacks use **24 px** gaps. B2B form width: **800 px**.
- Required labels use an asterisk; optional fields are identified in their labels.

### Footer

- Full dark ink background, **545 px** high in the reference.
- Main grid: **480 px** high; **1440 px** links/brand region and **480 px** newsletter region.
- Main padding: **40 px**. Newsletter has a vertical dividing rule and **24 px** content gaps.
- Links cover tea shopping, gifting, brewing, brand story, journal, and contact. Contact details and business registration appear as compact text.
- Newsletter uses a bottom-rule email field and amber “THAM GIA” action.
- A **1 px** divider precedes the **64 px** copyright/policies row.
- Checkout uses a separate compact policy footer rather than this full footer.

## Supporting pages

| Page | Node | Desktop dimensions | Structure |
| --- | --- | --- | --- |
| Shop / Collection | `222:133` | 1920 × 2615 px | Header, introduction and filters, six-product grid, footer |
| Product / Trà Lài | `222:188` | 1920 × 2759 px | Overview, product story and benefits, FAQ, footer |
| About / Câu chuyện The Hour | `222:243` | 1920 × 3231 px | Brand hero, story and founder, timeline, product principles, footer |
| Wholesale / B2B | `222:298` | 1920 × 2912 px | Hero, services, four-step process, inquiry, footer |
| Journal / Nhâm nhi & đọc | `222:353` | 1920 × 2957 px | Banner, featured story, topic navigation and article grid, footer |
| Article / Cách pha trà Ô Long | `222:408` | 1920 × 3259 px | Article header, image, body, temperature callout, related stories, footer |
| Contact / Liên hệ | `222:463` | 1920 × 1871 px | Contact information and form, closing message and social links, footer |
| Cart / Giỏ hàng | `259:640` | 1920 × 1577 px | Product lines and order summary, footer |
| Checkout / Thông tin & thanh toán | `259:652` | 1920 × 1655 px | Delivery and payment fields, order summary, compact policy footer |
| Empty cart | `259:676` | 1920 × 1139 px | Empty-state message, return-to-shop action, footer |

### Commerce details

- Shop intro is **378 px** high. Catalogue section is **1568 px**, with **64 px** top/bottom padding. The grid has three columns, **48 px** column gaps and **64 px** row gaps.
- Six products: Trà Lài, Oolong Hương Sữa, Trà Cam Quế, Bá Tước Oải Hương, Trà Gạo Lứt Rang, Oolong Quế Hoa.
- Product overview uses an **832 × 832 px** gallery image, **64 px** column gap, and an **832 px** information column with **48 px** horizontal inset.
- Product information includes title, price, description, four package options, quantity, full-width add-to-cart action, and shipping information.
- Product story has three **544 px** benefit panels. FAQ uses a **1120 px** content region starting at x=400, with five questions and plus affordances.
- Cart uses **1024 px** product and **608 px** summary columns with a **96 px** gap. Product thumbnails are **144 × 144 px**; summary padding is **32 px**.
- Checkout uses a **960 px** delivery/payment column and a **672 px** remaining summary allocation, separated by **96 px** within the 1728 px content width.
- Checkout fields cover name, phone, email, address, province/city, ward/commune, and optional notes. Payment options shown are COD and online payment through ZaloPay / card.
- Summary includes product lines, promotion-code entry, subtotal, shipping, total, and an order action showing the total.
- Prices, shipping messages, promotions, contact details, and payment options are sample design content. Connect them to current store data when implementing.

### Editorial, brand, and contact details

- About page: **760 px** hero; **828 px** story/founder section; **340 px** timeline; **634 px** product-principles section.
- Founder section pairs a **736 px** narrative column with a **600 × 700 px** portrait. Timeline has four **396 px** milestone columns.
- B2B hero pairs copy with an **800 × 520 px** project image. Three service cards cover business gifts, tea ingredients, and product/packaging R&D.
- B2B inquiry form fields: name, email, company, and project details. Submit label: “GỬI YÊU CẦU →”.
- Journal featured story pairs a **672 × 320 px** image with an **864 px** copy column and **96 px** gap.
- Article heading region is **1120 px** wide at x=400. Body copy is **800 px** wide at the same left inset; retain this narrower reading measure. Hero image is **1280 × 460 px**.
- Contact uses **128 px** section padding, a **608 px** information column, **128 px** gap, and **800 px** message form. Form includes topic, name, email, optional company, message, and contact-consent copy.

## Imagery and assets

- Use the original Figma photography and logo assets when building from this design.
- Product images center cylindrical tea packaging against quiet beige backgrounds; lifestyle variants retain ceramics, fabric, dried flowers, and warm natural light.
- Preserve image crops and focal points. Use cover behavior for editorial photography; confirm packaging remains fully visible in product crops.
- Homepage origin photography is panoramic and retains the hand and leaves to the left of the text panel.
- Icons are delicate outlines; the logo is a vector asset. Export these rather than approximating them with text symbols.
- No local asset bundle is included with this document. Figma is the source of truth for the exact photography and vector files.

## Responsive guidance — recommended

No separate mobile or tablet frames were identified on the linked page. The following is an implementation proposal, not a measured Figma specification.

- Use fluid containers and reduce side padding progressively from the desktop reference to approximately 20–24 px on narrow screens.
- Reduce the product grid to two columns at medium widths and one column when cards become cramped.
- Remove the homepage product stagger when stacking; keep the chronological 07:00, 14:00, 20:00 order.
- Stack seasonal stories, product overview, B2B inquiry, contact, cart, and checkout columns in reading order.
- Reposition the origin-story panel below or within a resized photograph when its desktop overlay no longer fits.
- Change the benefits grid from four columns to two, then one if needed. Stack the journal introduction above its features.
- Retain the main headline emphasis with fluid type; avoid fixed text heights that clip Vietnamese copy.
- Let filter and package options wrap or scroll horizontally without shrinking labels illegibly.
- Stack footer regions and newsletter; preserve access to policies and contact information.

## Interaction and accessibility — recommended

Static frames establish resting, selected-filter, populated-cart, empty-cart, checkout, and open-menu appearances. Hover, focus, loading, error, success, and expanded FAQ states still require implementation decisions.

- Use semantic links for navigation and buttons for state-changing actions.
- Provide keyboard-operable exploration menu and FAQ controls, visible focus, Escape-to-close behavior, and appropriate expanded-state attributes.
- Implement filters and package options with programmatic selected states.
- Associate field labels with inputs; required fields need validation and readable inline errors. Keep entered values on failed submission.
- Give the quantity buttons accessible names and enforce valid quantities. Update displayed totals from store data.
- Define form submission, newsletter feedback, cart removal, payment handoff, and order confirmation behavior before release.
- Enlarge small visual controls to comfortable touch targets without changing their typography.
- Check text contrast over the actual image crops; retain the hero scrim and cream navigation surfaces.
- Use meaningful alt text for informative photography and products; hide decorative iconography from assistive technology.
- Respect reduced-motion preferences if transitions are added. Animation timing is not specified by this design.

## Fidelity checklist

- [ ] Manrope Regular and Medium loaded with full Vietnamese character support.
- [ ] Active palette matches cream `#F3F0EC`, ink `#0B1012`, and amber `#F1A400`.
- [ ] Homepage follows the measured visual section order.
- [ ] Desktop content widths, column gaps, image ratios, and product stagger match the reference.
- [ ] Navigation capsules, primary actions, product imagery, and hairlines retain their distinct geometry.
- [ ] Original assets and visible copy are used; stale layer names do not override actual text content.
- [ ] Responsive layouts preserve reading order and avoid clipping or horizontal overflow.
- [ ] Commerce data and functional states are connected and verified separately from static design fidelity.

