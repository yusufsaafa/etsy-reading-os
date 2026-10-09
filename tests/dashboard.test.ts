import { it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
const mocks=vi.hoisted(()=>({scope:vi.fn(),data:vi.fn()}));
vi.mock("../src/modules/identity/session",()=>({currentScope:mocks.scope}));
vi.mock("../src/db/client",()=>({database:()=>({})}));
vi.mock("../src/modules/dashboard/service",()=>({dashboardData:mocks.data}));
import Home from "../src/components/operations-home";
import { Dashboard, DashboardError, DashboardLoading } from "../src/components/dashboard";
import { AccessDenied } from "../src/modules/identity/service";
import type { DashboardData } from "../src/modules/dashboard/service";
const empty:DashboardData={metrics:{total:0,pending:0,active:0,generated:0,attention:0},recent:[],attention:[],production:{queued:0,active:0,retry:0,attention:0}};
const row={id:"order-id",externalId:"2001",customer:"Customer",products:"Reading",count:2,status:"Production needs attention",date:"2026-10-01T12:00:00Z",priority:1};
beforeEach(()=>{vi.clearAllMocks();mocks.scope.mockResolvedValue({userId:"user",organizationId:"org",storeId:"store"});mocks.data.mockResolvedValue(empty);});
async function content(){const home=await Home();const child=home.props.children as ReactElement<{scope:never}>;return (child.type as (props:typeof child.props)=>Promise<ReactElement>)(child.props);}
it("renders real sections, metrics, order links and supported workspace destinations",()=>{
  const html=renderToStaticMarkup(createElement(Dashboard,{data:{...empty,metrics:{total:12,pending:4,active:3,generated:2,attention:3},recent:[row],attention:[row]}}));
  for(const text of ["Dashboard","Total Orders","Pending Orders","In Production","Generated Orders","Requires Attention","Recent Orders","Production Overview"])expect(html).toContain(text);
  for(const path of ["/orders/order-id","/orders","/products","/pdf-studio"])expect(html).toContain(`href="${path}"`);
  expect(html).not.toContain('href="/production"');expect(html).not.toContain("Retry production");expect(html).not.toContain("Completed Orders");
});
it("shows useful empty states without placeholder controls",()=>{
  const html=renderToStaticMarkup(createElement(Dashboard,{data:empty}));
  expect(html).toContain("No orders yet");expect(html).toContain("No reading issues require attention");expect(html).toContain("No queued, active, retrying or attention entries");expect(html).toContain('href="/settings"');
});
it("loading has an accessible busy state and errors never fabricate operational zeros",()=>{
  const loading=renderToStaticMarkup(createElement(DashboardLoading));expect(loading).toContain('aria-busy="true"');expect(loading).not.toContain("No orders");
  const error=renderToStaticMarkup(createElement(DashboardError));expect(error).toContain('role="alert"');expect(error).toContain("could not be loaded");expect(error).not.toContain("<dd>");
});
it("loads the authorized scope and supplies a streamed loading fallback",async()=>{
  const home=await Home();expect(home.props.fallback.type).toBe(DashboardLoading);
  expect((await content()).type).toBe(Dashboard);expect(mocks.data).toHaveBeenCalledWith({},await mocks.scope());
});
it.each(["/sign-in","/onboarding","/onboarding/products"])("retains authentication and onboarding boundary %s",async path=>{
  mocks.scope.mockRejectedValueOnce(new Error(`redirect:${path}`));await expect(Home()).rejects.toThrow(`redirect:${path}`);expect(mocks.data).not.toHaveBeenCalled();
});
it("renders a safe data error and preserves authorization failures",async()=>{
  mocks.data.mockRejectedValueOnce(new Error("private provider details"));expect((await content()).type).toBe(DashboardError);
  mocks.data.mockRejectedValueOnce(new AccessDenied());await expect(content()).rejects.toThrow("Resource unavailable");
});
it("scopes responsive styles to the Dashboard with reflow and touch targets",()=>{
  const css=readFileSync("src/components/dashboard.module.css","utf8");
  expect(css).toContain("@media(max-width:760px)");expect(css).toContain("repeat(2,minmax(0,1fr))");expect(css).toContain("grid-template-columns:minmax(0,1fr)");expect(css).toContain("min-height:44px");expect(css).toContain("prefers-reduced-motion");
});
it("keeps real store integration warnings actionable",()=>{
  const html=renderToStaticMarkup(createElement(Dashboard,{data:{...empty,storeNotice:"Your last store update could not finish."}}));
  expect(html).toContain("Your last store update could not finish.");expect(html).toContain("Review store integration");
});
