import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

/** The social card: the Orrery mark (orbit plus one body) over the name and tagline. */
export function renderOgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 56,
          background: "#09090b",
          color: "#f4f4f5",
        }}
      >
        <svg width="220" height="220" viewBox="0 0 22 22">
          <circle cx="11" cy="11" r="6" fill="none" stroke="#f4f4f5" strokeWidth="1.5" />
          <circle cx="15.24" cy="6.76" r="1.8" fill="#3b82f6" />
        </svg>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 120, fontWeight: 700, letterSpacing: -3 }}>{SITE_NAME}</div>
          <div style={{ fontSize: 40, color: "#a1a1aa" }}>{SITE_TAGLINE}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
