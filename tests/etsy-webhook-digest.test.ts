import {expect, it} from "vitest";
import {verifyEtsyWebhookDigest, verifyEtsyWebhookSignature, webhookSecretConfigured} from "../src/modules/etsy/webhook-digest";

// Synthetic known-answer vector computed independently with Python hmac/hashlib.
// This is NOT an Etsy-provided signature or live interoperability evidence.
const input = {
  messageId: "msg_fixture",
  timestamp: "1791722935",
  nowSeconds: 1791722935,
  secret: "whsec_c3ludGhldGljLWV0c3ktc2lnbmluZy1rZXk=",
  rawBody: Buffer.from('{"event_type":"order.paid","resource_url":"https://api.etsy.com/v3/application/shops/77/receipts/900","shop_id":77}'),
  digestBase64: "p469PyupgyCH5G/ZiwCAkZOZjwtxlR7x3+kelG5Q8BA=",
};

it("matches the documented cryptographic construction against a synthetic known answer", () => {
  expect(verifyEtsyWebhookDigest(input)).toBe(true);
});
it("rejects altered raw bytes, whitespace and message identity", () => {
  expect(verifyEtsyWebhookDigest({...input, rawBody: Buffer.concat([input.rawBody, Buffer.from(" ")])})).toBe(false);
  expect(verifyEtsyWebhookDigest({...input, messageId: "other"})).toBe(false);
  expect(verifyEtsyWebhookDigest({...input, digestBase64: Buffer.alloc(32).toString("base64")})).toBe(false);
});
it.each(["messageId", "timestamp", "rawBody", "digestBase64", "secret"] as const)("rejects missing %s", field => {
  expect(verifyEtsyWebhookDigest({...input, [field]: undefined})).toBe(false);
});
it.each([-301, 301])("rejects timestamps outside the documented margin (%s seconds)", delta => {
  expect(verifyEtsyWebhookDigest({...input, nowSeconds: input.nowSeconds + delta})).toBe(false);
});
it.each([-300, 300])("accepts the inclusive timestamp margin (%s seconds)", delta => {
  expect(verifyEtsyWebhookDigest({...input, nowSeconds: input.nowSeconds + delta})).toBe(true);
});
it.each(["!", "v1,p469PyupgyCH5G/ZiwCAkZOZjwtxlR7x3+kelG5Q8BA=", "AAAA", "p469PyupgyCH5G/ZiwCAkZOZjwtxlR7x3+kelG5Q8BA==="])("rejects malformed digest; never guesses header grammar (%s)", digestBase64 => {
  expect(verifyEtsyWebhookDigest({...input, digestBase64})).toBe(false);
});
it.each(["", "plain-secret", "whsec_!", "whsec_", "whsec_AAAA=="])("rejects invalid secret configuration (%s)", secret => {
  expect(verifyEtsyWebhookDigest({...input, secret})).toBe(false);
});
it.each(["NaN", "1.5", "-1", "9007199254740992"])("rejects invalid timestamp (%s)", timestamp => {
  expect(verifyEtsyWebhookDigest({...input, timestamp})).toBe(false);
});
it("enforces application bounds and rejects invalid server clock", () => {
  expect(verifyEtsyWebhookDigest({...input, rawBody: Buffer.alloc(65537)})).toBe(false);
  expect(verifyEtsyWebhookDigest({...input, messageId: "x".repeat(257)})).toBe(false);
  expect(verifyEtsyWebhookDigest({...input, nowSeconds: NaN})).toBe(false);
});

// Prefixless Portal-format coverage uses synthetic Base64, never a real secret.
it.each([input.secret, input.secret.slice(6), input.secret.slice(6).replace(/=+$/, "")])("accepts both key representations with the same known-answer HMAC", secret => {
  expect(webhookSecretConfigured(secret)).toBe(true);
  expect(verifyEtsyWebhookDigest({...input, secret})).toBe(true);
  const proof = {...input, secret, signature: `v1,${input.digestBase64}`};
  expect(verifyEtsyWebhookSignature(proof)).toBe(true);
  expect(verifyEtsyWebhookSignature({...proof, signature: `v1,${Buffer.alloc(32).toString("base64")}`})).toBe(false);
  expect(verifyEtsyWebhookSignature({...proof, signature: proof.signature + " v2,AAAA"})).toBe(false);
  for (const delta of [-301, 301]) expect(verifyEtsyWebhookSignature({...proof, nowSeconds: input.nowSeconds + delta})).toBe(false);
});
it.each([undefined, "", "plain-secret", "!", "whsec_", "whsec_!", "AAAA==", "whsec_AAAA==", "AB", "whsec_AB", " c3ludGhldGlj", "c3ludGhldGlj\n", "whsk_c3ludGhldGlj", "A".repeat(1025)])("configuration and signature verification reject malformed keys consistently (case %#)", secret => {
  expect(webhookSecretConfigured(secret)).toBe(false);
  expect(verifyEtsyWebhookDigest({...input, secret})).toBe(false);
  expect(verifyEtsyWebhookSignature({...input, secret, signature: `v1,${input.digestBase64}`})).toBe(false);
});
