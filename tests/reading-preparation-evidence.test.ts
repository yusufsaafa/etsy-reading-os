import {it,expect,vi,beforeEach} from "vitest";
const reads=vi.hoisted(()=>({history:vi.fn(),accounting:vi.fn(),profile:vi.fn()}));
vi.mock("@/db/client",()=>({database:()=>({})}));
vi.mock("@/modules/generation/service",()=>({generationHistory:reads.history,generationAccounting:reads.accounting}));
vi.mock("@/modules/seller-style/service",()=>({sellerStyleData:reads.profile}));
vi.mock("../src/components/generation/prepare-form",()=>({PrepareForm:()=>null}));
import {ReadingPreparation} from "../src/components/generation/reading-preparation";
import {PrepareForm} from "../src/components/generation/prepare-form";
const props={scope:{userId:"user",organizationId:"org",storeId:"store"},unitId:"unit",eligible:true,currentRevision:0};
beforeEach(()=>vi.clearAllMocks());
it.each(["prepare","retry"] as const)("batched %s evidence reuses only the existing command form with no per-reading reads",async mode=>{
 const element=await ReadingPreparation({...props,evidence:{mode,generationId:"owned-generation",message:""}});expect(element?.type).toBe(PrepareForm);expect(element?.props.unitId).toBe("unit");expect(element?.props.retryGenerationId).toBe(mode==="retry"?"owned-generation":undefined);for(const read of Object.values(reads))expect(read).not.toHaveBeenCalled();
});
it("blocked evidence renders no form; existing review link reads no history or accounting",async()=>{
 expect(await ReadingPreparation({...props,evidence:{mode:null,message:""}})).toBeNull();
 const element=await ReadingPreparation({...props,reviewHref:"/orders/owned/readings/unit/review",evidence:{mode:null,message:""}});expect(element?.props.children.props.href).toBe("/orders/owned/readings/unit/review");expect(element?.props.children.props.children).toBe("View Reading");for(const read of Object.values(reads))expect(read).not.toHaveBeenCalled();
});
