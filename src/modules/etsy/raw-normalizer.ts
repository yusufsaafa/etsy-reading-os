import { z } from "zod";
import { etsyId, etsySourceSchema, type EtsySourceEvidence } from "./source-contract";

const integer = z.number().int().nonnegative().safe();
export const RAW_ETSY_RECEIPT_CONTRACT = "etsy-raw-receipt/1" as const;
// Numbers supplied by an already-decoded caller must be safe BEFORE conversion.
const id = z.union([etsyId, integer.positive().transform(String)]).refine(v=>/^\d+$/.test(v)&&BigInt(v)<=9223372036854775807n,{message:"Identifier outside int64"});
const propertyId = z.union([z.string().regex(/^(?:0|[1-9]\d{0,19})$/), integer.transform(String)]).refine(v=>/^\d+$/.test(v)&&BigInt(v)<=9223372036854775807n,{message:"Identifier outside int64"});
const display = z.string().max(500);
const optional = <T extends z.ZodType>(s:T) => s.nullable().optional();
const variation = z.object({
  property_id: optional(propertyId), value_id: optional(propertyId), question_id: optional(id),
  formatted_name: optional(display), formatted_value: optional(z.string().max(10000)),
  mime_type: optional(z.enum(["image/jpeg","image/png","image/gif","image/svg+xml","image/heif","image/heic","application/pdf"])),
}).strict();
const productData = z.object({property_id:optional(propertyId), property_name:optional(display),
  scale_id:optional(propertyId), scale_name:optional(display), value_ids:optional(z.array(propertyId).max(30)), values:optional(z.array(display).max(30)),
}).strict();
export const rawEtsyReceiptSchema = z.object({
  receipt_id:id, buyer_user_id:optional(id), is_paid:optional(z.boolean()), status:optional(z.string().max(80)),
  create_timestamp:optional(integer), created_timestamp:optional(integer),
  update_timestamp:optional(integer), updated_timestamp:optional(integer),
  refunds:optional(z.array(z.object({amount:optional(z.object({amount:integer,divisor:integer.positive(),currency_code:z.string().regex(/^[A-Z]{3}$/)}).strict()),
    created_timestamp:optional(integer),status:optional(z.string().max(80)),reason:optional(z.string().max(10000)),
  }).strict()).max(100)),
  transactions:z.array(z.object({transaction_id:id,buyer_user_id:optional(id),receipt_id:optional(id),listing_id:optional(id),
    quantity:integer.max(1000),sku:optional(z.string().max(500)),is_digital:optional(z.boolean()),
    variations:optional(z.array(variation).max(128)),product_data:optional(z.array(productData).max(3)),
  }).strict()).max(100),
}).strict().superRefine((r,ctx)=>{
  if(new Set(r.transactions.map(t=>t.transaction_id)).size!==r.transactions.length)ctx.addIssue({code:"custom",message:"Duplicate transaction identity"});
  for(const t of r.transactions){
    if(t.buyer_user_id!=null&&r.buyer_user_id!=null&&t.buyer_user_id!==r.buyer_user_id)ctx.addIssue({code:"custom",message:"Purchaser linkage mismatch"});
    if(t.receipt_id!=null&&t.receipt_id!==r.receipt_id)ctx.addIssue({code:"custom",message:"Receipt linkage mismatch"});
    const productIds=t.product_data?.filter(p=>p.property_id!=null).map(p=>p.property_id)??[];
    if(new Set(productIds).size!==productIds.length)ctx.addIssue({code:"custom",message:"Duplicate product property"});
    if(t.product_data?.some(p=>p.value_ids&&new Set(p.value_ids).size!==p.value_ids.length))ctx.addIssue({code:"custom",message:"Duplicate product value"});
    const properties=t.variations?.filter(v=>v.property_id!=null&&v.property_id!=="54"&&v.value_id!=null&&v.question_id==null&&v.mime_type==null).map(v=>v.property_id)??[];
    if(new Set(properties).size!==properties.length)ctx.addIssue({code:"custom",message:"Duplicate purchase property"});
  }
  for(const [a,b] of [[r.create_timestamp,r.created_timestamp],[r.update_timestamp,r.updated_timestamp]])
    if(a!=null&&b!=null&&a!==b)ctx.addIssue({code:"custom",message:"Timestamp alias mismatch"});
});

/** Bounded JSON parser: preserve large integer lexemes before JS numeric conversion.
 * Reject duplicate keys/deep objects. Errors deliberately contain no source values. */
export function parseEtsyJson(body:string):unknown {
  if(Buffer.byteLength(body,"utf8")>1048576)throw new Error("ETSY_RESPONSE_LIMIT");
  let at=0,nodes=0;
  const fail=():never=>{throw new Error("INVALID_ETSY_JSON");};
  const ws=()=>{while(/[\t\n\r ]/.test(body[at]??"x"))at++;};
  const string=()=>{const start=at++;while(at<body.length){if(body[at]==="\\"){at+=2;continue;}if(body[at++]==='"'){try{return JSON.parse(body.slice(start,at)) as string;}catch{return fail();}}}return fail();};
  const read=(depth:number):unknown=>{
    if(depth>20||++nodes>30000)fail();ws();const c=body[at];
    if(c==='"')return string();
    if(c==="{"||c==="["){
      const object=c==="{", end=object?"}":"]", result:Record<string,unknown>|unknown[]=object?Object.create(null):[];at++;ws();
      if(body[at]===end){at++;return result;}
      for(;;){ws();if(object){if(body[at]!=='"')fail();const key=string();if(Object.hasOwn(result,key))fail();ws();if(body[at++]!==":")fail();(result as Record<string,unknown>)[key]=read(depth+1);}else(result as unknown[]).push(read(depth+1));ws();if(body[at]===end){at++;return result;}if(body[at++]!==",")fail();}
    }
    const token=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(body.slice(at))?.[0];
    if(!token)return fail();at+=token.length;
    // The consumed contract has integer fields only. Retain non-integer lexical
    // forms as strings so decimal/exponent rounding cannot fabricate an ID/int.
    if(/^-?\d/.test(token)&&/[.eE]/.test(token))return token;
    if(/^-?\d+$/.test(token)&&!Number.isSafeInteger(Number(token)))return token;
    try{return JSON.parse(token) as unknown;}catch{return fail();}
  };
  const value=read(0);ws();if(at!==body.length)fail();return value;
}

// Full API responses contain unrelated buyer/commerce fields. Only explicit reviewed
// fields enter the strict subset; nested consumed structures are never stripped.
const receiptFields=["receipt_id","buyer_user_id","is_paid","status","create_timestamp","created_timestamp","update_timestamp","updated_timestamp","refunds","transactions"] as const;
const transactionFields=["transaction_id","buyer_user_id","receipt_id","listing_id","quantity","sku","is_digital","variations","product_data"] as const;
// Explicit non-consumed fields from the Part 3 official OpenAPI snapshot. New
// fields reject until reviewed, rather than silently losing a future input shape.
const receiptIgnored="receipt_type seller_user_id seller_email buyer_user_id buyer_email name first_line second_line city state zip formatted_address country_iso payment_method payment_email message_from_seller message_from_buyer message_from_payment is_shipped is_gift gift_message gift_sender grandtotal subtotal total_price total_shipping_cost total_tax_cost total_vat_cost discount_amt gift_wrap_price shipments".split(" ");
const transactionIgnored="title description seller_user_id buyer_user_id create_timestamp created_timestamp paid_timestamp shipped_timestamp listing_image_id file_data transaction_type product_id price shipping_cost shipping_profile_id min_processing_days max_processing_days shipping_method shipping_upgrade expected_ship_date buyer_coupon shop_coupon".split(" ");
function project(raw:unknown,fields:readonly string[],ignored:readonly string[]):Record<string,unknown>{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("INVALID_ETSY_RECEIPT");
  if(Object.keys(raw).some(k=>!fields.includes(k)&&!ignored.includes(k)))throw new Error("UNREVIEWED_ETSY_FIELD");
  return Object.fromEntries(fields.filter(k=>Object.hasOwn(raw,k)).map(k=>[k,(raw as Record<string,unknown>)[k]]));
}
const presence=<T>(v:T|null|undefined)=>v===undefined?{presence:"absent" as const}:v===null?{presence:"null" as const}:{presence:"value" as const,value:v};

/** Explicit versioned raw subset -> purchased line v1. No HTTP, mapping or intake. */
export function normalizeEtsyReceipt(body:string,context:{verifiedShopId:string;observedAt:number}):EtsySourceEvidence[]{
  const decoded=parseEtsyJson(body),raw=project(decoded,receiptFields,receiptIgnored);
  const buyerMessage=(decoded as Record<string,unknown>).message_from_buyer;
  if(Array.isArray(raw.transactions))raw.transactions=raw.transactions.map(t=>project(t,transactionFields,transactionIgnored));
  const r=rawEtsyReceiptSchema.parse(raw),shopId=etsyId.parse(context.verifiedShopId),observedAt=integer.parse(context.observedAt);
  const status=r.status?.toLowerCase();
  return r.transactions.map(t=>{
    const source:EtsySourceEvidence={contractVersion:"etsy-purchased-line/v1",receipt:{receiptId:r.receipt_id,shopId,observedAt,purchaserAccountId:presence(r.buyer_user_id),
      createdTimestamp:presence(r.created_timestamp!==undefined?r.created_timestamp:r.create_timestamp),updatedTimestamp:presence(r.updated_timestamp!==undefined?r.updated_timestamp:r.update_timestamp),
      isPaid:presence(r.is_paid),status:presence(r.status),
      cancellation:status==="canceled"?{state:"CANCELED",basis:"STATUS"}:["paid","completed","open","payment processing","fully refunded","partially refunded"].includes(status??"")?{state:"NOT_CANCELED",basis:"STATUS"}:{state:"UNKNOWN",basis:"UNRESOLVED"},
      refunds:presence(r.refunds==null?r.refunds:r.refunds.map(f=>({amount:presence(f.amount==null?f.amount:{amount:f.amount.amount,divisor:f.amount.divisor,currencyCode:f.amount.currency_code}),createdTimestamp:presence(f.created_timestamp),status:presence(f.status),reasonPresence:presence(f.reason).presence}))),
      refundAssessment:status==="fully refunded"?"FULL":status==="partially refunded"?"PARTIAL":r.refunds?.length===0?"NONE_REPORTED":"UNRESOLVED"},
      transaction:{transactionId:t.transaction_id,receiptId:presence(t.receipt_id),listingId:presence(t.listing_id),quantity:t.quantity,sku:presence(t.sku),isDigital:presence(t.is_digital),listingType:{presence:"absent"},listingTypeProvenance:"UNAVAILABLE"},
      purchaseSelections:[],purchaseProductData:presence(t.product_data==null?t.product_data:t.product_data.map((p,sourceOrder)=>({sourceOrder,propertyId:presence(p.property_id),propertyName:presence(p.property_name),scaleId:presence(p.scale_id),scaleName:presence(p.scale_name),valueIds:presence(p.value_ids),values:presence(p.values)}))),buyerInputs:[],buyerFiles:[],unsupported:[]};
    if(buyerMessage!=null&&buyerMessage!=="")source.unsupported.push({code:"UNRESOLVED_ENCODING",fieldNames:["message_from_buyer"]});
    const variations=t.variations??[];
    if(t.variations==null)source.unsupported.push({code:"INCOMPLETE_SOURCE",fieldNames:["variations"]});
    variations.forEach((v,sourceOrder)=>{
      if(v.mime_type!=null){source.buyerFiles.push({state:"UNRESOLVED",sourceOrder,questionId:presence(v.question_id),propertyId:presence(v.property_id),sourceType:{presence:"absent"},mimeType:presence(v.mime_type),valuePresence:presence(v.formatted_value).presence,observedFileCount:{presence:"absent"}});return;}
      if(v.property_id==="54"&&v.question_id!=null){
        const common={sourceOrder,questionId:presence(v.question_id),propertyId:presence(v.property_id),valueId:presence(v.value_id),formattedName:presence(v.formatted_name)};
        if(v.value_id===null&&v.mime_type===null)source.buyerInputs.push({...common,encoding:"TEXT",sourceType:{presence:"absent"},value:presence(v.formatted_value)});
        else if(v.value_id!=null&&v.mime_type===null)source.buyerInputs.push({...common,encoding:"UNRESOLVED_DROPDOWN",sourceType:{presence:"absent"},value:presence(v.formatted_value)});
        else source.buyerInputs.push({...common,encoding:"UNKNOWN",sourceType:{presence:"absent"},valuePresence:presence(v.formatted_value).presence});
        return;
      }
      if(v.property_id!=null&&v.property_id!=="54"&&v.value_id!=null&&v.question_id==null){
        source.purchaseSelections.push({sourceOrder,propertyId:v.property_id,valueIds:presence([v.value_id]),formattedName:presence(v.formatted_name),formattedValues:presence(v.formatted_value==null?v.formatted_value:[v.formatted_value])});return;
      }
      source.unsupported.push({sourceOrder,code:"UNKNOWN_INPUT",fieldNames:Object.keys(v)});
    });
    // Product data corroborates purchased variation identities; it never repairs a
    // missing/ambiguous variation by label or overwrites its purchased evidence.
    if(t.product_data)for(const p of t.product_data){
      const matches=source.purchaseSelections.filter(s=>s.propertyId===p.property_id);
      if(matches.length!==1||matches[0].valueIds.presence!=="value"||!p.value_ids||JSON.stringify([...matches[0].valueIds.value].sort())!==JSON.stringify([...p.value_ids].sort()))
        source.unsupported.push({code:"INCOMPLETE_SOURCE",fieldNames:["product_data"]});
      if(p.scale_id!=null||p.scale_name!=null)source.unsupported.push({code:"UNRESOLVED_ENCODING",fieldNames:["scale_id","scale_name"]});
    }
    const positions=[...source.purchaseSelections,...source.buyerInputs,...source.buyerFiles,...source.unsupported.filter(s=>s.sourceOrder!==undefined)].map(s=>s.sourceOrder);
    if(positions.length!==variations.length||new Set(positions).size!==variations.length)throw new Error("ETSY_VARIATION_ACCOUNTING");
    return etsySourceSchema.parse(source);
  });
}
