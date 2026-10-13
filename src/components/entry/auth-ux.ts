export function safeAuthDestination(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20]/.test(value)) return "/onboarding";
  try { const url = new URL(value, "https://reading.invalid"); if (url.origin !== "https://reading.invalid" || /^\/(sign-in|sign-up|verify-email|forgot-password|reset-password)(\/|$)/.test(url.pathname)) return "/onboarding"; return url.pathname + url.search + url.hash; } catch { return "/onboarding"; }
}
export function otpDigits(value: string): string { return value.replace(/[^0-9]/g, "").slice(0, 6); }
