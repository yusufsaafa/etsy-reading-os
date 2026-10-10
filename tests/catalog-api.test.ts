import {beforeEach,it,expect,vi} from "vitest";
import {catalogQuery} from "../src/modules/catalog/read";
const mocks=vi.hoisted(()=>({auth:vi.fn(),find:vi.fn(),authorize:vi.fn(),read:vi.fn(),sync:vi.fn()}));
vi.mock("@/auth",()=>({auth:mocks.auth}));vi.mock("@/db/client",()=>({database:()=>({owned:"db"})}));
vi.mock("@/modules/identity/service",()=>({findUserStore:mocks.find,authorizeStore:mocks.authorize}));
vi.mock("@/modules/catalog/read",async(importOriginal)=>{const original=await importOriginal<typeof import("../src/modules/catalog/read")>();return {...original,readCatalog:mocks.read};});
vi.mock("@/modules/catalog/sync",()=>({syncCatalog:mocks.sync}));
import {GET,POST} from "../src/app/api/catalog/route";
const scope={userId:"member",organizationId:"server-org",storeId:"server-store"};
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({user:{id:"member"}});mocks.find.mockResolvedValue({id:"server-store"});mocks.authorize.mockResolvedValue(scope);mocks.read.mockImplementation(async(_db,_scope,q)=>({query:catalogQuery.parse(q)}));mocks.sync.mockResolvedValue({status:"SUCCEEDED",hasMore:false});});
const post=(body="{}",origin="https://reading.test")=>new Request("https://reading.test/api/catalog",{method:"POST",headers:{"content-type":"application/json",origin,host:"reading.test"},body});
it("GET is read-only, server-scoped and denies client tenant selectors",async()=>{
 expect((await GET(new Request("https://reading.test/api/catalog?pageSize=10&state=draft"))).status).toBe(200);expect(mocks.authorize).toHaveBeenCalledWith({owned:"db"},"member","server-store",false);expect(mocks.read).toHaveBeenCalledWith({owned:"db"},scope,{pageSize:10,state:"draft"});expect(mocks.sync).not.toHaveBeenCalled();
 expect((await GET(new Request("https://reading.test/api/catalog?storeId=foreign"))).status).toBe(400);
});
it("requires authentication and persisted authorization for both methods",async()=>{
 mocks.auth.mockResolvedValue(null);expect((await GET(new Request("https://reading.test/api/catalog"))).status).toBe(401);expect((await POST(post())).status).toBe(401);expect(mocks.find).not.toHaveBeenCalled();
 mocks.auth.mockResolvedValue({user:{id:"member"}});mocks.authorize.mockRejectedValue(new Error());expect((await POST(post())).status).toBe(403);expect(mocks.sync).not.toHaveBeenCalled();
});
it("POST enforces owner authorization, same origin and body bounds before external work",async()=>{
 expect((await POST(post("{}","https://foreign.test"))).status).toBe(403);expect((await POST(post("x".repeat(1025)))).status).toBe(400);expect(mocks.sync).not.toHaveBeenCalled();
 expect((await POST(post('{"pages":1}'))).status).toBe(200);expect(mocks.authorize).toHaveBeenLastCalledWith({owned:"db"},"member","server-store",true);expect(mocks.sync).toHaveBeenCalledWith({owned:"db"},scope,{pages:1});
});
