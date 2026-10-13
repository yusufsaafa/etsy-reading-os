import { beforeEach, it, expect, vi } from "vitest";
const cryptoMocks=vi.hoisted(()=>({verify:vi.fn(),hash:vi.fn()}));
vi.mock("@node-rs/argon2",()=>cryptoMocks);
import { AccountSecurity } from "../src/modules/identity/security/service";
import { UnverifiedLogin } from "../src/modules/identity/security/unverified-login";
import type { Database } from "../src/db/client";
beforeEach(()=>{cryptoMocks.verify.mockReset();cryptoMocks.hash.mockReset();cryptoMocks.hash.mockResolvedValue("dummy");});
function service(user: unknown) {
 const execute=vi.fn().mockResolvedValueOnce([{attempts:1}]).mockResolvedValueOnce([{attempts:1}]).mockResolvedValueOnce(user?[user]:[]);
 return {execute,security:new AccountSecurity({execute} as unknown as Database,{send:vi.fn()},"a".repeat(32))};
}
const input={email:"Seller@Example.test",password:"A sufficiently long password"};
const credential={user_id:"account:fixture",email:"seller@example.test",password_hash:"stored",verified_at:null,session_version:0};
it("unverified resume requires a correct password and performs existing rate checks",async()=>{cryptoMocks.verify.mockResolvedValue(true);const {security,execute}=service(credential);await expect(security.login(input,true)).rejects.toEqual(new UnverifiedLogin("seller@example.test"));expect(execute).toHaveBeenCalledTimes(3);expect(cryptoMocks.verify).toHaveBeenCalledWith("stored",input.password);});
it("incorrect password and unknown email keep generic rejection",async()=>{cryptoMocks.verify.mockResolvedValue(false);expect(await service(credential).security.login(input,true)).toBeNull();expect(await service(null).security.login(input,true)).toBeNull();expect(cryptoMocks.hash).toHaveBeenCalled();});
it("default login contract still refuses unverified sessions",async()=>{cryptoMocks.verify.mockResolvedValue(true);expect(await service(credential).security.login(input)).toBeNull();});
it("verified login retains its original identity and session epoch",async()=>{cryptoMocks.verify.mockResolvedValue(true);expect(await service({...credential,verified_at:new Date()}).security.login(input,true)).toMatchObject({id:"account:fixture",sessionVersion:0});});
it("rate limiting prevents credential verification and resume",async()=>{const execute=vi.fn().mockResolvedValue([{attempts:11}]);const security=new AccountSecurity({execute} as unknown as Database,{send:vi.fn()},"a".repeat(32));await expect(security.login(input,true)).rejects.toThrow("TRY_LATER");expect(cryptoMocks.verify).not.toHaveBeenCalled();});
