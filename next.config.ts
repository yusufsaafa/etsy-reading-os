import type { NextConfig } from "next";
const config: NextConfig = {
  ...(process.env.NODE_ENV === "development" ? {
    allowedDevOrigins: ["slim-freedom-ferry-accommodation.trycloudflare.com"],
  } : {}),
  poweredByHeader: false,
  // Trusted server resources must accompany deployment; never resolve from public/ or network.
  outputFileTracingIncludes: { "/**": ["./resources/fonts/**/*"] },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] },
    // Native form POSTs under no-referrer can send Origin: null. Preserve
    // same-origin validation for the development acceptance sign-in page.
    ...(process.env.NODE_ENV === "development" ? [{
      source: "/sign-in", headers: [{ key: "Referrer-Policy", value: "same-origin" }],
    }] : [])];
  },
};
export default config;
