import {createHmac,randomUUID} from "node:crypto";
import {configurationSchema,type Configuration} from "../../../src/modules/products/contracts";
import {rawReceipt} from "../../../tests/fixtures/etsy-raw";
export function requireIsolation(value:string|undefined){
 if(!value)throw new Error("EXPLICIT_DATABASE_URL_REQUIRED");
 let u:URL;try{u=new URL(value);}catch{throw new Error("INVALID_DATABASE_URL");}
 if(!["postgres:","postgresql:"].includes(u.protocol)||u.hostname!=="127.0.0.1"||u.port!=="5432"||u.pathname!=="/etsy_reading_os_webhook_test"||decodeURIComponent(u.username)!=="yusufsafakilic"||u.search||u.hash)throw new Error("DISPOSABLE_DATABASE_REQUIRED");
 return value;
}
export function requireIdentity(row:{database:string;role:string;address:string;port:number}){
 if(row.database!=="etsy_reading_os_webhook_test"||row.role!=="yusufsafakilic"||row.address!=="127.0.0.1"||row.port!==5432)throw new Error("SERVER_IDENTITY_MISMATCH");
}
/** postgres-js raw execute returns a RowList of named row objects, not values arrays. */
export function identityFromResult(result:unknown){
 if(!Array.isArray(result)||result.length!==1||!result[0]||typeof result[0]!=="object"||Array.isArray(result[0]))throw new Error("SERVER_IDENTITY_RESULT_INVALID");
 const row=result[0] as Record<string,unknown>;
 if(typeof row.database!=="string"||typeof row.role!=="string"||typeof row.address!=="string"||typeof row.port!=="number"||!Number.isInteger(row.port))throw new Error("SERVER_IDENTITY_RESULT_INVALID");
 const identity={database:row.database,role:row.role,address:row.address,port:row.port};requireIdentity(identity);return identity;
}
export function productArguments(args:string[]){
 const get=(name:string)=>{const at=args.indexOf(name);if(at<0||!args[at+1]||args[at+1].startsWith("--"))throw new Error("PRODUCT_ARGUMENT_REQUIRED");return args[at+1];};
 if(args.includes("--product-id")){
  if(args.includes("--love-product-id")||args.includes("--career-product-id"))throw new Error("PRODUCT_MODES_MUST_NOT_BE_MIXED");
  return [get("--product-id")];
 }
 const ids=[get("--love-product-id"),get("--career-product-id")];
 if(ids[0]===ids[1])throw new Error("DISTINCT_PRODUCTS_REQUIRED");return ids;
}
export function expectedCounts(count:number){
 if(count!==1&&count!==2)throw new Error("ONE_OR_TWO_PRODUCTS_REQUIRED");
 return {lines:count,readings:count===1?1:3,quantityHoldCount:count===1?0:2};
}
export function requireCommand(args:string[]){
 if(!["preflight","run","inspect-live","process-live"].includes(args[0]))throw new Error("COMMAND_REQUIRED_PREFLIGHT_OR_RUN");
 if(["run","process-live"].includes(args[0])&&!args.includes("--confirm-disposable-db-write"))throw new Error("EXPLICIT_WRITE_CONFIRMATION_REQUIRED");
 return args[0];
}
export function requireNoWorkers(env:Record<string,string|undefined>){
 if(Object.entries(env).some(([k,v])=>/WORKER|AUTOMATIC_INTAKE|PRODUCTION.*ENABLED/.test(k)&&v==="true"))throw new Error("DISABLE_BACKGROUND_WORKER_FLAGS");
}
export const RECEIPT_ID="9223372036854775000",TRANSACTIONS=["9223372036854775001","9223372036854775002"] as const;
export type FixtureProduct={versionId:string;configuration:Configuration};
export function syntheticReceipt(products:FixtureProduct[],created:number){
 expectedCounts(products.length);
 const base=rawReceipt();
 const transactions=products.map((p,index)=>{
  const c=configurationSchema.parse(p.configuration),policy=c.etsyFulfillment;
  if(!policy||policy.fulfillment!=="READING")throw new Error("READING_POLICY_REQUIRED");
  if(!policy.inputMappings.length)throw new Error("PERSONALIZATION_MAPPING_REQUIRED");
  const variations:Record<string,unknown>[]=[];
  for(const s of policy.purchaseSelections){if(s.valueIds.length!==1)throw new Error("SINGLE_VALUE_PURCHASE_SELECTION_REQUIRED");variations.push({property_id:s.propertyId,value_id:s.valueIds[0],question_id:null,formatted_name:"Synthetic purchase option",formatted_value:"Synthetic selection",mime_type:null});}
  for(const m of policy.inputMappings){if(m.sourceType!=="text_input")throw new Error("TEXT_INPUT_MAPPING_REQUIRED");variations.push({property_id:m.propertyId,value_id:null,question_id:m.questionId,formatted_name:c.inputs.find(i=>i.key===m.inputKey)?.label??m.inputKey,formatted_value:"Synthetic acceptance context",mime_type:null});}
  return {transaction_id:TRANSACTIONS[index],receipt_id:RECEIPT_ID,listing_id:policy.listingId,quantity:products.length===2&&index===0?2:1,sku:"SYNTHETIC-WEBHOOK-ACCEPTANCE",is_digital:false,variations,product_data:policy.purchaseSelections.map(s=>({property_id:s.propertyId,property_name:"Synthetic purchase option",scale_id:null,scale_name:null,value_ids:s.valueIds,values:s.valueIds.map(()=>"Synthetic selection")}))};
 });
 return JSON.stringify({...base,receipt_id:RECEIPT_ID,created_timestamp:created,updated_timestamp:created,transactions});
}
export function signedRequest(shopId:string,secret:string,now:number,eventId="msg_acceptance_"+randomUUID()){
 const body=JSON.stringify({event_type:"order.paid",shop_id:shopId,resource_url:`https://api.etsy.com/v3/application/shops/${shopId}/receipts/${RECEIPT_ID}`});
 const signature="v1,"+createHmac("sha256",Buffer.from(secret.slice(6),"base64")).update(`${eventId}.${now}.${body}`).digest("base64");
 return {eventId,request:new Request("https://acceptance.invalid/api/webhooks/etsy",{method:"POST",body,headers:{"webhook-id":eventId,"webhook-timestamp":String(now),"webhook-signature":signature}})};
}

export function requireBindings(lines:{id:string;externalId:string;quantity:number}[],units:{lineItemId:string;productVersionId:string|null}[],versions:string[]){
 const expected=expectedCounts(versions.length);
 if(lines.length!==expected.lines||units.length!==expected.readings)throw new Error("CARDINALITY_MISMATCH");
 for(const [i,transaction] of TRANSACTIONS.slice(0,versions.length).entries()){
  const line=lines.find(l=>l.externalId===transaction);
  if(!line||line.quantity!==(versions.length===2&&i===0?2:1))throw new Error("LINE_QUANTITY_MISMATCH");
  const readings=units.filter(u=>u.lineItemId===line.id);
  if(readings.length!==line.quantity||readings.some(u=>u.productVersionId!==versions[i]))throw new Error("PINNED_VERSION_MISMATCH");
 }
}

export function blockAcceptanceNetwork(){
 globalThis.fetch=async()=>{throw new Error("ACCEPTANCE_NETWORK_DISPATCH_FORBIDDEN");};
}
