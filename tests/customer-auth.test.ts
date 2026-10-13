import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type { NextAuthConfig } from "next-auth";
const mocks=vi.hoisted(()=>({config:undefined as NextAuthConfig|undefined,version:0 as number|null,existing:[] as {id:string}[],insert:vi.fn(),login:vi.fn()}));
vi.mock("next-auth",()=>({default:(config:NextAuthConfig)=>{mocks.config=config;return {handlers:{},signIn:vi.fn(),signOut:vi.fn(),auth:vi.fn()};}}));
vi.mock("../src/db/client",()=>({database:()=>({select:()=>({from:()=>({where:async()=>mocks.existing})}),insert:()=>({values:()=>({onConflictDoNothing:mocks.insert})})})}));
vi.mock("../src/modules/identity/security/service",()=>({sessionIdentity:async()=>mocks.version,AccountSecurity:class {login=mocks.login;}}));
beforeEach(async()=>{vi.resetModules();vi.stubEnv("NODE_ENV","production");vi.stubEnv("AUTH_GITHUB_ID","");vi.stubEnv("AUTH_GITHUB_SECRET","");vi.stubEnv("AUTH_LEGACY_GITHUB_ENABLED","false");mocks.version=0;mocks.existing=[];mocks.insert.mockReset();await import("../src/auth");});
afterEach(()=>vi.unstubAllEnvs());
it("production email login is configured without GitHub and uses secure eight-hour Auth.js sessions",()=>{
 expect(mocks.config!.providers.map(provider=>(typeof provider==="function"?provider():provider).options?.id ?? (typeof provider==="function"?provider():provider).id)).toEqual(["email-password"]);
 expect(mocks.config!.useSecureCookies).toBe(true);expect(mocks.config!.session).toMatchObject({strategy:"jwt",maxAge:28800});
});
async function jwt(params:Record<string,unknown>) {return mocks.config!.callbacks!.jwt!(params as never);}
it("revoked sessions disappear and client update cannot adopt a new epoch",async()=>{
 expect(await jwt({token:{sub:"account:a",sessionVersion:0}})).toMatchObject({sub:"account:a"});
 mocks.version=1;
 expect(await jwt({token:{sub:"account:a",sessionVersion:0},trigger:"update",session:{sessionVersion:1}})).toBeNull();
});
it("unverified, deleted or unavailable identities do not receive sessions",async()=>{mocks.version=null;expect(await jwt({token:{sub:"account:a",sessionVersion:0}})).toBeNull();});
it("login and reset race rejects the credential epoch authenticated before reset",async()=>{mocks.version=1;expect(await jwt({token:{},user:{id:"account:a",sessionVersion:0}})).toBeNull();});
it("preserves epoch-zero historical sessions while enforcing future revocation",async()=>{expect(await jwt({token:{sub:"github:123"}})).toMatchObject({sub:"github:123"});mocks.version=1;expect(await jwt({token:{sub:"github:123"}})).toBeNull();});
it("optional legacy GitHub access cannot create new production identities",async()=>{
 const callback=mocks.config!.callbacks!.signIn!;
 expect(await callback({user:{id:"123",name:"Legacy"},account:{provider:"github",providerAccountId:"123"}} as never)).toBe(false);
 expect(mocks.insert).not.toHaveBeenCalled();
 mocks.existing=[{id:"github:123"}];const user={id:"123",name:"Legacy"};
 expect(await callback({user,account:{provider:"github",providerAccountId:"123"}} as never)).toBe(true);expect(user.id).toBe("github:123");
});

it("session lifetime is bounded to eight hours even with ongoing activity",async()=>{
 expect(await jwt({token:{sub:"account:a",sessionVersion:0,sessionStartedAt:Date.now()-28800001}})).toBeNull();
});
