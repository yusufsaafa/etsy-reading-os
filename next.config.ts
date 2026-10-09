import type { NextConfig } from "next";
// Acceptance hosts are explicit local environment data, never production trust rules.
const config: NextConfig = {
  ...(process.env.NODE_ENV === "development" ? {
    allowedDevOrigins: (process.env.READING_OS_DEV_ORIGINS ?? "").split(",").map(host => host.trim()).filter(host => /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/i.test(host)),
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
    // Keep Studio fetches/server actions same-origin, including through a local proxy.
    { source: "/settings/pdf-design", headers: [{ key: "Referrer-Policy", value: "same-origin" }] },
    // Native form POSTs under no-referrer can send Origin: null. Preserve
    // same-origin validation for the development acceptance sign-in page.
    ...(process.env.NODE_ENV === "development" ? [{
      source: "/sign-in", headers: [{ key: "Referrer-Policy", value: "same-origin" }],
    }, {
      source: "/onboarding/:path*", headers: [{ key: "Referrer-Policy", value: "same-origin" }],
    }] : [])];
  },
};
export default config;
