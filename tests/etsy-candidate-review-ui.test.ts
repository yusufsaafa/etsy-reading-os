import {it,expect,vi,beforeEach,afterEach} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
const mocks=vi.hoisted(()=>({scope:vi.fn(),verify:vi.fn(),discover:vi.fn(),load:vi.fn(),record:vi.fn(),confirm:vi.fn(),versions:vi.fn()}));
vi.mock("@/modules/identity/session",()=>({currentStoreScope:mocks.scope}));
vi.mock("@/modules/intake/service",()=>({verifyScope:mocks.verify,tenantWhere:()=>undefined}));
vi.mock("@/db/client",()=>({database:()=>({select:()=>({from:()=>({where:mocks.versions})})})}));
vi.mock("@/modules/etsy/candidate-review",()=>({discoverReviewCandidates:mocks.discover,loadCandidateReview:mocks.load,recordCandidateReview:mocks.record,confirmCandidateReview:mocks.confirm}));
vi.mock("next/navigation",()=>({notFound:()=>{throw new Error("NOT_FOUND");},redirect:(path:string)=>{throw new Error(path);}}));
import Page from "../src/app/etsy/historical-review/page";
import {selectHistoricalCandidate,confirmHistoricalReview} from "../src/app/etsy/historical-review/actions";
afterEach(()=>vi.unstubAllEnvs());
beforeEach(()=>{vi.stubEnv("INTERNAL_TOOLS_ENABLED","true");vi.stubEnv("INTERNAL_OPERATOR_USER_IDS","owner");vi.clearAllMocks();mocks.scope.mockResolvedValue({userId:"owner"});mocks.verify.mockResolvedValue(undefined);mocks.discover.mockResolvedValue([{receiptId:"900",transactionId:"901",title:"Synthetic listing",purchasedAt:1700000000,quantity:1,selections:[{name:"Delivery",values:["Arbitrary wording"]}],versionId:"version",versionNumber:2,historical:true,reasons:[]}]);});
it("private owner list displays purchased references and exact selection without adoption controls",async()=>{
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
 for(const text of ["Synthetic listing","Receipt 900","Transaction 901","Arbitrary wording","Matching Product version 2","Explicit historical adoption required","Select this purchase for review"])expect(html).toContain(text);
 expect(html).not.toContain("Approve adoption");expect(mocks.verify).toHaveBeenCalledWith(expect.anything(),{userId:"owner"},true);expect(mocks.record).not.toHaveBeenCalled();expect(mocks.confirm).not.toHaveBeenCalled();
});
it("held candidate has no selection control",async()=>{mocks.discover.mockResolvedValue([{receiptId:"900",transactionId:"901",title:"Held",purchasedAt:null,quantity:1,selections:[],historical:false,reasons:["unmapped_purchase_selection"]}]);const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));expect(html).toContain("Held:");expect(html).not.toContain("Select this purchase for review");});
it("confirmation explicitly reviews pinned configuration and requires checked intent",async()=>{
 mocks.load.mockResolvedValue({id:"review",receiptId:"900",transactionId:"901",productVersionId:"version",confirmedAt:null,invalidatedAt:null});mocks.versions.mockResolvedValue([{versionNumber:2,configuration:{sections:[{title:"Guidance"}],inputs:[{label:"Personalization"}],output:"PDF",fulfillment:{targetCompletionMinutes:60}}}]);
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({review:"review"})}));expect(html).toContain("Guidance");expect(html).toContain("Personalization");expect(html).toContain('name="confirmation"');expect(html).toContain("Confirm review only");
 const form=new FormData();form.set("review","review");await expect(confirmHistoricalReview(form)).rejects.toThrow("?error=confirm");expect(mocks.confirm).not.toHaveBeenCalled();
 form.set("confirmation","review-only");mocks.confirm.mockResolvedValue({confirmed:true});await expect(confirmHistoricalReview(form)).rejects.toThrow("?review=review");expect(mocks.confirm).toHaveBeenCalledOnce();
});
it("selection action uses authenticated scope and server-validated exact references",async()=>{const data=new FormData();data.set("receipt","900");data.set("transaction","901");data.set("version","version");mocks.record.mockResolvedValue("review");await expect(selectHistoricalCandidate(data)).rejects.toThrow("?review=review");expect(mocks.record).toHaveBeenCalledWith(expect.anything(),{userId:"owner"},{receiptId:"900",transactionId:"901",productVersionId:"version"});});
it("private errors expose no server exception or raw payload and offer retry",async()=>{mocks.discover.mockRejectedValue(new Error("sensitive internal detail"));const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({error:"stale"})}));expect(html).toContain("Try again");expect(html).toContain("evidence or Product configuration changed");expect(html).not.toContain("sensitive internal detail");});
it("production owner without internal capability cannot render or invoke review actions",async()=>{
 vi.stubEnv("NODE_ENV","production");vi.stubEnv("INTERNAL_TOOLS_ENABLED","false");
 await expect(Page({searchParams:Promise.resolve({})})).rejects.toThrow("NOT_FOUND");expect(mocks.discover).not.toHaveBeenCalled();
 await expect(selectHistoricalCandidate(new FormData())).rejects.toThrow("INTERNAL_ACCESS_DENIED");await expect(confirmHistoricalReview(new FormData())).rejects.toThrow("INTERNAL_ACCESS_DENIED");expect(mocks.record).not.toHaveBeenCalled();expect(mocks.confirm).not.toHaveBeenCalled();
});
