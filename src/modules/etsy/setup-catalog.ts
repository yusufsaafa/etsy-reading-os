import {z} from "zod";
import {parseEtsyJson} from "./raw-normalizer";
import {selectionKey, type SelectionIdentity} from "./source-contract";
import {safeListingThumbnail} from "./listing-thumbnail";

const id=z.union([z.string().regex(/^[1-9]\d{0,18}$/),z.number().int().positive().safe().transform(String)])
 .refine(v=>BigInt(v)<=9223372036854775807n);
const label=z.string().max(500), integer=z.number().int().nonnegative().safe();
const money=z.object({amount:integer,divisor:integer.positive(),currency_code:z.string().regex(/^[A-Z]{3}$/)}).strict();
const listingSchema=z.object({listing_id:id,shop_id:id,title:z.string().min(1).max(1000),state:z.enum(["active","inactive","draft","sold_out","expired"]),updated_timestamp:integer,
 images:z.array(z.object({rank:integer,url_75x75:z.string().max(2048).nullish()})).max(30).nullish()});
const property=z.object({property_id:id,property_name:label.nullable(),scale_id:id.nullish(),scale_name:label.nullish(),
 value_ids:z.array(id).min(1).max(30),values:z.array(label).min(1).max(30)}).strict();
const inventorySchema=z.object({products:z.array(z.object({product_id:id,sku:z.string().max(500).optional(),is_deleted:z.boolean(),
 property_values:z.array(property).max(3),offerings:z.array(z.object({offering_id:id,quantity:integer,is_enabled:z.boolean(),is_deleted:z.boolean(),price:money,readiness_state_id:id.nullish()}).strict()).min(1).max(10),
 }).strict()).min(1).max(100),price_on_property:z.array(id).max(3),quantity_on_property:z.array(id).max(3),sku_on_property:z.array(id).max(3),readiness_state_on_property:z.array(id).max(3).optional(),listing:listingSchema}).strict();
const questionSchema=z.object({question_id:id.nullish(),question_type:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),question_text:label,
 instructions:z.string().max(10000).nullish(),required:z.boolean(),max_allowed_characters:integer.nullish(),max_allowed_files:integer.nullish(),
 options:z.array(z.object({option_id:id.nullable(),label}).strict()).max(30).nullish(),add_on_price:money.nullish()}).strict();
const personalizationSchema=z.object({personalization_questions:z.array(questionSchema).max(5)}).strict();
export type SetupQuestion={questionId:string|null;sourceType:string;label:string;required:boolean;instructions?:string|null;maxCharacters?:number|null;support:"TEXT"|"UNSUPPORTED"};
export type SetupConfiguration={key:string;purchaseSelections:SelectionIdentity[];displaySelections:{propertyId:string;label:string|null;values:{valueId:string;label:string}[]}[]};
export type SetupCatalog={contractVersion:"etsy-setup-catalog/v1";observedAt:number;listing:{id:string;title:string;state:string;thumbnailUrl:string|null};
 questions:SetupQuestion[];configurations:SetupConfiguration[];state:"READY"|"BLOCKED";reasons:("INVALID_STRUCTURE"|"INCOMPLETE_IDENTITIES"|"UNSUPPORTED_SCALE"|"UNSUPPORTED_QUESTION"|"NO_AVAILABLE_CONFIGURATION"|"LISTING_UNAVAILABLE")[]};
export class SetupCatalogError extends Error {constructor(){super("ETSY_SETUP_UNAVAILABLE");}}

/** Current setup evidence only. Never purchased/history evidence or semantic label parsing. */
export function deriveSetupCatalog(rawListing:unknown,rawInventory:unknown,rawQuestions:unknown,expected:{shopId:string;listingId:string},observedAt=Date.now()):SetupCatalog {
 const listing=listingSchema.parse(rawListing);
 if(listing.shop_id!==expected.shopId||listing.listing_id!==expected.listingId)throw new SetupCatalogError();
 const base={contractVersion:"etsy-setup-catalog/v1" as const,observedAt,listing:{id:listing.listing_id,title:listing.title,state:listing.state,
 thumbnailUrl:safeListingThumbnail([...(listing.images??[])].sort((a,b)=>a.rank-b.rank)[0]?.url_75x75)}};
 const blocked=(reason:SetupCatalog["reasons"][number],questions:SetupQuestion[]=[]):SetupCatalog=>({...base,questions,configurations:[],state:"BLOCKED",reasons:[reason]});
 try{
  const inventory=inventorySchema.parse(rawInventory),personalization=personalizationSchema.parse(rawQuestions);
  if(inventory.listing.listing_id!==listing.listing_id||inventory.listing.shop_id!==listing.shop_id||inventory.listing.state!==listing.state||inventory.listing.updated_timestamp!==listing.updated_timestamp)throw new SetupCatalogError();
  const questions:SetupQuestion[]=personalization.personalization_questions.map(q=>({questionId:q.question_id??null,sourceType:q.question_type,label:q.question_text,required:q.required,instructions:q.instructions,maxCharacters:q.max_allowed_characters,
   support:q.question_type==="text_input"&&q.question_id!=null&&q.max_allowed_characters!=null&&q.max_allowed_characters>=1&&q.max_allowed_characters<=1024&&q.max_allowed_files==null&&!q.options?.length&&q.add_on_price==null?"TEXT":"UNSUPPORTED"}));
  const qids=questions.filter(q=>q.questionId!==null).map(q=>q.questionId);
  if(new Set(qids).size!==qids.length)return blocked("INCOMPLETE_IDENTITIES");
  if(questions.some(q=>q.support!=="TEXT"))return blocked("UNSUPPORTED_QUESTION",questions);
  if(listing.state!=="active")return blocked("LISTING_UNAVAILABLE",questions);
  const productIds=new Set<string>(),offeringIds=new Set<string>(),keys=new Set<string>(),labels=new Map<string,string>(),configurations:SetupConfiguration[]=[];
  let dimensionIds:string|undefined;
  for(const p of inventory.products){
   if(productIds.has(p.product_id))return blocked("INCOMPLETE_IDENTITIES");productIds.add(p.product_id);
   for(const offer of p.offerings){if(offeringIds.has(offer.offering_id))return blocked("INCOMPLETE_IDENTITIES");offeringIds.add(offer.offering_id);}
   if(p.is_deleted)continue;
   if(p.property_values.some(v=>v.scale_id!=null||v.scale_name!=null))return blocked("UNSUPPORTED_SCALE",questions);
   const selections=p.property_values.map(v=>({propertyId:v.property_id,valueIds:v.value_ids}));
   const key=selectionKey(selections),dimensions=selections.map(v=>v.propertyId).sort().join(",");
   if(dimensionIds!==undefined&&dimensions!==dimensionIds||keys.has(key))return blocked("INCOMPLETE_IDENTITIES");dimensionIds=dimensions;keys.add(key);
   for(const prop of p.property_values){
    if(prop.value_ids.length!==prop.values.length||prop.property_id==="54")return blocked("INCOMPLETE_IDENTITIES");
    for(const [i,valueId] of prop.value_ids.entries()){const identity=`${prop.property_id}:${valueId}`,name=JSON.stringify([prop.property_name,prop.values[i]]);if(labels.has(identity)&&labels.get(identity)!==name)return blocked("INCOMPLETE_IDENTITIES");labels.set(identity,name);}
   }
   if(p.offerings.some(o=>!o.is_deleted&&o.is_enabled&&o.quantity>0))configurations.push({key,purchaseSelections:selections,displaySelections:p.property_values.map(v=>({propertyId:v.property_id,label:v.property_name,values:v.value_ids.map((valueId,i)=>({valueId,label:v.values[i]}))}))});
  }
  for(const dependencies of [inventory.price_on_property,inventory.quantity_on_property,inventory.sku_on_property,inventory.readiness_state_on_property??[]])
   if(new Set(dependencies).size!==dependencies.length||dependencies.some(x=>!dimensionIds?.split(",").includes(x)))return blocked("INCOMPLETE_IDENTITIES");
  if(!configurations.length)return blocked("NO_AVAILABLE_CONFIGURATION",questions);
  return {...base,questions,configurations,state:"READY",reasons:[]};
 }catch(error){if(error instanceof SetupCatalogError)throw error;return blocked("INVALID_STRUCTURE");}
}
async function readJson(response:Response){
 if(!response.ok||!response.headers.get("content-type")?.includes("application/json"))throw new SetupCatalogError();
 const reader=response.body?.getReader();if(!reader)throw new SetupCatalogError();let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1048576)throw new SetupCatalogError();chunks.push(value);}}finally{await reader.cancel();}
 return parseEtsyJson(Buffer.concat(chunks).toString("utf8"));
}
export async function fetchSetupCatalog(shopId:string,listingId:string,accessToken:string,config:{clientId:string;secret:string},fetcher:typeof fetch=fetch){
 id.parse(shopId);id.parse(listingId);
 try{
  const get=async(path:string)=>readJson(await fetcher(`https://api.etsy.com/v3/application/listings/${listingId}${path}`,{method:"GET",headers:{"x-api-key":`${config.clientId}:${config.secret}`,Authorization:`Bearer ${accessToken}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)}));
  // Verify fresh ownership BEFORE reading inventory/question associations.
  const listing=listingSchema.parse(await get("?includes=Images"));
  if(listing.shop_id!==shopId||listing.listing_id!==listingId)throw new SetupCatalogError();
  const inventory=await get("/inventory?includes=Listing&show_deleted=false"),questions=await get("/personalization");
  return deriveSetupCatalog(listing,inventory,questions,{shopId,listingId});
 }catch{throw new SetupCatalogError();}
}
