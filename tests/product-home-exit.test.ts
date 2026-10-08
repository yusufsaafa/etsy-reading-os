import {beforeEach,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({product:vi.fn(),catalog:vi.fn(),data:vi.fn(),finish:vi.fn(),scope:vi.fn(),redirect:vi.fn(),mutate:vi.fn(),db:{select:vi.fn()},source:"demo"}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("next/navigation",()=>({redirect:m.redirect,unstable_rethrow:vi.fn()}));
vi.mock("@/db/client",()=>({database:()=>m.db}));
vi.mock("@/modules/identity/session",()=>({currentStoreScope:m.scope,currentDestination:vi.fn()}));
vi.mock("@/modules/products/service",()=>({productData:m.product,catalogData:m.data,beginListingDraft:m.mutate,editProduct:m.mutate,saveProductDraft:m.mutate,activateProduct:m.mutate}));
vi.mock("@/modules/products/etsy-setup",()=>({getEtsySetupCatalog:m.catalog,beginSelectedEtsyDraft:vi.fn(),assertSetupPolicy:vi.fn()}));
vi.mock("@/infrastructure/secrets",()=>({vault:()=>({})}));
vi.mock("@/modules/onboarding/service",()=>({completeProductOnboarding:m.finish}));
import {checkProductOnboardingExit} from "../src/components/products/actions";
import {selectionKey} from "../src/modules/etsy/source-contract";
const choices=Array.from({length:6},(_,i)=>[{propertyId:"1",valueIds:[String(i+1)]}]);
const keys=choices.map(selectionKey);
const owned={userId:"owner",organizationId:"org",storeId:"store"};
function form(){const f=new FormData();f.set("productId","11111111-1111-4111-8111-111111111111");return f;}
function persisted(active:number,draft:number){return {products:keys.slice(0,active+draft).map((key,i)=>({id:key,activeVersionId:i<active?key:null})),mappings:keys.slice(0,active+draft).map(key=>({listingExternalId:"101",variantKey:key,productId:key})),versions:keys.slice(0,active+draft).map((key,i)=>({id:key,productId:key,status:i<active?"ACTIVE":"DRAFT",configuration:{etsyFulfillment:{listingId:"101",purchaseSelections:choices[i]}}}))};}
beforeEach(()=>{vi.clearAllMocks();m.source="demo";m.db.select.mockReturnValue({from:()=>({where:async()=>[{source:m.source}]})});m.scope.mockResolvedValue(owned);m.product.mockResolvedValue({active:{configuration:{etsyFulfillment:{listingId:"101"}}}});m.catalog.mockResolvedValue({state:"READY",listing:{id:"101"},configurations:keys.map(key=>({key}))});m.data.mockResolvedValue(persisted(1,0));});
it.each([[1,0,5],[1,5,5],[3,1,3]])("uses persisted exact coverage with %s active and %s drafts",async(active,draft,remaining)=>{m.data.mockResolvedValue(persisted(active,draft));expect(await checkProductOnboardingExit({},form())).toMatchObject({total:6,active,draft,remaining,unconfigured:6-active-draft,setupHref:"/onboarding/products/setup?listing=101"});expect(m.finish).not.toHaveBeenCalled();expect(m.mutate).not.toHaveBeenCalled();expect(m.product).toHaveBeenCalledWith(m.db,owned,expect.any(String));expect(m.data).toHaveBeenCalledWith(m.db,owned);expect(m.catalog).toHaveBeenCalledWith(m.db,owned,"101",{});});
it("all six active complete existing onboarding and navigate Home",async()=>{m.data.mockResolvedValue(persisted(6,0));await checkProductOnboardingExit({},form());expect(m.finish).toHaveBeenCalledWith(m.db,owned);expect(m.redirect).toHaveBeenCalledWith("/");});
it("unauthorized or missing product returns controlled error without catalog fetch/navigation",async()=>{m.product.mockRejectedValue(new Error("denied"));expect(await checkProductOnboardingExit({},form())).toHaveProperty("error");expect(m.catalog).not.toHaveBeenCalled();expect(m.finish).not.toHaveBeenCalled();});
it("unsupported catalog fails safely rather than claiming full coverage",async()=>{m.catalog.mockResolvedValue({state:"BLOCKED"});expect(await checkProductOnboardingExit({},form())).toHaveProperty("error");expect(m.finish).not.toHaveBeenCalled();});

it("owned non-Etsy active products retain existing completion without claiming Etsy coverage",async()=>{m.product.mockResolvedValue({active:{configuration:{}}});await checkProductOnboardingExit({},form());expect(m.catalog).not.toHaveBeenCalled();expect(m.finish).toHaveBeenCalledWith(m.db,owned);});
it("an Etsy product without exact active policy cannot fall back to demo completion",async()=>{m.source="etsy";m.product.mockResolvedValue({active:{configuration:{}}});expect(await checkProductOnboardingExit({},form())).toHaveProperty("error");expect(m.finish).not.toHaveBeenCalled();});
