import { afterEach, expect, it, vi } from "vitest";
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
async function config(mode = "development", app = "https://current-tunnel.trycloudflare.com", origins = "previous-tunnel.trycloudflare.com") {
 vi.stubEnv("NODE_ENV", mode); vi.stubEnv("APP_URL", app); vi.stubEnv("READING_OS_DEV_ORIGINS", origins); vi.resetModules();
 return (await import("../next.config")).default;
}
it("allows the explicit current app hostname even when the manual tunnel list is stale", async () => {
 expect((await config()).allowedDevOrigins).toEqual(["previous-tunnel.trycloudflare.com", "current-tunnel.trycloudflare.com"]);
});
it("does not grant development origins in production", async () => { expect((await config("production")).allowedDevOrigins).toBeUndefined(); });
it("rejects wildcards, malformed hosts and credential-bearing app URLs", async () => {
 expect((await config("development", "https://user:password@unsafe.example", "*, https://unsafe.example,valid.example")).allowedDevOrigins).toEqual(["valid.example"]);
});
it("invalid app URLs do not grant access and duplicate hosts are removed", async () => {
 expect((await config("development", "not a url", "safe.example,safe.example")).allowedDevOrigins).toEqual(["safe.example"]);
 expect((await config("development", "file:///private/file", "")).allowedDevOrigins).toEqual([]);
});
