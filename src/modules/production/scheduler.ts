import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database, DbExecutor } from "../../db/client";
import { productionQueue, stores, generations, auditLogs } from "../../db/schema";
import { tenantWhere } from "../intake/service";
import { buildProductionContextForStoreInTransaction } from "../generation/context";
import { AdmissionError } from "../generation/contracts";
import { productionPolicy } from "../products/contracts";
import { compareProductionWork, schedulingConfiguration, schedulingConfigurationFromEnvironment,
  PRODUCTION_SCHEDULER_LOCK, type SchedulingConfiguration } from "./scheduling";
type QueueItem=typeof productionQueue.$inferSelect;

// Trusted server process boundary: possession of the server Database is required.
// No seller Scope/session or browser-supplied authority. Not exported as an action/route.
// node:crypto prevents inclusion in the client bundle. Part 3 must authorize paid work separately.
export class ProductionScheduler {
  private constructor(private readonly db:Database,private readonly config:SchedulingConfiguration,private readonly clock?:()=>Date) {}
  static forInternalWorker(db:Database,options:{configuration?:SchedulingConfiguration;clock?:()=>Date}={}) {
    return new ProductionScheduler(db,schedulingConfiguration.parse(options.configuration??schedulingConfigurationFromEnvironment()),options.clock);
  }
  async claimProductionWork() {
    return this.db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(${PRODUCTION_SCHEDULER_LOCK})`);
      const [time]=await tx.select({now:sql<string>`clock_timestamp()::text`}).from(stores).limit(1);
      const now=this.clock?.()??new Date(time?.now??Date.now());
      if(!Number.isFinite(now.getTime()))throw new Error("INVALID_SCHEDULER_CLOCK");
      // Metadata only. Small pilot scan; indexed/paginated scheduling is a future scale concern.
      const history=await tx.select().from(productionQueue);
      let ordinal=history.reduce((max,q)=>q.schedulingOrdinal!==null&&q.schedulingOrdinal>max?q.schedulingOrdinal:max,0n);
      const turns=new Map<string,bigint>();
      const groups=new Map<string,QueueItem[]>();
      for(const q of history){
        const key=q.storeId;
        if(q.schedulingOrdinal!==null&&q.schedulingOrdinal>(turns.get(key)??0n))turns.set(key,q.schedulingOrdinal);
        if(q.state==="QUEUED"||(q.state==="CLAIMED"&&q.claimExpiresAt!==null&&q.claimExpiresAt<=now)){
          const group=groups.get(key)??[];group.push(q);groups.set(key,group);
        }
      }
      for(const group of groups.values())group.sort((a,b)=>compareProductionWork(a,b,now,this.config));
      const scheduled=[...groups.entries()].sort(([as,aa],[bs,bb])=>{
        const at=turns.get(as)??0n,bt=turns.get(bs)??0n;
        return (at<bt?-1:at>bt?1:0)||compareProductionWork(aa[0],bb[0],now,this.config)||(as<bs?-1:as>bs?1:0);
      });
      const claimed:QueueItem[]=[];let inspected=0,skipped=0;
      const perStoreInspectionLimit=Math.max(1,Math.floor(this.config.inspectionLimit/Math.max(1,scheduled.length)));
      // At most one claim per Store per cycle. Durable ordinals make batch-size-one fair too.
      for(const [,candidates] of scheduled){
        if(claimed.length>=this.config.claimBatchSize||inspected>=this.config.inspectionLimit)break;
        const first=candidates[0],scope={organizationId:first.organizationId,storeId:first.storeId};
        const [store]=await tx.select({id:stores.id}).from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId))).for("update");
        if(!store)throw new Error("PRODUCTION_STORE_UNAVAILABLE");
        for(const candidate of candidates.slice(0,perStoreInspectionLimit)){
          if(inspected>=this.config.inspectionLimit)break;
          const [item]=await tx.select().from(productionQueue).where(and(tenantWhere(productionQueue,scope),eq(productionQueue.id,candidate.id))).for("update");
          if(!item||!(item.state==="QUEUED"||(item.state==="CLAIMED"&&item.claimExpiresAt!==null&&item.claimExpiresAt<=now)))continue;
          inspected++;
          const reason=await staleReason(tx,scope,item);
          if(reason){
            await tx.update(productionQueue).set({state:"SKIPPED",claimToken:null,claimExpiresAt:null,resolvedAt:now,resolutionCode:reason,schedulingOrdinal:++ordinal,updatedAt:now}).where(and(tenantWhere(productionQueue,scope),eq(productionQueue.id,item.id)));
            await tx.insert(auditLogs).values({...scope,action:"reading_preparation_skipped",resourceId:item.id});
            skipped++;continue;
          }
          const [claim]=await tx.update(productionQueue).set({state:"CLAIMED",claimToken:randomUUID(),claimedAt:now,
            claimExpiresAt:new Date(now.getTime()+this.config.claimDurationMs),schedulingOrdinal:++ordinal,updatedAt:now,
          }).where(and(tenantWhere(productionQueue,scope),eq(productionQueue.id,item.id))).returning();
          claimed.push(claim);break;
        }
      }
      return {claimed,inspected,skipped};
    });
  }
}
async function staleReason(tx:DbExecutor,scope:{organizationId:string;storeId:string},item:QueueItem) {
  const [generation]=await tx.select({id:generations.id}).from(generations).where(and(tenantWhere(generations,scope),eq(generations.unitId,item.unitId))).limit(1);
  // Any Generation fences reclaim too: an unknown/processing AI operation is NEVER redispatched.
  if(generation)return "EXISTING_GENERATION";
  try{
    const context=await buildProductionContextForStoreInTransaction(tx,scope,item.unitId);
    if(context.product.id!==item.productVersionId||productionPolicy(context.product.configuration).automation!=="ASSISTED")return "PRODUCT_SETUP";
    return undefined;
  }catch(error){if(error instanceof AdmissionError)return error.code;throw error;}
}
