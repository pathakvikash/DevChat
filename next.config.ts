import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The sanity suite builds elsewhere so it can run beside `next dev` in this checkout.
  ...(process.env.SANITY_DIST_DIR && { distDir: process.env.SANITY_DIST_DIR }),
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://lh3.googleusercontent.com; connect-src 'self' https: https://cdn.jsdelivr.net; frame-src 'self';",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      // After the entry above, so it wins for this path (the last matching entry does). A model-written page
      // runs with no origin, no network and no frames.
      {
        source: "/api/conversations/:id/artifacts/:artifactId/html",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; worker-src 'none'; frame-ancestors 'self'",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
