// Public listing CDN only; never buyer uploads, credentials or signed URLs.
export function safeListingThumbnail(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^(i|img\d+)\.etsystatic\.com$/.test(url.hostname)
      && !url.username && !url.password && !url.port && !url.search && !url.hash
      ? url.href : null;
  } catch { return null; }
}
