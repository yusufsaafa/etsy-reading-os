import {it,expect,vi,beforeEach} from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),find:vi.fn(),authorize:vi.fn(),get:vi.fn(),download:vi.fn(),ports:vi.fn()}));
vi.mock("@/auth",()=>({auth:mocks.auth}));vi.mock("@/db/client",()=>({database:()=>({})}));
vi.mock("@/modules/identity/service",()=>({findUserStore:mocks.find,authorizeStore:mocks.authorize}));
vi.mock("@/modules/documents/artifact-service",()=>({getDocumentArtifact:mocks.get}));
vi.mock("@/modules/documents/download",()=>({downloadDocument:mocks.download}));
vi.mock("@/infrastructure/document-runtime",()=>({configuredDocumentPorts:mocks.ports}));
import {GET} from "../src/app/api/readings/[readingId]/artifacts/[artifactId]/route";
const call=()=>GET(new Request("http://localhost/api/readings/reading/artifacts/artifact"),{params:Promise.resolve({readingId:"reading",artifactId:"artifact"})});
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({user:{id:"github:123"}});mocks.find.mockResolvedValue({id:"owned-store"});mocks.authorize.mockResolvedValue({userId:"github:123",organizationId:"org",storeId:"owned-store"});mocks.get.mockResolvedValue({state:"AVAILABLE"});mocks.ports.mockReturnValue({artifacts:{}});mocks.download.mockResolvedValue(new Response("synthetic",{headers:{"Content-Type":"application/pdf"}}));});
it("anonymous access returns 401 without DB/storage access",async()=>{mocks.auth.mockResolvedValue(null);expect((await call()).status).toBe(401);expect(mocks.find).not.toHaveBeenCalled();expect(mocks.get).not.toHaveBeenCalled();expect(mocks.ports).not.toHaveBeenCalled();});
it("scope is derived from session and artifact authorization precedes storage access",async()=>{expect((await call()).status).toBe(200);expect(mocks.authorize).toHaveBeenCalledWith({},"github:123","owned-store");expect(mocks.get).toHaveBeenCalledWith({},expect.objectContaining({storeId:"owned-store"}),"reading","artifact");expect(mocks.download).toHaveBeenCalledWith({},expect.objectContaining({storeId:"owned-store"}),{readingId:"reading",artifactId:"artifact"},{});});
it("cross-Store or forged artifact returns a private safe error without reading bytes",async()=>{mocks.get.mockRejectedValue(new Error("private storage path"));const response=await call();expect(response.status).toBe(404);expect(await response.text()).toBe("Document unavailable");expect(mocks.ports).not.toHaveBeenCalled();expect(mocks.download).not.toHaveBeenCalled();});
it("missing storage is a controlled unavailable response, no public URL fallback",async()=>{mocks.ports.mockReturnValue(undefined);expect((await call()).status).toBe(503);expect(mocks.download).not.toHaveBeenCalled();});
it("inline preview uses the same session-owned artifact authorization and private download contract",async()=>{
 const response=await GET(new Request("http://localhost/api/readings/reading/artifacts/artifact?view=inline"),{params:Promise.resolve({readingId:"reading",artifactId:"artifact"})});expect(response.status).toBe(200);
 expect(mocks.get).toHaveBeenCalledWith({},expect.objectContaining({storeId:"owned-store"}),"reading","artifact");expect(mocks.download).toHaveBeenCalledWith({},expect.objectContaining({storeId:"owned-store"}),{readingId:"reading",artifactId:"artifact"},{},"inline");
});
it.each(["view=inline&view=inline","view=https://evil.example","view=download"])("nonexact preview token %s retains normal attachment behavior",async query=>{
 await GET(new Request(`http://localhost/api/readings/reading/artifacts/artifact?${query}`),{params:Promise.resolve({readingId:"reading",artifactId:"artifact"})});expect(mocks.download.mock.calls[0]).toHaveLength(4);
});
