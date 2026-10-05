import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { LocalEncryptedVault } from "../src/infrastructure/secrets";
import { newOAuthIntent, authorizationUrl, exchangeTokens } from "../src/modules/etsy/oauth";
import { developmentLoginAllowed, validDevelopmentPassword } from "../src/modules/identity/development-login";
describe("secret and OAuth boundaries", () => {
  it("cannot enable development credentials in production or live Etsy mode", () => {
    const env = { NODE_ENV:"development", DEV_LOGIN_ENABLED:"true", ETSY_ADAPTER:"fixtures", DEV_LOGIN_PASSWORD:"long-synthetic-password" };
    expect(validDevelopmentPassword("long-synthetic-password",env)).toBe(true);
    expect(validDevelopmentPassword("wrong",env)).toBe(false);
    expect(developmentLoginAllowed({...env,NODE_ENV:"production"})).toBe(false);
    expect(developmentLoginAllowed({...env,ETSY_ADAPTER:"etsy"})).toBe(false);
    expect(validDevelopmentPassword("weak",{...env,DEV_LOGIN_PASSWORD:"weak"})).toBe(false);
  });
  it("encrypts secrets with random nonces and tenant-bound authenticated context", () => {
    const vault=new LocalEncryptedVault(randomBytes(32).toString("base64"));
    const first=vault.seal("access-token-secret","tenant-a:store-a"),second=vault.seal("access-token-secret","tenant-a:store-a");
    expect(first).not.toContain("access-token-secret");expect(first).not.toBe(second);
    expect(vault.open(first,"tenant-a:store-a")).toBe("access-token-secret");
    expect(()=>vault.open(first,"tenant-b:store-a")).toThrow();
    const raw=JSON.parse(first);raw.ciphertext="aaaa";expect(()=>vault.open(JSON.stringify(raw),"tenant-a:store-a")).toThrow();
  });
  it("requires an explicit strong encryption key",()=>{expect(()=>new LocalEncryptedVault("weak")).toThrow();});
  it("requests PKCE and only read scopes with HTTPS callback",()=>{
    const intent=newOAuthIntent(),url=new URL(authorizationUrl("client","https://app.example/api/etsy/callback",intent));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");expect(url.searchParams.get("scope")).toBe("listings_r transactions_r");expect(intent.stateHash).not.toBe(intent.state);
    expect(()=>authorizationUrl("client","http://localhost:3000",intent)).toThrow();
  });
  it("redacts upstream token errors",async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response("secret refresh-token",{status:401}));
    await expect(exchangeTokens({client_id:"client"},fetcher)).rejects.toThrow("ETSY_REAUTHORIZE");
  });
  it("does not blindly retry ambiguous token exchange",async()=>{
    const fetcher=vi.fn().mockRejectedValue(new Error("network access-token-secret"));
    await expect(exchangeTokens({},fetcher)).rejects.toThrow("ETSY_TOKEN_OUTCOME_UNKNOWN");expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
