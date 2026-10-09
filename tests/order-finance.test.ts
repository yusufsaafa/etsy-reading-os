import {it,expect,vi,afterEach} from "vitest";
import {receiptFinance} from "../src/modules/orders-finance/source";
import {receiptMoneySchema,formatReceiptMoney} from "../src/modules/orders-finance/money";
import {normalizeEtsyReceipt} from "../src/modules/etsy/raw-normalizer";
import {sourceFingerprint} from "../src/modules/etsy/source-fingerprint";
import {readReceiptDetail,ReceiptPilotError} from "../src/modules/etsy/receipt-read";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {OrderDetailView,type DetailView} from "../src/components/order-detail";
import {readFileSync} from "node:fs";
const raw=(grandtotal:unknown={amount:2499,divisor:100,currency_code:"USD"})=>({receipt_id:2001,updated_timestamp:100,is_paid:true,status:"paid",refunds:[],grandtotal,transactions:[{transaction_id:3001,receipt_id:2001,listing_id:101,is_digital:true,quantity:1,variations:[]}],created_timestamp:90});
afterEach(()=>vi.unstubAllEnvs());
it.each([[2499,100,"24.99 USD"],[1850,100,"18.50 EUR"],[1234,1000,"1.234 BHD"],[550,1,"550 JPY"],[1,8,"0.125 USD"],[0,100,"0.00 USD"]])("formats exact amount %s divisor %s",(amount,divisor,label)=>{const currency=label.split(" ").at(-1)!;expect(formatReceiptMoney({amount:String(amount),divisor:String(divisor),currency})).toBe(label);});
it("preserves int64 beyond Number precision and locale decimal/grouping without conversion",()=>{
 const body=JSON.stringify(raw()).replace('"amount":2499','"amount":9223372036854775807');const evidence=receiptFinance(body,"123","2001");expect(evidence.total?.amount).toBe("9223372036854775807");
 expect(formatReceiptMoney(evidence.total!)).toBe("92,233,720,368,547,758.07 USD");expect(formatReceiptMoney({amount:"123456",divisor:"100",currency:"EUR"},"de-DE")).toBe("1.234,56 EUR");
});
it.each([{amount:1.5,divisor:100,currency_code:"USD"},{amount:Number.MAX_SAFE_INTEGER+1,divisor:100,currency_code:"USD"},{amount:-1,divisor:100,currency_code:"USD"},{amount:1,divisor:0,currency_code:"USD"},{amount:1,divisor:3,currency_code:"USD"},{amount:1,divisor:1024,currency_code:"USD"},{amount:1,divisor:100,currency_code:"usd"},{amount:1,divisor:100},{amount:"01",divisor:100,currency_code:"USD"},{amount:"9223372036854775808",divisor:100,currency_code:"USD"}])("rejects invalid money %j",money=>{expect(receiptMoneySchema.safeParse(money).success).toBe(false);if(money.amount!==Number.MAX_SAFE_INTEGER+1)expect(receiptFinance(JSON.stringify(raw(money)),"123","2001").state).toBe("INVALID");});
it("distinguishes missing, invalid, uncertain and explicit zero source evidence",()=>{
 expect(receiptFinance(JSON.stringify(raw(null)),"123","2001").state).toBe("MISSING");expect(receiptFinance(JSON.stringify(raw({amount:0,divisor:1,currency_code:"JPY"})),"123","2001").total?.amount).toBe("0");
 for(const patch of [{refunds:[{amount:{amount:10,divisor:100,currency_code:"USD"}}]},{is_paid:false},{status:"open"},{refunds:undefined},{updated_timestamp:undefined},{update_timestamp:101}])expect(receiptFinance(JSON.stringify({...raw(),...patch}),"123","2001").state).toBe("UNCERTAIN");
 expect(()=>receiptFinance(JSON.stringify(raw()),"123","9999")).toThrow("FINANCE_RECEIPT_MISMATCH");
});
it("money changes never enter the existing operational normalization or fingerprint",()=>{
 const a=normalizeEtsyReceipt(JSON.stringify(raw()),{verifiedShopId:"123",observedAt:100});
 const b=normalizeEtsyReceipt(JSON.stringify(raw({amount:55000,divisor:1000,currency_code:"BHD"})),{verifiedShopId:"123",observedAt:101});
 expect(sourceFingerprint(a[0])).toBe(sourceFingerprint(b[0]));expect(JSON.stringify(a)).not.toContain("grandtotal");
});
it("bounded receipt GET retains rate-limit Retry-After with no automatic retries",async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response("{}",{status:429,headers:{"content-type":"application/json","retry-after":"120"}}));
 const error=await readReceiptDetail("123","2001","private",{clientId:"key",secret:"secret"},fetcher).catch(e=>e);expect(error).toBeInstanceOf(ReceiptPilotError);expect(error.retryAfterSeconds).toBe(120);expect(fetcher).toHaveBeenCalledOnce();expect(error.message).not.toContain("private");
});
const view:DetailView={reference:"order",customer:"Buyer",date:"2026-10-09",status:"Pending",payment:"Paid",items:[]};
it("Summary shows verified amount/currency and existing actions; missing evidence never becomes zero",()=>{
 const html=renderToStaticMarkup(createElement(OrderDetailView,{data:{...view,finance:{state:"VERIFIED",total:{amount:"2499",divisor:"100",currency:"USD"}}},backHref:"/orders"}));
 for(const label of ["24.99 USD","Order Total","Total Readings","Generated","Needs Attention","Payment Status","Paid","View Purchase Information","View Activity"])expect(html).toContain(label);
 const missing=renderToStaticMarkup(createElement(OrderDetailView,{data:view,backHref:"/orders"}));expect(missing).toContain("Amount unavailable");expect(missing).not.toContain("0.00 USD");
 const sample=renderToStaticMarkup(createElement(OrderDetailView,{data:{...view,sample:true,finance:{state:"VERIFIED",total:{amount:"2499",divisor:"100",currency:"USD"}}},backHref:"/orders"}));expect(sample).not.toContain("24.99 USD");expect(sample).not.toContain("Order Total");
});
it("uses consistent metric SVG/value/label layout, responsive grid and secondary dialog actions",()=>{
 const css=readFileSync("src/components/order-detail.module.css","utf8");for(const token of ["repeat(auto-fit,minmax(140px,1fr))","repeat(2,minmax(0,1fr))",".metricValue","font-weight:600",".metricLabel","flex:0 0 20px",".summaryActions > button:focus-visible"])expect(css).toContain(token);
 expect(readFileSync("src/components/order-detail.tsx","utf8")).not.toMatch(/\p{Extended_Pictographic}/u);
});
