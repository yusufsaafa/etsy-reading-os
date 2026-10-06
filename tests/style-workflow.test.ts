import { beforeEach, it, expect, vi } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
const mocks=vi.hoisted(()=>({scope:{userId:"owner",organizationId:"org",storeId:"store"},execute:vi.fn(),data:vi.fn(),remove:vi.fn(),workflow:vi.fn(),refresh:vi.fn(),db:{}}));
vi.mock("next/cache",()=>({revalidatePath:mocks.refresh}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock("@/db/client",()=>({database:()=>mocks.db}));
vi.mock("@/modules/identity/session",()=>({currentScope:async()=>mocks.scope}));
vi.mock("@/modules/seller-style/service",()=>({sellerStyleData:mocks.data,removePreviousWork:mocks.remove,saveSellerProfile:vi.fn(),editStyle:vi.fn(),saveStyleDraft:vi.fn(),applyStyle:vi.fn(),addPreviousWork:vi.fn()}));
vi.mock("@/infrastructure/ai/runtime",()=>({styleAnalysisRuntime:()=>({executeForSeller:mocks.execute})}));
vi.mock("@/modules/seller-style/workflow",async original=>({...await original<object>(),writingStyleWorkflow:mocks.workflow}));
import { learnWritingStyle, deleteWork } from "../src/components/seller-style/actions";
import ProfileStyle from "../src/app/(operations)/settings/profile/page";
const key="00000000-0000-4000-8000-000000000001";
const form=()=>{const f=new FormData();f.set("commandKey",key);return f;};
beforeEach(()=>{
 vi.clearAllMocks();mocks.data.mockResolvedValue({profile:{id:"owned-profile"},seller:{displayName:"Synthetic writer",shortBio:""},active:null,draft:null,sources:[{id:key,title:"Example "+"長".repeat(100),createdAt:new Date()}]});
 mocks.workflow.mockResolvedValue({status:"Not learned yet",message:"Learning is optional.",preview:[],canRequest:true,actionLabel:"Learn my writing style",learning:false});mocks.execute.mockResolvedValue({status:"READY"});
});
it("server action derives Store/profile and routes through the existing execution service with retained command identity",async()=>{
 expect(await learnWritingStyle({},form())).toEqual({learned:true});expect(mocks.execute).toHaveBeenCalledWith(mocks.scope,{styleProfileId:"owned-profile",commandKey:key});expect(mocks.refresh).toHaveBeenCalledWith("/settings/profile");
 await learnWritingStyle({},form());expect(mocks.execute.mock.calls[1][1]).toEqual(mocks.execute.mock.calls[0][1]);
});
it.each(["storeId","styleProfileId","sourceIds","analysisVersionId"])("forged %s is rejected without execution",async field=>{
 const f=form();f.set(field,key);expect((await learnWritingStyle({},f)).error).toBeDefined();expect(mocks.execute).not.toHaveBeenCalled();
});
it("no examples and malformed/duplicated commands never execute",async()=>{
 mocks.data.mockResolvedValue({sources:[],profile:{id:"owned"}});expect((await learnWritingStyle({},form())).error).toContain("example");expect(mocks.execute).not.toHaveBeenCalled();const f=form();f.append("commandKey",key);await learnWritingStyle({},f);expect(mocks.execute).not.toHaveBeenCalled();
});
it.each(["STYLE_UPDATE_UNSAFE","private provider secret"])("failure %s gets safe product copy",async code=>{
 mocks.execute.mockRejectedValue(new Error(code));const result=await learnWritingStyle({},form());expect(result.error).not.toContain(code);expect(result.error).not.toContain("secret");
});
it("retained-source deletion maps to human explanation without database details",async()=>{
 mocks.remove.mockRejectedValue(new Error("STYLE_SOURCE_RETAINED"));const f=new FormData();f.set("sourceId",key);const result=await deleteWork({},f);expect(result.error).toContain("writing style history");expect(result.error).not.toMatch(/foreign|constraint|STYLE_SOURCE/);
});
it("actual Settings page retains manual controls, semantic status and compact preview without infrastructure data",async()=>{
 mocks.workflow.mockResolvedValue({status:"Style ready",message:"Your current style is still active.",preview:[{label:"Voice",text:"Calm and reflective"},{label:"Tone",text:"Warm"}],canRequest:true,actionLabel:"Update writing style",learning:false});
 const html=renderToStaticMarkup(await ProfileStyle());expect(html).toContain("Style ready");expect(html).toContain("Calm and reflective");expect(html).toContain("Update writing style");expect(html).toContain("Set up your style");expect(html).toContain("Previous-work example");expect(html).toContain('aria-labelledby="learned-style-heading"');expect(html).toContain('role="status"');expect(html).toContain('aria-describedby="work-privacy"');
 // Internal IDs remain only in scoped form/link plumbing, never presented as seller copy.
 const visible=html.replace(/<input[^>]*type="hidden"[^>]*>/g,"").replace(/<script[\s\S]*?<\/script>/g,"").replace(/<[^>]+>/g,"");expect(visible).not.toMatch(/gemini|AIRequest|UsageEvent|contractVersion|style-intelligence|token|PENDING|ANALYZING/);expect(visible).not.toContain(key);
 if(process.env.STYLE_UI_REVIEW==="1"){
  mkdirSync(".local/style-ui",{recursive:true});
  const css=readFileSync("src/app/globals.css","utf8")+"\n"+readFileSync("src/components/seller-style/profile.module.css","utf8").replace(/:global\(([^)]+)\)/g,"$1");
  writeFileSync(".local/style-ui/preview.html",'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline writing style review</title><style>'+css+' body{padding:20px}</style>'+html.replace(/_([a-zA-Z]+)_[a-f0-9]+/g,"$1"));
 }
});
it("responsive CSS wraps source/preview text, stacks controls and preserves touch/focus primitives",()=>{
 const css=readFileSync("src/components/seller-style/profile.module.css","utf8");expect(css).toContain("overflow-wrap:anywhere");expect(css).toContain("@media(max-width:600px)");expect(css).toContain("grid-template-columns:minmax(0,1fr)");expect(css).toContain("min-height:44px");expect(css).toContain("focus-visible");
 const forms=readFileSync("src/components/seller-style/forms.tsx","utf8");expect(forms).toContain('aria-live="polite"');expect(forms).toContain('disabled={pending}');expect(forms).not.toContain("setInterval");
});

it("platform rejection before dispatch has temporary product copy, while unsafe output has reliability copy",async()=>{
 const {failureCopy}=await import("../src/modules/seller-style/workflow");expect(failureCopy("POLICY_REJECTED",false)).toContain("right now");expect(failureCopy("POLICY_REJECTED",true)).toContain("reliable");expect(failureCopy("BUDGET_REJECTED",false)).not.toContain("budget");
});
it.each(["Learning your writing style","Needs attention"])("%s renders text status without a new paid action",async status=>{
 mocks.workflow.mockResolvedValue({status,message:"Check its status here.",preview:[],canRequest:false,actionLabel:"Learn my writing style",learning:status.startsWith("Learning")});const html=renderToStaticMarkup(await ProfileStyle());expect(html).toContain(status);expect(html).not.toContain('>Learn my writing style<');expect(html).toContain("Check writing style status");
});
