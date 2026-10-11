import {it,expect} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import {syncOrderCommand,syncFailure} from "../src/modules/orders/sync";
import {ReceiptPilotError} from "../src/modules/etsy/receipt-read";
import {AccessDenied} from "../src/modules/identity/service";
import {OrderSync} from "../src/components/order-sync";
import {purchasedChoices} from "../src/modules/orders/purchased-choices";
import {normalizeEtsyReceipt} from "../src/modules/etsy/raw-normalizer";
import {rawReceipt} from "./fixtures/etsy-raw";
import {OrderList} from "../src/components/order-list";
import type {ExternalOrder} from "../src/modules/intake/contracts";
const commandId="00000000-0000-4000-8000-000000000001";
it("sync command accepts only explicit receipt and command identity",()=>{
 expect(syncOrderCommand.parse({receiptId:"900",commandId})).toEqual({receiptId:"900",commandId});
 for(const raw of [{receiptId:"900",commandId,storeId:"forged"},{receiptId:"900",commandId,approvedVersions:{}},{receiptId:"0",commandId},{receiptId:"900/../1",commandId}])expect(()=>syncOrderCommand.parse(raw)).toThrow();
});
it.each([[new ReceiptPilotError("detail",429,30),"30 seconds"],[new ReceiptPilotError("detail",401),"Reauthorize"],[new ReceiptPilotError("detail",500),"No receipt was imported"],[new DOMException("secret","TimeoutError"),"timed out"],[new Error("CONNECTION_CHANGED"),"connection changed"],[new AccessDenied(),"Only the Store owner"],[new Error("SHOP_OWNER_MISMATCH"),"ownership"]])("maps bounded safe transport errors",(error,message)=>{expect(syncFailure(error)).toContain(message);expect(syncFailure(error)).not.toContain("secret");});
it("unexpected errors never serialize source or database details",()=>{expect(syncFailure(new Error("private token/customer/db failure"))).not.toContain("private");});
it("owner form has accessible explicit receipt controls and disconnected/operator views have no command",()=>{
 const action=async()=>({message:"done"});const enabled=renderToStaticMarkup(createElement(OrderSync,{access:{allowed:true,reason:"Connected"},commandId,action}));expect(enabled).toContain('name="receiptId"');expect(enabled).toContain('name="commandId"');expect(enabled).toContain('aria-describedby="sync-explanation"');expect(enabled).toContain("Sync Orders");expect(enabled).not.toContain('name="storeId"');
 for(const reason of ["Connect Etsy", "Only the Store owner", "Missing order access"]){const disabled=renderToStaticMarkup(createElement(OrderSync,{access:{allowed:false,reason},commandId,action}));expect(disabled).toContain(reason);expect(disabled).not.toContain('name="receiptId"');}
});
it("purchased choices project retained labels and identities without modifying evidence",()=>{
 const source=normalizeEtsyReceipt(JSON.stringify(rawReceipt()),{verifiedShopId:"77",observedAt:1700000000})[0];
 const snapshot={etsySource:source,variations:[]} as unknown as ExternalOrder["lines"][number];const before=JSON.stringify(source);const display=purchasedChoices(snapshot);expect(display.length).toBeGreaterThan(0);expect(display.join()).toContain("property");expect(JSON.stringify(source)).toBe(before);
 const label=source.purchaseSelections[0];label.formattedName={presence:"absent"};label.formattedValues={presence:"absent"};expect(purchasedChoices(snapshot)[0]).toContain("Value IDs");
 expect(purchasedChoices({variations:[{label:"Detail",value:"Extended"}]} as ExternalOrder["lines"][number])).toEqual(["Detail: Extended"]);
});
it("PDF and approval queue labels explicitly avoid false delivery completion",()=>{
 for(const status of ["Approved","PDF Ready"]){const html=renderToStaticMarkup(createElement(OrderList,{rows:[{id:"id",externalId:"900",customer:"",products:"Reading",count:1,status,date:"2026-10-11T00:00:00Z",priority:4}]}));expect(html).toContain("Delivery not yet implemented");expect(html).not.toContain("Delivered");}
});
it("sync is wired only to a server action and never to GET/page loading or fixture jobs",()=>{
 const route=readFileSync("src/app/(operations)/orders/page.tsx","utf8"),action=readFileSync("src/app/(operations)/orders/actions.ts","utf8"),service=readFileSync("src/modules/orders/sync.ts","utf8");
 expect(route).not.toContain("syncOrderReceipt(");expect(action).toContain('"use server"');expect(action).toContain("currentScope()");expect(service).not.toContain("readOwnedReceiptSample");expect(service).toContain("suppressProductionAdmission:true");
});
