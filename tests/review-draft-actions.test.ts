import {it,expect,vi,beforeEach} from "vitest";
const mocks=vi.hoisted(()=>({approve:vi.fn(),save:vi.fn(),scope:vi.fn(),refresh:vi.fn(),redirect:vi.fn()}));
vi.mock("@/db/client",()=>({database:()=>({})}));
vi.mock("@/modules/identity/session",()=>({currentScope:mocks.scope}));
vi.mock("@/modules/review/service",()=>({saveReadingReviewDraft:mocks.save,approveReadingReview:mocks.approve}));
vi.mock("next/cache",()=>({revalidatePath:mocks.refresh}));
vi.mock("next/navigation",()=>({redirect:mocks.redirect}));
import {saveReviewDraftAction,approveReviewAction} from "../src/components/review/actions";
import {ReviewDraftError} from "../src/modules/review/draft-contract";
const order="00000000-0000-4000-8000-000000000001",reading="00000000-0000-4000-8000-000000000002";
function form(){const f=new FormData();f.set("revision","0");f.set("structure",JSON.stringify([{sectionId:"one",title:"One"}]));f.append("content","Seller text");f.set("storeId","foreign");f.set("reviewId","forged");return f;}
beforeEach(()=>{vi.clearAllMocks();mocks.scope.mockResolvedValue({userId:"owner",organizationId:"owned",storeId:"owned-store"});mocks.save.mockResolvedValue({revision:1,modified:true});});
it("save derives scope and revalidates/returns to readable mode only after durable success",async()=>{
 await saveReviewDraftAction(order,reading,{},form());expect(mocks.save).toHaveBeenCalledWith({}, {userId:"owner",organizationId:"owned",storeId:"owned-store"},order,reading,0,{sections:[{sectionId:"one",title:"One",content:"Seller text"}]});
 expect(mocks.redirect).toHaveBeenCalledWith(`/orders/${order}/readings/${reading}/review?saved=1`);expect(mocks.refresh).toHaveBeenCalled();
});
it("conflict preserves edit mode and returns seller-safe feedback",async()=>{
 mocks.save.mockRejectedValue(new ReviewDraftError("CONFLICT"));const state=await saveReviewDraftAction(order,reading,{},form());expect(state.error).toContain("Refresh");expect(mocks.redirect).not.toHaveBeenCalled();expect(mocks.refresh).not.toHaveBeenCalled();
});
it("malformed/revisionless/oversized/file submissions never reach draft persistence",async()=>{
 const broken=form();broken.delete("revision");const oversized=form();oversized.set("content","界".repeat(200000));const malformed=form();malformed.set("structure","not JSON");const file=form();file.set("content",new Blob(["text"]));
 for(const f of [broken,oversized,malformed,file])expect((await saveReviewDraftAction(order,reading,{},f)).error).toBeTruthy();
 expect(mocks.save).not.toHaveBeenCalled();expect(mocks.redirect).not.toHaveBeenCalled();
});
it("infrastructure exceptions are never shown to seller",async()=>{
 mocks.save.mockRejectedValue(new Error("secret SQL details"));expect((await saveReviewDraftAction(order,reading,{},form())).error).not.toContain("secret");
});

it("approval submits only authoritative intent and loaded revision, never content",async()=>{
 const f=new FormData();f.set("revision","3");await approveReviewAction(order,reading,{},f);
 expect(mocks.approve).toHaveBeenCalledWith({}, {userId:"owner",organizationId:"owned",storeId:"owned-store"},order,reading,3);
 expect(mocks.redirect).toHaveBeenCalledWith(`/orders/${order}/readings/${reading}/review`);
});
it("approval rejects forged fields and missing or malformed revision",async()=>{
 for(const extra of ["content","generationId","reviewId","storeId","contentHash"]){const f=new FormData();f.set("revision","none");f.set(extra,"forged");expect((await approveReviewAction(order,reading,{},f)).error).toBeTruthy();}
 for(const token of [null,"-1","abc"]){const f=new FormData();if(token!==null)f.set("revision",token);expect((await approveReviewAction(order,reading,{},f)).error).toBeTruthy();}
 expect(mocks.approve).not.toHaveBeenCalled();
});
it("approval conflict and internal errors return safe actionable messages",async()=>{
 const f=new FormData();f.set("revision","none");mocks.approve.mockRejectedValue(new ReviewDraftError("CONFLICT"));expect((await approveReviewAction(order,reading,{},f)).error).toContain("before approving");
 mocks.approve.mockRejectedValue(new Error("secret SQL"));expect((await approveReviewAction(order,reading,{},f)).error).not.toContain("secret");expect(mocks.redirect).not.toHaveBeenCalled();
});

it("stale save and approval return actionable non-destructive errors without redirect",async()=>{
 mocks.save.mockRejectedValue(new ReviewDraftError("STALE"));mocks.approve.mockRejectedValue(new ReviewDraftError("STALE"));
 const approval=new FormData();approval.set("revision","3");
 for(const result of [await saveReviewDraftAction(order,reading,{},form()),await approveReviewAction(order,reading,{},approval)])expect(result.error).toContain("Your saved history is unchanged");
 expect(mocks.redirect).not.toHaveBeenCalled();expect(mocks.refresh).not.toHaveBeenCalled();
});
