import { it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
const mocks=vi.hoisted(()=>({scope:vi.fn(),data:vi.fn()}));
vi.mock("../src/modules/identity/session",()=>({currentScope:mocks.scope}));
vi.mock("../src/db/client",()=>({database:()=>({})}));
vi.mock("../src/modules/dashboard/service",()=>({dashboardData:mocks.data}));
import Home from "../src/components/operations-home";
import { Dashboard, DashboardError, DashboardLoading, integrationPresentation } from "../src/components/dashboard";
import { AccessDenied } from "../src/modules/identity/service";
import { dashboardRange, dashboardWindow } from "../src/modules/dashboard/range";
import type { DashboardData, DashboardIntegration } from "../src/modules/dashboard/service";
const empty:DashboardData={metrics:{total:0,pending:0,active:0,generated:0,attention:0},recent:[],attention:[],production:{queued:0,active:0,retry:0,attention:0},integration:{source:"etsy",connectionStatus:"connected",expired:false,syncStatus:null},analytics:{days:7,start:"2026-10-03T00:00:00Z",cutoff:"2026-10-09T12:00:00Z",orders:0,daily:Array.from({length:7},(_,i)=>({date:`2026-10-0${i+3}`,count:0})),topProducts:[],averageAiMs:null,aiSamples:0}};
const row={id:"order-id",externalId:"2001",customer:"Customer",products:"Reading",count:2,status:"Production needs attention",date:"2026-10-01T12:00:00Z",priority:1};
const business:DashboardData={...empty,metrics:{total:12,pending:4,active:3,generated:2,attention:0},recent:[row],analytics:{...empty.analytics,orders:2,daily:empty.analytics.daily.map((day,i)=>({...day,count:i===6?2:0})),topProducts:[{listingId:"101",title:"Love Reading",orders:2}],averageAiMs:8400,aiSamples:2}};
const html=(data:DashboardData)=>renderToStaticMarkup(createElement(Dashboard,{data}));
beforeEach(()=>{vi.clearAllMocks();mocks.scope.mockResolvedValue({userId:"user",organizationId:"org",storeId:"store"});mocks.data.mockResolvedValue(empty);});
async function content(range?:unknown){const home=await Home({range});const child=home.props.children as ReactElement<{scope:never;range:never;cutoff:Date}>;return (child.type as (props:typeof child.props)=>Promise<ReactElement>)(child.props);}
it.each([["7",7],["30",30],["90",90],["invalid",30],[undefined,30],["07",30],[["7","90"],30]])("normalizes range %s",(value,expected)=>{expect(dashboardRange(value)).toBe(expected);});
it("uses UTC calendar days across daylight saving and local offsets",()=>{expect(dashboardWindow("7",new Date("2026-10-09T22:30:00+03:00"))).toEqual({days:7,start:"2026-10-03T00:00:00.000Z",cutoff:"2026-10-09T19:30:00.000Z"});expect(dashboardWindow("7",new Date("2026-11-02T01:00:00Z")).start).toBe("2026-10-27T00:00:00.000Z");});
it("renders exactly four compact KPIs, range links and accessible definitions",()=>{
  const markup=html(business),overview=markup.match(/<section aria-label="Operational overview">([\s\S]*?)<\/section>/)![1];
  expect(overview.match(/<dt>/g)).toHaveLength(4);for(const label of ["Orders","Generated Orders","Issues","Avg AI Execution"])expect(overview).toContain(label);
  expect(overview).toContain("8.4s");expect(markup).not.toContain("<details");for(const label of ["Orders","Generated Orders","Issues","Avg AI Execution"])expect(overview).toContain(`aria-label="${label} definition"`);expect(markup).toContain("2 eligible samples");
  expect(markup).toContain('aria-label="Dashboard date range"');for(const range of [7,30,90])expect(markup).toContain(`href="/?range=${range}"`);
  expect(markup).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/\?range=7"|<a[^>]*href="\/\?range=7"[^>]*aria-current="page"/);
});
it("zero orders retain all core sections with compact empty states and one guidance message",()=>{
  const markup=html(empty);expect(markup).toContain('data-layout="unified"');expect(markup).toContain('data-activity="empty"');
  for(const title of ["Order Activity","Requires Attention","Recent Orders","Top Products"])expect(markup).toContain(title+"</h2>");
  expect(markup).toContain("No imported orders yet.");expect(markup).toContain("No product activity in this period.");expect(markup).toContain("All clear");
  expect(markup.match(/Live updates are not enabled/g)).toHaveLength(1);expect(markup).not.toContain("Your workspace is ready");
  expect(markup).not.toContain('viewBox="0 0 600 170"');expect(markup).not.toContain("<ol");expect(markup).not.toContain("0.0s");
});
it("business overview shows real chart values, ranking and lifetime order links",()=>{
  const markup=html(business);expect(markup).toContain('data-layout="unified"');expect(markup).toContain("Order Activity");expect(markup).toContain('viewBox="0 0 600 170"');expect(markup).toContain('aria-label="Daily values · Today is partial"');expect(markup).toContain("2026-10-03");expect(markup).toContain("Today is partial");expect(markup).toContain("Love Reading");expect(markup).toContain('href="/orders/order-id"');expect(markup).toContain('href="/orders"');expect(markup).toContain("All clear");expect(markup).not.toContain("Production Overview");
});
it("attention remains prominent in its fixed position independent of range activity",()=>{
  const markup=html({...business,metrics:{...business.metrics,attention:1},attention:[row],analytics:{...empty.analytics}});
  expect(markup).toContain("attentionPanel");expect(markup.indexOf('id="order-trend-title"')).toBeLessThan(markup.indexOf('id="dashboard-attention"'));expect(markup).toContain("Production needs attention");expect(markup).toContain('aria-label="Review order 2001"');expect(markup).not.toContain("All clear");
});
it("period-empty stores retain the unified layout and lifetime orders without a zero chart",()=>{
  const markup=html({...business,analytics:empty.analytics});expect(markup).toContain('data-layout="unified"');expect(markup).toContain("No imported orders in this period");expect(markup).toContain("No product activity in this period");expect(markup).not.toContain('viewBox="0 0 600 170"');expect(markup).toContain("Recent Orders");
});
it("shows only nonzero reading queue counts without adding controls",()=>{
  const markup=html({...business,production:{queued:2,active:1,retry:0,attention:0}});expect(markup).toContain("Reading queue");expect(markup).toContain("Queued");expect(markup).not.toContain("Retrying");expect(markup).not.toContain('href="/production"');expect(markup).not.toContain("Retry production");
});
it.each([
  [null,false,null,"Connection unavailable"],["disconnected",false,null,"Etsy disconnected"],["connected",false,null,"Etsy connected"],
  ["reauthorization_required",false,null,"Reauthorization required"],["connected",true,null,"Authorization expired"],
  ["connected",false,"queued","Import queued"],["connected",false,"running","Import running"],["connected",false,"failed","Import needs attention"],["connected",false,"succeeded","Etsy connected"],
] as const)("describes persisted integration %s / %s / %s",(connectionStatus,expired,syncStatus,label)=>{
  const integration:DashboardIntegration={source:"etsy",connectionStatus,expired,syncStatus};expect(integrationPresentation(integration).label).toBe(label);const markup=html({...empty,integration});expect(markup).toContain(label);if(syncStatus==="succeeded")expect(markup).toContain("No orders have been imported");
});
it("loading is accessible and safe query errors do not fabricate zero counts",()=>{
  expect(renderToStaticMarkup(createElement(DashboardLoading))).toContain('aria-busy="true"');const error=renderToStaticMarkup(createElement(DashboardError));expect(error).toContain('role="alert"');expect(error).not.toContain("<dd>");
});
it("passes authorized scope, normalized range and a single cutoff into the projection",async()=>{
  const home=await Home();expect(home.props.fallback.type).toBe(DashboardLoading);expect((await content("90")).type).toBe(Dashboard);expect(mocks.data).toHaveBeenCalledWith({},await mocks.scope(),90,expect.any(Date));
});
it.each(["/sign-in","/onboarding","/onboarding/products"])("retains access boundary %s",async path=>{mocks.scope.mockRejectedValueOnce(new Error(`redirect:${path}`));await expect(Home()).rejects.toThrow(`redirect:${path}`);expect(mocks.data).not.toHaveBeenCalled();});
it("renders safe query failure and propagates access denial",async()=>{mocks.data.mockRejectedValueOnce(new Error("private provider details"));expect((await content()).type).toBe(DashboardError);mocks.data.mockRejectedValueOnce(new AccessDenied());await expect(content()).rejects.toThrow("Resource unavailable");});
it("keeps responsive two-column and mobile reflow rules without CSS order",()=>{
  const css=readFileSync("src/components/dashboard.module.css","utf8");expect(css).toContain("minmax(0,2fr) minmax(0,1fr)");expect(css).toContain("repeat(2,minmax(0,1fr))");expect(css).toContain("@media(max-width:760px)");expect(css).toContain("min-height:44px");expect(css).not.toMatch(/\border\s*:/);expect(css).toContain("prefers-reduced-motion");
});
it("normalizes invalid URL range at the server boundary",async()=>{
  await content(["7","90"]);expect(mocks.data).toHaveBeenCalledWith({},await mocks.scope(),30,expect.any(Date));
});
it("query failure preserves the selected range on its working reload link",()=>{
  expect(renderToStaticMarkup(createElement(DashboardError,{days:90}))).toContain('href="/?range=90"');
});

it("keeps identical section positions for empty, populated and attention states",()=>{
  const sections=(data:DashboardData)=>[...html(data).matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g)].map(match=>match[1]);
  const expected=["order-trend-title","dashboard-attention","dashboard-recent","dashboard-products"];
  for(const data of [empty,business,{...business,metrics:{...business.metrics,attention:1},attention:[row]}])expect(sections(data)).toEqual(expected);
});
it("emphasizes real order identity with truthful status badges and no invented notifications",()=>{
  const markup=html(business);expect(markup).toContain('data-activity="populated"');expect(markup).toContain('class="badge neutral"');expect(markup).toContain(row.status);
  expect(markup).not.toMatch(/\b(?:NEW|UNREAD)\b/);expect(markup).not.toContain("No imported orders yet.");
});
it("does not show zero-order integration guidance on a populated store",()=>{
  const markup=html({...business,integration:{...business.integration,syncStatus:"succeeded"}});
  expect(markup).toContain("Etsy connected");expect(markup).not.toContain("No orders have been imported");
});

it("renders five recent purchases, ranked listings and attention using isolated populated fixtures",()=>{
  const recent=Array.from({length:5},(_,i)=>({...row,id:`order-${i}`,externalId:String(2001+i),products:i%2?"Career Reading":"Love Reading"}));
  const topProducts=[{listingId:"101",title:"Love Reading",orders:5},{listingId:"102",title:"Career Reading",orders:3},{listingId:"103",title:"Psychic Reading",orders:1}];
  const markup=html({...business,recent,attention:[recent[0]],metrics:{...business.metrics,attention:1},analytics:{...business.analytics,topProducts}});
  for(const order of recent)expect(markup).toContain(`aria-label="Open order ${order.externalId}"`);
  for(const product of topProducts)expect(markup).toContain(product.title);
  expect(markup).toContain('aria-label="Review order 2001"');expect(markup).toContain('width:60%');expect(markup).toContain("Order Activity</h2>");
});
it("keeps integration guidance in a keyboard and touch-accessible compact disclosure",()=>{
  const markup=html(empty);expect(markup).toContain('aria-label="Connection details"');expect(markup).not.toContain("<summary");expect(markup).toContain("Live updates are not enabled");
  const css=readFileSync("src/components/dashboard.module.css","utf8");expect(css).toContain("align-items:stretch");expect(css).toContain("min-height:122px");expect(css).not.toContain("!important");
});
