import { and,eq,sql } from "drizzle-orm";
import type { DbExecutor } from "../../db/client";
import { productionQueue,stores } from "../../db/schema";
import type { Scope } from "../intake/contracts";
import { tenantWhere,verifyScope } from "../intake/service";
import { AccessDenied } from "../identity/service";
// Process-local capability membership authenticates internal code, NOT concurrency.
// All ownership/state/concurrency correctness remains in PostgreSQL.
const capabilities=new WeakSet<object>();
export type ProductionAuthority=Readonly<{organizationId:string;storeId:string;userId?:never;queueId:string;claimToken:string;unitId:string;commandKey:string;retryGenerationId?:string}>;
export type GenerationAuthority=Scope|ProductionAuthority;
export function isProductionAuthority(value:unknown):value is ProductionAuthority {
 return typeof value==="object"&&value!==null&&capabilities.has(value);
}
export async function databaseTime(tx:DbExecutor) {
 const [row]=await tx.select({now:sql<string>`clock_timestamp()::text`}).from(stores).limit(1);
 return new Date(row?.now??Date.now());
}
// Trusted server issuer only: execution transaction has already locked Store/queue.
export async function issueProductionAuthority(tx:DbExecutor,queueId:string,claimToken:string) {
 const [row]=await tx.select().from(productionQueue).where(eq(productionQueue.id,queueId));
 if(!row||row.state!=="EXECUTING"||row.claimToken!==claimToken||row.generationCommandKey!==row.id)throw new AccessDenied();
 const authority=Object.freeze({organizationId:row.organizationId,storeId:row.storeId,queueId:row.id,claimToken,unitId:row.unitId,commandKey:row.retryCommandKey??row.generationCommandKey,...(row.retryCommandKey&&row.generationId?{retryGenerationId:row.generationId}:{})});
 capabilities.add(authority);await verifyGenerationAuthority(tx,authority);return authority;
}
export async function verifyGenerationAuthority(tx:DbExecutor,authority:GenerationAuthority) {
 if(!isProductionAuthority(authority)){
  // Reject structural/serialized attempts to forge an internal principal.
  if(!authority||"queueId" in authority||typeof authority.userId!=="string")throw new AccessDenied();
  await verifyScope(tx,authority,true);return;
 }
 const [queue]=await tx.select().from(productionQueue).where(and(tenantWhere(productionQueue,authority),eq(productionQueue.id,authority.queueId)));
 const now=await databaseTime(tx);
 if(!queue||queue.state!=="EXECUTING"||queue.claimToken!==authority.claimToken||queue.unitId!==authority.unitId||(queue.retryCommandKey??queue.generationCommandKey)!==authority.commandKey||authority.retryGenerationId!==(queue.retryCommandKey?queue.generationId:undefined)||!queue.claimExpiresAt||queue.claimExpiresAt<=now)throw new AccessDenied();
}
