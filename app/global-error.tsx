"use client";

/**
 * The last resort: it replaces the root layout when the layout itself throws, so it must bring its
 * own <html> and <body> and cannot rely on the app's stylesheet (Next documents that global-error
 * does not include global styles). Hence the small inline styles, and nothing but plain markup.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="vi">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: "#f3f0ec",
          color: "#0b1012",
        }}
      >
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "96px 16px" }}>
          <h1 style={{ fontSize: 28, fontWeight: 500, margin: "0 0 16px" }}>Có lỗi xảy ra</h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, margin: "0 0 24px" }}>
            Cửa hàng tạm thời không hiển thị được. Nếu bạn đang thanh toán, đừng thanh toán lại: hãy thử tải lại sau ít
            phút.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              cursor: "pointer",
              padding: "10px 20px",
              borderRadius: 999,
              border: "1px solid #0b1012",
              background: "transparent",
              color: "inherit",
              fontSize: 14,
            }}
          >
            Thử lại
          </button>
          {error.digest !== undefined && (
            <p style={{ marginTop: 40, fontFamily: "monospace", fontSize: 12 }}>Mã lỗi: {error.digest}</p>
          )}
        </main>
      </body>
    </html>
  );
}
