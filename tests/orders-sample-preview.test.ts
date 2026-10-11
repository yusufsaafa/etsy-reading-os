import {it,expect,vi,beforeEach,afterEach} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
const mocks=vi.hoisted(()=>({scope:vi.fn(),verify:vi.fn(),data:vi.fn(),db:{select:vi.fn(),insert:vi.fn(),update:vi.fn(),delete:vi.fn(),execute:vi.fn()}}));
vi.mock("@/modules/identity/session",()=>({currentScope:mocks.scope}));
vi.mock("@/modules/intake/service",()=>({verifyScope:mocks.verify}));
vi.mock("@/db/client",()=>({database:()=>mocks.db}));
vi.mock("@/modules/orders/work-queue",()=>({ordersWorkQueue:mocks.data}));
vi.mock("@/modules/orders/sync",()=>({orderSyncAccess:async()=>({allowed:false,reason:"Fixture access"})}));
import Page from "../src/app/(operations)/orders/page";
import {ordersQuery,ordersHref} from "../src/modules/orders/query";
import * as samples from "../src/modules/orders/sample-preview";
const scope={userId:"u",organizationId:"o",storeId:"s"};
const real={rows:[],total:0,matched:0,page:1,pages:1,connectionAttention:false};
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("NODE_ENV","development");mocks.scope.mockResolvedValue(scope);mocks.verify.mockResolvedValue(undefined);mocks.data.mockResolvedValue(real);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function page(params:Record<string,unknown>={}){return Page({searchParams:Promise.resolve(params)});}
it.each(["production","test"])("rejects fixture access and ignores preview activation in %s",async env=>{
 vi.stubEnv("NODE_ENV",env);expect(()=>samples.sampleOrdersData(ordersQuery())).toThrow("unavailable");
 const result=await page({preview:"sample"}),markup=renderToStaticMarkup(result);
 expect(result.props.data).toBe(real);expect(result.props.previewAvailable).toBe(false);expect(markup).not.toContain("Preview Sample Orders");expect(markup).not.toContain("SAMPLE DATA");expect(mocks.data).toHaveBeenCalledOnce();
});
it.each(["/sign-in","/onboarding","/onboarding/products"])("requires the existing access boundary %s before sample access",async path=>{
 const sample=vi.spyOn(samples,"sampleOrdersData");mocks.scope.mockRejectedValueOnce(new Error("redirect:"+path));
 await expect(page({preview:"sample"})).rejects.toThrow(path);expect(sample).not.toHaveBeenCalled();expect(mocks.verify).not.toHaveBeenCalled();expect(mocks.data).not.toHaveBeenCalled();
});
it("revalidates authorized store scope before accessing fixtures",async()=>{
 const sample=vi.spyOn(samples,"sampleOrdersData");mocks.verify.mockRejectedValueOnce(new Error("Resource unavailable"));
 await expect(page({preview:"sample"})).rejects.toThrow("Resource unavailable");expect(sample).not.toHaveBeenCalled();expect(mocks.verify).toHaveBeenCalledWith(mocks.db,scope);
});
it("renders samples through the real Orders UI with isolated detail links and no database writes",async()=>{
 const result=await page({preview:"sample"}),markup=renderToStaticMarkup(result);
 expect(result.props.data.total).toBe(50);expect(result.props.data.rows).toHaveLength(20);expect(markup).toContain("SAMPLE DATA");expect(markup).toContain("Exit Preview");expect(markup).toContain('name="preview" value="sample"');expect(markup).toContain('aria-label="Orders pagination"');expect(markup).toContain('role="table"');expect(markup).not.toMatch(/href="\/orders\/DEMO/);expect(markup).toContain("/orders/preview/DEMO-1001");
 expect(mocks.data).not.toHaveBeenCalled();for(const operation of Object.values(mocks.db))expect(operation).not.toHaveBeenCalled();
});
it("exits preview to real data and validates the exact activation token",async()=>{
 const preview=await page({preview:"sample"});expect(renderToStaticMarkup(preview)).toMatch(/href="\/orders"[^>]*>Exit Preview/);
 for(const value of [undefined,"true","sample-extra",["sample"]]){
  const result=await page({preview:value});expect(result.props.data).toBe(real);expect(result.props.samplePreview).toBeUndefined();expect(result.props.previewAvailable).toBe(true);
 }
});
it("offers the control only on the authorized development page",async()=>{
 expect(renderToStaticMarkup(await page())).toContain('href="/orders?preview=sample"');expect(mocks.data).toHaveBeenCalledWith(mocks.db,scope,ordersQuery());
});
it("provides deterministic varied fictional records across all five states and three pages",()=>{
 const query=ordersQuery(),first=samples.sampleOrdersData(query),second=samples.sampleOrdersData({...query,page:2}),third=samples.sampleOrdersData({...query,page:3});
 const rows=[...first.rows,...second.rows,...third.rows];
 expect(rows).toHaveLength(50);expect(new Set(rows.map(r=>r.id)).size).toBe(50);expect(rows.every(r=>/^DEMO-10\d\d$/.test(r.id)&&r.customer.length>0)).toBe(true);
 expect(new Set(rows.map(r=>r.date)).size).toBeGreaterThan(10);expect(new Set(rows.map(r=>r.count)).size).toBe(7);expect(rows.some(r=>!r.products)).toBe(true);expect(rows.some(r=>r.products.includes(" · "))).toBe(true);expect(samples.sampleOrdersData(query)).toEqual(first);
 for(const filter of ["pending","production","generated","attention","canceled"])expect(samples.sampleOrdersData(ordersQuery({filter})).matched).toBe(10);
});
it("supports literal search, combined filters, both sorts and clamped pagination",()=>{
 expect(samples.sampleOrdersData(ordersQuery({q:"demo-1001"})).rows[0].externalId).toBe("DEMO-1001");
 expect(samples.sampleOrdersData(ordersQuery({q:"DEMO-1001",filter:"generated"})).matched).toBe(0);
 expect(samples.sampleOrdersData(ordersQuery({q:"%"})).matched).toBe(0);
 const newest=samples.sampleOrdersData(ordersQuery()),oldest=samples.sampleOrdersData(ordersQuery({sort:"oldest"}));
 expect(newest.rows[0].externalId).toBe("DEMO-1001");expect(oldest.rows[0].externalId).toBe("DEMO-1050");
 expect(samples.sampleOrdersData(ordersQuery({page:"999"})).page).toBe(3);
 expect(ordersHref({...ordersQuery(),preview:"sample"},{page:2})).toContain("preview=sample");
 expect(ordersQuery({preview:"sample"})).not.toHaveProperty("preview");
});
