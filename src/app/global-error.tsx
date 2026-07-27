"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div
          style={{
            display: "flex",
            height: "100vh",
            alignItems: "center",
            justifyContent: "center",
            background: "#09090b",
            color: "#fff",
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              maxWidth: "28rem",
            }}
          >
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#f87171"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginBottom: "1rem" }}
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              Something went wrong
            </h1>
            <p style={{ color: "#a1a1aa", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
              {error.message || "A critical error occurred."}
            </p>
            <button
              onClick={reset}
              style={{
                padding: "0.625rem 1.25rem",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: "0.375rem",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
