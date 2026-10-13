import { afterEach, it, expect, vi } from "vitest";
import { transactionalEmail } from "../src/modules/identity/security/email";
afterEach(()=>vi.unstubAllGlobals());
it("uses bounded private Resend delivery with idempotency and a purpose-specific template",async()=>{
 const fetch=vi.fn().mockResolvedValue(new Response(null,{status:200}));vi.stubGlobal("fetch",fetch);
 await transactionalEmail({NODE_ENV:"test",EMAIL_PROVIDER:"resend",RESEND_API_KEY:"fake-test-key",EMAIL_FROM:"Reading OS <security@example.test>"}).send({to:"synthetic@example.test",code:"123456",purpose:"verify",identity:"test-id"});
 const [url,request]=fetch.mock.calls[0];expect(url).toBe("https://api.resend.com/emails");expect(request.redirect).toBe("error");expect(request.signal).toBeInstanceOf(AbortSignal);expect(request.headers["Idempotency-Key"]).toBe("test-id");
 const body=JSON.parse(request.body);expect(body.to).toEqual(["synthetic@example.test"]);expect(body.subject).toMatch(/Verify/);expect(body.text).toContain("10 minutes");
});
it("does not expose provider error bodies or retry delivery",async()=>{
 const fetch=vi.fn().mockResolvedValue(new Response("private provider error",{status:500}));vi.stubGlobal("fetch",fetch);
 await expect(transactionalEmail({NODE_ENV:"test",EMAIL_PROVIDER:"resend",RESEND_API_KEY:"fake",EMAIL_FROM:"security@example.test"}).send({to:"synthetic@example.test",code:"123456",purpose:"reset",identity:"test-id"})).rejects.toThrow("EMAIL_UNAVAILABLE");
 expect(fetch).toHaveBeenCalledTimes(1);
});
