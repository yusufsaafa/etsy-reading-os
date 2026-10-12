const applicationCodes=new Set([
 "LIVE_CONTEXT_INVALID","LIVE_STORE_SHOP_MISMATCH","LIVE_CONNECTION_EPOCH_MISMATCH","LIVE_TOKEN_REFRESH_REQUIRED","LIVE_EVENT_BINDING_MISMATCH","LIVE_EVENT_NOT_ELIGIBLE","LIVE_EVENT_ID_INVALID","LIVE_EVENT_NOT_FOUND",
 "EXPLICIT_DATABASE_URL_REQUIRED","INVALID_DATABASE_URL","DISPOSABLE_DATABASE_REQUIRED","SERVER_IDENTITY_MISMATCH","SERVER_IDENTITY_RESULT_INVALID","COMMAND_REQUIRED_PREFLIGHT_OR_RUN","EXPLICIT_WRITE_CONFIRMATION_REQUIRED","DISABLE_BACKGROUND_WORKER_FLAGS","PRODUCT_ARGUMENT_REQUIRED","PRODUCT_MODES_MUST_NOT_BE_MIXED","DISTINCT_PRODUCTS_REQUIRED","ONE_OR_TWO_PRODUCTS_REQUIRED","READING_POLICY_REQUIRED","PERSONALIZATION_MAPPING_REQUIRED","SINGLE_VALUE_PURCHASE_SELECTION_REQUIRED","TEXT_INPUT_MAPPING_REQUIRED","CARDINALITY_MISMATCH","LINE_QUANTITY_MISMATCH","PINNED_VERSION_MISMATCH","REQUIRED_MIGRATIONS_MISSING_OR_CHANGED","CONNECTED_ETSY_STORE_REQUIRED","CONNECTED_ORDER_READ_GRANT_REQUIRED","OAUTH_INITIALIZATION_REQUIRED","ACTIVE_PRODUCT_VERSION_REQUIRED","EXACT_ETSY_READING_POLICY_REQUIRED","EXACT_UNPAUSED_LISTING_VARIANT_MAPPING_REQUIRED","WAIT_FOR_CURRENT_ACTIVATION_AND_OAUTH_CUTOFF","SYNTHETIC_ID_COLLISION_STOP","FIXTURE_MAPPING_OR_CONTRACT_UNRESOLVED","VERSION_BINDING_MISMATCH","RECEIVER_NOT_ACKNOWLEDGED","DUPLICATE_NOT_ACKNOWLEDGED","DUPLICATE_INBOX","INBOX_BINDING_MISMATCH","WRONG_RECEIPT_SELECTION","EXPECTED_ONE_FIXTURE_READ","UNEXPECTED_INTAKE_OUTCOME","ORDER_MISSING","UNEXPECTED_READING_HOLDS","PERSONALIZATION_NOT_PERSISTED","ORDERS_QUERY_MISSING","DASHBOARD_QUERY_MISMATCH","UNEXPECTED_PRODUCTION_OR_AI_SIDE_EFFECT","UNRELATED_EVENT_CHANGED","ACCEPTANCE_NETWORK_DISPATCH_FORBIDDEN",
]);
const holdCodes=new Set(["unmapped_listing","unmapped_purchase_selection","unknown_buyer_input","unresolved_dropdown","unresolved_upload","ambiguous_historical_mapping","source_evidence_incomplete","unusable_input","missing_input","unpaid","canceled","refund_review","source_changed"]);
const driverCodes=new Set(["EPERM","ECONNREFUSED","ECONNRESET","ETIMEDOUT","CONNECTION_CLOSED","23505","23503","23514","23502","25006","25P02","42501","42P01","42703","40001","40P01","08006","08003","57P01"]);
export function safeErrorCode(error:unknown):string{
 let current=error;
 for(let depth=0;depth<5&&current&&typeof current==="object";depth++){
  const e=current as {message?:unknown;code?:unknown;cause?:unknown;name?:unknown};
  if(typeof e.code==="string"&&driverCodes.has(e.code))return `DRIVER_${e.code}`;
  if(typeof e.message==="string"&&(applicationCodes.has(e.message)||e.message==="REQUIRED___STORE_ID"||[...holdCodes].some(c=>e.message===`FIXTURE_HOLD_${c.toUpperCase()}`)))return e.message;
  if(e.name==="TypeError")return "INTERNAL_TYPE_ERROR";
  if(e.name==="ZodError")return "CONTRACT_VALIDATION_FAILED";
  current=e.cause;
 }
 return "UNCLASSIFIED_ERROR";
}
export type RunDiagnostic={stage:string;transaction:"NOT_STARTED"|"ACTIVE"|"COMMITTED"|"ROLLBACK_REPORTED_BY_DRIVER"|"UNKNOWN";failureCode?:string};
/** Keep the real Drizzle transaction object so nested intake transactions use savepoints. */
export async function acceptanceTransaction<T,Tx>(db:{transaction:(callback:(tx:Tx)=>Promise<T>,config:{accessMode:"read write"})=>Promise<T>},diagnostic:RunDiagnostic,work:(tx:Tx)=>Promise<T>):Promise<T>{
 let callbackError:unknown;let failed=false;
 diagnostic.stage="TRANSACTION_BEGIN";
 try{
  const result=await db.transaction(async tx=>{
   diagnostic.transaction="ACTIVE";
   try{const result=await work(tx);diagnostic.stage="TRANSACTION_COMMIT";return result;}
   catch(error){callbackError=error;failed=true;throw error;}
  },{accessMode:"read write"});
  diagnostic.transaction="COMMITTED";return result;
 }catch(error){
  // postgres-js awaits ROLLBACK before rethrowing callback errors. A different error
  // or a failure during COMMIT leaves the outcome unknown; never claim rollback.
  diagnostic.transaction=failed&&error===callbackError?"ROLLBACK_REPORTED_BY_DRIVER":diagnostic.transaction==="NOT_STARTED"?"NOT_STARTED":"UNKNOWN";
  throw error;
 }
}
