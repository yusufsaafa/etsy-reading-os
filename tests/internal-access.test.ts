import {it,expect,vi,afterEach} from "vitest";
import {internalOperatorAllowed,assertInternalOperator} from "../src/modules/identity/internal-access";
import {recordCandidateReview} from "../src/modules/etsy/candidate-review";
afterEach(()=>vi.unstubAllEnvs());
it("authentication/Store ownership alone never grants internal access",()=>{
 for(const env of [{},{NODE_ENV:"production"},{INTERNAL_TOOLS_ENABLED:"true"},{INTERNAL_OPERATOR_USER_IDS:"github:123"}])expect(internalOperatorAllowed("github:123",env)).toBe(false);
});
it("production requires an explicit enabled allowlisted GitHub OAuth identity",()=>{
 const env={NODE_ENV:"production",INTERNAL_TOOLS_ENABLED:"true",INTERNAL_OPERATOR_USER_IDS:"github:123, github:456"};
 expect(internalOperatorAllowed("github:123",env)).toBe(true);expect(internalOperatorAllowed("github:789",env)).toBe(false);expect(internalOperatorAllowed(undefined,env)).toBe(false);
 expect(internalOperatorAllowed("dev:owner",{...env,INTERNAL_OPERATOR_USER_IDS:"dev:owner"})).toBe(false);
});
it("local access remains explicit and authenticated without weakening normal OAuth",()=>{
 expect(internalOperatorAllowed("github:123",{NODE_ENV:"development",INTERNAL_TOOLS_ENABLED:"true",INTERNAL_OPERATOR_USER_IDS:"github:123"})).toBe(true);
 expect(internalOperatorAllowed("dev:owner",{NODE_ENV:"development",INTERNAL_TOOLS_ENABLED:"true",INTERNAL_OPERATOR_USER_IDS:"dev:owner"})).toBe(true);
 expect(internalOperatorAllowed("dev:owner",{NODE_ENV:"development"})).toBe(false);
});
it("malformed/wildcard capability configuration fails closed",()=>{
 for(const ids of ["*","github:123,","github:123,*","github:123,github: 456","github:123,"+"a".repeat(5000)])expect(internalOperatorAllowed("github:123",{NODE_ENV:"production",INTERNAL_TOOLS_ENABLED:"true",INTERNAL_OPERATOR_USER_IDS:ids})).toBe(false);
});
it("internal mutating command rejects before database or source access",async()=>{
 vi.stubEnv("NODE_ENV","production");vi.stubEnv("INTERNAL_TOOLS_ENABLED","false");const reader=vi.fn(),db={transaction:vi.fn(),select:vi.fn()};
 expect(()=>assertInternalOperator("github:123")).toThrow("INTERNAL_ACCESS_DENIED");
 await expect(recordCandidateReview(db as never,{userId:"github:123",organizationId:"org",storeId:"store"},{},reader as never)).rejects.toThrow("INTERNAL_ACCESS_DENIED");expect(reader).not.toHaveBeenCalled();expect(db.select).not.toHaveBeenCalled();
});
