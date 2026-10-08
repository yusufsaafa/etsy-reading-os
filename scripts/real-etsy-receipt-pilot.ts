// Explicit local read-only acceptance. No ingestOrder, worker/provider or production dispatch imports.
import {and,eq,sql} from "drizzle-orm";
import {createHash} from "node:crypto";
import {createDatabase} from "../src/db/client";
import * as schema from "../src/db/schema";
import {authorizeStore} from "../src/modules/identity/service";
import {tenantWhere,verifyScope} from "../src/modules/intake/service";
import {vault} from "../src/infrastructure/secrets";
import {liveOAuthConfig,refreshConnection} from "../src/modules/etsy/connection-service";
import {tokenSchema} from "../src/modules/etsy/oauth";
import {assessEtsySource,selectionKey} from "../src/modules/etsy/source-contract";
import {inputPolicy} from "../src/modules/products/contracts";
import {validateInputs} from "../src/modules/intake/contracts";
import {resolveConfiguration,resolveEtsySourceConfiguration} from "../src/modules/products/runtime";
import {readReceiptSample,normalizePilotReceipt,ReceiptPilotError} from "./lib/receipt-pilot";
import {assessReceiptForIntake} from "../src/modules/etsy/controlled-intake";
let stage="local_environment";
let close:(()=>Promise<void>)|undefined;
async function main(){
 const url=process.env.DATABASE_URL;if(!url||!["localhost","127.0.0.1","[::1]"].includes(new URL(url).hostname))throw new Error("LOCAL_DB_REQUIRED");
 const name=process.argv[2];if(!name)throw new Error("STORE_NAME_REQUIRED");
 const {db,client}=createDatabase(url);close=()=>client.end();
 stage="owned_connection";
 const rows=await db.select({store:schema.stores,owner:schema.memberships.userId}).from(schema.stores).innerJoin(schema.memberships,and(eq(schema.memberships.organizationId,schema.stores.organizationId),eq(schema.memberships.role,"owner"))).where(and(eq(schema.stores.source,"etsy"),eq(schema.stores.name,name)));
 if(rows.length!==1)throw new Error("UNIQUE_OWNED_STORE_REQUIRED");
 const {store,owner}=rows[0],scope=await authorizeStore(db,owner,store.id,true);if(!store.externalShopId)throw new Error("SHOP_REQUIRED");
 let [connection]=await db.select().from(schema.connections).where(tenantWhere(schema.connections,scope));
 if(connection?.status!=="connected"||!connection.encryptedTokens||!connection.scopes.includes("transactions_r"))throw new Error("AUTHORIZATION_REQUIRED");
 const config=liveOAuthConfig(),secrets=vault();let refreshed=false;
 if(connection.expiresAt&&connection.expiresAt<=new Date()){stage="authorized_refresh";await refreshConnection(db,scope,secrets,config);refreshed=true;[connection]=await db.select().from(schema.connections).where(tenantWhere(schema.connections,scope));}
 const tokens=tokenSchema.parse(JSON.parse(secrets.open(connection.encryptedTokens!,`${scope.organizationId}:${scope.storeId}:etsy`)));
 const now=Math.floor(Date.now()/1000),since=now-90*86400;
 stage="receipt_read";const sample=await readReceiptSample(store.externalShopId,tokens.access_token,config,since);
 stage="read_only_resolution";
 const result=await db.transaction(async tx=>{
  await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
  await verifyScope(tx,scope,true);
  const [grant]=await tx.select().from(schema.connections).where(tenantWhere(schema.connections,scope));
  const [ownedStore]=await tx.select().from(schema.stores).where(and(eq(schema.stores.organizationId,scope.organizationId),eq(schema.stores.id,scope.storeId)));
  if(grant?.status!=="connected"||grant.epoch!==connection.epoch||ownedStore?.externalShopId!==store.externalShopId)throw new Error("CONNECTION_CHANGED");
  const tables=[schema.orders,schema.lineItems,schema.units,schema.customerInputs,schema.generations,schema.aiRequests,schema.productionQueue,schema.documentSnapshots,schema.documentMediaSnapshots,schema.documentArtifacts,schema.documentProduction,schema.products,schema.productVersions,schema.mappings,schema.etsyHistoricalAdoptions];
  const fingerprint=async()=>createHash("sha256").update(JSON.stringify(await Promise.all(tables.map(t=>tx.select().from(t).where(and(eq(t.organizationId,scope.organizationId),eq(t.storeId,scope.storeId))))))).digest("hex");
  const before=await fingerprint();
  const part2A={receipts:0,lines:0,exactResolved:0,normalEligible:0,historicalAdoptionRequired:0,historicalOrMappingAmbiguity:0,held:0,quantityContextRequired:0,intendedOrders:0,intendedLines:0,intendedReadings:0,purchaserIdentityPresent:0,holdReasons:{} as Record<string,number>};
  const report={part2A,receipts:sample.details.length,lines:0,eligible:0,held:0,exactActiveMatches:0,knownListingLines:0,historicalBlocked:0,unsupportedInputBlocked:0,missingEvidenceBlocked:0,exactMatchInputMappingSupported:0,exactMatchInputMappingHeld:0,statusCategories:{} as Record<string,number>,holdReasons:{} as Record<string,number>,quantities:{} as Record<string,number>,structures:{receiptId:0,createdTime:0,transactionId:0,listingId:0,paid:0,statusRecognized:0,emptyRefunds:0,buyerIdentityPresent:0,buyerIdentityMatchesBetweenReceiptAndTransactions:0,textInputs:0,purchaseSelections:0,files:0,nonDigitalTransactions:0},domainStateUnchanged:false};
  for(const detail of sample.details){
   const assessment=await assessReceiptForIntake(tx,scope,detail.body,now);
   for(const key of Object.keys(part2A) as (keyof typeof part2A)[]){
    if(key==="holdReasons")for(const [reason,count] of Object.entries(assessment.report.holdReasons))part2A.holdReasons[reason]=(part2A.holdReasons[reason]??0)+count;
    else part2A[key]+=assessment.report[key];
   }
   const sources=normalizePilotReceipt(detail.body,store.externalShopId!,now);
   // Non-consumed identity is inspected only for presence/equality; never printed or passed as reading subject.
   const {parseEtsyJson}=await import("../src/modules/etsy/raw-normalizer");const raw=parseEtsyJson(detail.body) as Record<string,unknown>;
   if(raw.seller_user_id!=null&&String(raw.seller_user_id)!==tokens.access_token.split(".")[0])throw new Error("SHOP_OWNER_MISMATCH");
   const buyer=raw.buyer_user_id;
   if(buyer!=null){report.structures.buyerIdentityPresent++;if((raw.transactions as Record<string,unknown>[]).every(t=>t.buyer_user_id!=null&&String(t.buyer_user_id)===String(buyer)))report.structures.buyerIdentityMatchesBetweenReceiptAndTransactions++;}
   for(const source of sources){
    report.lines++;report.structures.receiptId++;report.structures.transactionId++;
    if(source.receipt.createdTimestamp.presence==="value"){report.structures.createdTime++;if(source.receipt.createdTimestamp.value<since||source.receipt.createdTimestamp.value>now)throw new Error("RECEIPT_WINDOW_MISMATCH");}
    let beforeActivation=false;
    if(source.transaction.listingId.presence==="value"){
     report.structures.listingId++;
     const [listing]=await tx.select({id:schema.listings.id}).from(schema.listings).where(and(tenantWhere(schema.listings,scope),eq(schema.listings.externalId,source.transaction.listingId.value)));if(listing)report.knownListingLines++;
     let key:string|undefined;
     try { key=selectionKey(source.purchaseSelections.map(s=>({propertyId:s.propertyId,valueIds:s.valueIds.presence==="value"?s.valueIds.value:[]}))); } catch { /* Authoritative resolver below holds ambiguous identities. */ }
     const exact=key===undefined?{version:undefined}:await resolveConfiguration(tx,scope,source.transaction.listingId.value,key);if(exact.version){report.exactActiveMatches++;
      // Diagnostic compatibility only; never pass this projection as authority across the activation fence.
      const assessment=assessEtsySource(source,exact.version.configuration.etsyFulfillment);
      const inputProblems=[...assessment.issues.filter(i=>["ambiguous_historical_mapping","unknown_buyer_input","unresolved_dropdown","unresolved_upload"].includes(i)),...validateInputs(assessment.answers,inputPolicy(exact.version.configuration))];
      if(inputProblems.length)report.exactMatchInputMappingHeld++;else report.exactMatchInputMappingSupported++;
      const [pinned]=await tx.select({activatedAt:schema.productVersions.activatedAt}).from(schema.productVersions).where(and(tenantWhere(schema.productVersions,scope),eq(schema.productVersions.id,exact.version.id)));
      beforeActivation=source.receipt.createdTimestamp.presence!=="value"||!pinned.activatedAt||source.receipt.createdTimestamp.value<Math.ceil(pinned.activatedAt.getTime()/1000);
     }
    }
    const resolved=await resolveEtsySourceConfiguration(tx,scope,source);
    const issues=resolved.issues;
    if(!issues.length&&resolved.version)report.eligible++;else report.held++;
    for(const reason of issues)report.holdReasons[reason]=(report.holdReasons[reason]??0)+1;
    if(beforeActivation&&!resolved.version&&issues.includes("ambiguous_historical_mapping"))report.historicalBlocked++;
    if(issues.some(i=>["unknown_buyer_input","unresolved_dropdown","unresolved_upload"].includes(i)))report.unsupportedInputBlocked++;
    if(issues.some(i=>["source_evidence_incomplete","missing_input","unusable_input"].includes(i)))report.missingEvidenceBlocked++;
    const quantity=source.transaction.quantity===1?"one":source.transaction.quantity>1?"multiple":"zero";report.quantities[quantity]=(report.quantities[quantity]??0)+1;
    if(source.receipt.isPaid.presence==="value"&&source.receipt.isPaid.value)report.structures.paid++;
    if(source.receipt.status.presence==="value"&&["paid","completed","canceled","fully refunded","partially refunded","open","payment processing"].includes(source.receipt.status.value.toLowerCase()))report.structures.statusRecognized++;
    if(source.receipt.status.presence==="value"){
     const status=source.receipt.status.value.toLowerCase();const safe=["paid","completed","canceled","fully refunded","partially refunded","open","payment processing"].includes(status)?status:"OTHER";
     report.statusCategories[safe]=(report.statusCategories[safe]??0)+1;
    }
    if(source.receipt.refunds.presence==="value"&&!source.receipt.refunds.value.length)report.structures.emptyRefunds++;
    report.structures.textInputs+=source.buyerInputs.filter(i=>i.encoding==="TEXT").length;report.structures.purchaseSelections+=source.purchaseSelections.length;report.structures.files+=source.buyerFiles.length;
    if(source.transaction.isDigital.presence==="value"&&!source.transaction.isDigital.value)report.structures.nonDigitalTransactions++;
   }
  }
  report.domainStateUnchanged=before===await fingerprint();if(!report.domainStateUnchanged)throw new Error("DOMAIN_CHANGED");return report;
 });
 console.log(JSON.stringify({connectionOwned:true,encryptedGrant:true,refreshed,tunnelRequired:false,windowDays:90,maxReceipts:3,http:sample.evidence,listShape:sample.listShape,...result},null,2));
}
main().catch(error=>{console.error(JSON.stringify({failed:true,stage,error: error instanceof ReceiptPilotError?{stage:error.stage,httpStatus:error.httpStatus}: {type:error instanceof Error?error.name:"Unknown",code:error instanceof Error&&["ETSY_REAUTHORIZE","UNREVIEWED_ETSY_FIELD","ETSY_VARIATION_ACCOUNTING","SHOP_OWNER_MISMATCH","RECEIPT_WINDOW_MISMATCH"].includes(error.message)?error.message:"SAFE_FAILURE"}}));process.exitCode=1;}).finally(async()=>{await close?.();});
