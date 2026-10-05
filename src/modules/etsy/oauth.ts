import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
export const readScopes = ["listings_r", "transactions_r"] as const;
export const hashState = (state: string) => createHash("sha256").update(state).digest("hex");
export function newOAuthIntent() {
  const state = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
  return { state, verifier, stateHash: hashState(state), challenge: createHash("sha256").update(verifier).digest("base64url") };
}
export function authorizationUrl(clientId: string, redirectUri: string, intent: ReturnType<typeof newOAuthIntent>) {
  const callback = new URL(redirectUri);
  if (callback.protocol !== "https:") throw new Error("Etsy requires a registered HTTPS callback");
  const url = new URL("https://www.etsy.com/oauth/connect");
  url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: readScopes.join(" "), state: intent.state, code_challenge: intent.challenge, code_challenge_method: "S256" }).toString();
  return url.toString();
}
export const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().int().positive(), token_type: z.literal("Bearer"), scope: z.string() });
export type EtsyTokens = z.infer<typeof tokenSchema>;
export class EtsyAuthorizationError extends Error { constructor(readonly code: string) { super(code); } }
export async function exchangeTokens(parameters: Record<string, string>, fetcher: typeof fetch = fetch): Promise<EtsyTokens> {
  let response: Response;
  try { response = await fetcher("https://api.etsy.com/v3/public/oauth/token", { method: "POST", body: new URLSearchParams(parameters), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15000), cache: "no-store", redirect: "error" }); }
  catch { throw new EtsyAuthorizationError("ETSY_TOKEN_OUTCOME_UNKNOWN"); }
  if (!response.ok) throw new EtsyAuthorizationError(response.status === 400 || response.status === 401 || response.status === 403 ? "ETSY_REAUTHORIZE" : "ETSY_TOKEN_FAILED");
  try { return tokenSchema.parse(await response.json()); }
  catch { throw new EtsyAuthorizationError("ETSY_TOKEN_RESPONSE_UNUSABLE"); }
}
export async function resolveAuthorizedShop(tokens: EtsyTokens, clientId: string, secret: string, fetcher: typeof fetch = fetch) {
  const owner = tokens.access_token.split(".")[0];
  if (!/^[1-9]\d{0,19}$/.test(owner)) throw new EtsyAuthorizationError("ETSY_IDENTITY_UNUSABLE");
  const response = await fetcher(`https://api.etsy.com/v3/application/users/${owner}/shops`, { headers: { "x-api-key": `${clientId}:${secret}`, Authorization: `Bearer ${tokens.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(15000), redirect: "error" });
  if (!response.ok) throw new EtsyAuthorizationError("ETSY_SHOP_LOOKUP_FAILED");
  const raw = z.object({ shop_id: z.union([z.string().regex(/^[1-9]\d{0,19}$/), z.number().int().positive().refine(Number.isSafeInteger)]), user_id: z.union([z.string(), z.number().int().refine(Number.isSafeInteger)]), shop_name: z.string().min(1) }).parse(await response.json());
  if (String(raw.user_id) !== owner) throw new EtsyAuthorizationError("ETSY_SHOP_OWNER_MISMATCH");
  return { id: String(raw.shop_id), name: raw.shop_name };
}
