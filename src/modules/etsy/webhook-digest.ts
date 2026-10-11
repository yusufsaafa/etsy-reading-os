import {createHmac, timingSafeEqual} from "node:crypto";

// Header grammar follows Standard Webhooks v1 as an explicitly authorized
// interoperability assumption. Etsy Portal wire compatibility is NOT VERIFIED.
export const MAX_WEBHOOK_BODY_BYTES = 65_536; // Application bound, not an Etsy limit.
const TOLERANCE_SECONDS = 300;

function decodeBase64(value: string): Buffer | undefined {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64");
  const canonical = decoded.toString("base64");
  if (value !== canonical && value !== canonical.replace(/=+$/, "")) return undefined;
  return decoded;
}

/** Verify one already-separated Base64 digest using the Etsy-documented algorithm.
 * This deliberately does not authenticate an HTTP webhook-signature header.
 * Source: https://developers.etsy.com/documentation/essentials/webhooks/
 */
export function verifyEtsyWebhookDigest(input: {
  messageId?: string;
  timestamp?: string;
  rawBody?: Uint8Array;
  digestBase64?: string;
  secret?: string;
  nowSeconds?: number;
}): boolean {
  const {messageId, timestamp, rawBody, digestBase64, secret} = input;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!messageId || messageId.length > 256 || /[\r\n]/.test(messageId) ||
      !timestamp || !/^\d{1,16}$/.test(timestamp) ||
      !rawBody || rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES ||
      !digestBase64 || digestBase64.length > 44 ||
      !secret?.startsWith("whsec_") || secret.length > 1024) return false;
  const emitted = Number(timestamp);
  if (!Number.isSafeInteger(emitted) || !Number.isSafeInteger(now) ||
      Math.abs(now - emitted) > TOLERANCE_SECONDS) return false;
  const key = decodeBase64(secret.slice("whsec_".length));
  const digest = decodeBase64(digestBase64);
  if (!key?.length || digest?.length !== 32) return false;
  const expected = createHmac("sha256", key)
    .update(Buffer.from(`${messageId}.${timestamp}.`, "utf8"))
    .update(rawBody)
    .digest();
  return timingSafeEqual(expected, digest);
}

export function webhookSecretConfigured(secret: string | undefined): boolean {
  return !!secret?.startsWith("whsec_") && secret.length <= 1024 &&
    !!decodeBase64(secret.slice(6))?.length;
}

/** Strict Standard Webhooks v1 grammar; no unsigned/unversioned fallback.
 * Unknown versions are rejected, including when accompanied by a valid v1 entry.
 */
export function verifyEtsyWebhookSignature(input: {
  messageId?: string;
  timestamp?: string;
  rawBody?: Uint8Array;
  signature?: string;
  secret?: string;
  nowSeconds?: number;
}): boolean {
  if (!input.messageId || !/^[A-Za-z0-9_-]{1,256}$/.test(input.messageId) ||
      !input.signature || input.signature.length > 4096) return false;
  const entries = input.signature.split(" ");
  if (entries.length > 8) return false;
  const digests: string[] = [];
  for (const entry of entries) {
    const match = /^v1,([A-Za-z0-9+/]+={0,2})$/.exec(entry);
    if (!match || match[1].length > 44 || decodeBase64(match[1])?.length !== 32) return false;
    digests.push(match[1]);
  }
  let matched = false;
  for (const digestBase64 of digests) {
    const valid = verifyEtsyWebhookDigest({...input, digestBase64});
    matched = valid || matched; // Compare each entry, even after a match.
  }
  return matched;
}
