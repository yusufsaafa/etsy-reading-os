import {it,expect,vi,beforeEach} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
const mocks=vi.hoisted(()=>({scope:vi.fn(),data:vi.fn()}));
vi.mock("@/modules/identity/session",()=>({currentScope:mocks.scope}));
vi.mock("@/db/client",()=>({database:()=>({})}));
vi.mock("@/modules/orders/work-queue",()=>({ordersWorkQueue:mocks.data}));
vi.mock("@/modules/etsy/automatic-intake",()=>({automaticIntakeStatus:async()=>"Etsy connected. Automatic intake is not enabled in this environment."}));
import Page from "../src/app/(operations)/orders/page";
import {OrdersListPage,OrdersError,OrdersLoading} from "../src/components/orders-list-page";
import {orderTone} from "../src/components/order-list";
import {ordersQuery,ordersHref,literalOrderSearch} from "../src/modules/orders/query";
import {AccessDenied} from "../src/modules/identity/service";
import type {OrdersData} from "../src/modules/orders/service";
const row={id:"order-id",externalId:"1024",customer:"",products:"Retained reading ×2",count:2,status:"Pending",date:"2026-10-09T12:00:00Z",priority:4};
const empty:OrdersData={rows:[],total:0,matched:0,page:1,pages:1,connectionAttention:false};
beforeEach(()=>{vi.clearAllMocks();mocks.scope.mockResolvedValue({userId:"u",organizationId:"o",storeId:"s"});mocks.data.mockResolvedValue(empty);});
const html=(data=empty,query=ordersQuery())=>renderToStaticMarkup(createElement(OrdersListPage,{data,query}));
it.each([{}, {q:["secret"],filter:"invalid",sort:"invalid",page:"0"},{page:"1.2"},{page:"-1"},{page:["2"]}])("validates URL parameters safely",params=>{expect(ordersQuery(params)).toEqual({q:"",filter:"all",sort:"newest",page:1});});
it("bounds search, escapes literal SQL wildcards and preserves combined state in pagination links",()=>{
 const query=ordersQuery({q:"  Love %_  ",filter:"attention",sort:"oldest",page:"3"});
 expect(query).toEqual({q:"Love %_",filter:"attention",sort:"oldest",page:3});expect(literalOrderSearch("%_\\")).toBe("%\\%\\_\\\\%");
 expect(ordersQuery({q:"x".repeat(300)}).q).toHaveLength(200);
 expect(ordersHref(query,{page:4})).toContain("page=4");expect(ordersHref(query,{filter:"all",page:1})).not.toContain("page=");
});
it("renders accessible search, all reliable status filters and no inline information disclosures",()=>{
 const markup=html();expect(markup).toContain('role="search"');expect(markup).toContain('placeholder="Search orders..."');expect(markup).toContain('aria-label="Order status filters"');
 for(const label of ["All","Pending","In Production","Generated","Needs Attention","Canceled"])expect(markup).toContain(label);
 expect(markup).toContain('aria-current="page"');expect(markup).not.toContain("<details");expect(markup).not.toContain("Completed");
});
it("renders real persisted identity/context, truthful status, UTC purchase date and detail navigation",()=>{
 const markup=html({...empty,rows:[row],total:1,matched:1});expect(markup).toContain("#1024");expect(markup).toContain("Retained reading ×2");expect(markup).toContain('href="/orders/order-id?filter=all&amp;sort=newest"');expect(markup).toContain('aria-label="Open order 1024"');expect(markup).toContain("Oct 9, 2026");expect(markup).toContain('scope="col"');expect(markup).not.toContain("Delivered");
});
it.each([["Pending",4,"neutral"],["In production",4,"neutral"],["Generated",4,"good"],["Information or setup needed",3,"warning"],["Canceled",1,"neutral"]])("uses restrained tone for %s",(status,priority,tone)=>{expect(orderTone({...row,status,priority:Number(priority)})).toBe(tone);});
it("distinguishes lifetime empty, search empty and filter empty with truthful connection guidance",()=>{
 expect(html()).toContain("No imported orders");
 expect(html({...empty,total:10},ordersQuery({q:"unknown"}))).toContain("No matching orders");
 expect(html({...empty,total:10},ordersQuery({filter:"generated"}))).toContain("No orders in this status");
 expect(html({...empty,connectionAttention:true})).toContain('href="/settings"');expect(html()).not.toContain("Review your store connection");
});
it("pagination reports matching results and preserves filters/search/sort",()=>{
 const markup=html({...empty,rows:[row],total:100,matched:41,page:2,pages:3},ordersQuery({q:"Love",filter:"pending",sort:"oldest",page:"2"}));
 expect(markup).toContain("21–40 of 41 orders");expect(markup).toContain('aria-label="Orders pagination"');expect(markup).toContain("page=3");expect(markup).toContain("sort=oldest");expect(markup).toContain("q=Love");expect(markup).toContain('rel="prev"');
});
it("preserves auth/onboarding boundaries before querying",async()=>{
 for(const path of ["/sign-in","/onboarding","/onboarding/products"]){mocks.scope.mockRejectedValueOnce(new Error("redirect:"+path));await expect(Page({searchParams:Promise.resolve({})})).rejects.toThrow(path);}
 expect(mocks.data).not.toHaveBeenCalled();
});
it("loads only authorized scope and normalized URL state; safe errors preserve reload and access denial",async()=>{
 const result=await Page({searchParams:Promise.resolve({filter:"generated",page:"2"})});expect(result.type).toBe(OrdersListPage);expect(mocks.data).toHaveBeenCalledWith({},await mocks.scope(),ordersQuery({filter:"generated",page:"2"}));
 mocks.data.mockRejectedValueOnce(new Error("private SQL"));const error=await Page({searchParams:Promise.resolve({q:"Love"})});expect(error.type).toBe(OrdersError);expect(renderToStaticMarkup(error)).not.toContain("private SQL");expect(renderToStaticMarkup(error)).not.toContain("0 matching orders");
 mocks.data.mockRejectedValueOnce(new AccessDenied());await expect(Page({searchParams:Promise.resolve({})})).rejects.toThrow("Resource unavailable");
});
it("preserves accessible loading and narrow responsive table contracts",()=>{
 expect(renderToStaticMarkup(createElement(OrdersLoading))).toContain('aria-busy="true"');
 const css=readFileSync("src/components/orders.module.css","utf8");expect(css).toContain("@media(max-width:760px)");expect(css).toContain("minmax(0,1fr) minmax(0,120px)");expect(css).toContain("min-height:44px");expect(css).toContain("prefers-reduced-motion");
});
