import { randomUUID } from "node:crypto";
import { and,eq,sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { productionTick } from "../../db/schema";
import { databaseTime } from "../generation/authority";
import { ProductionRecovery } from "./recovery";
import { ProductionScheduler } from "./scheduler";
import { ProductionExecutor,type ExecutionResult } from "./execution";
import { productionRecoveryPolicy,PRODUCTION_TICK_LOCK } from "./recovery-policy";
// DB-coordinated bounded tick. No open transaction across external execution.
export class ProductionTick {
 private constructor(private readonly db:Database,private readonly recovery:ProductionRecovery,private readonly scheduler:ProductionScheduler,private readonly executor:ProductionExecutor,private readonly documentStage?:()=>Promise<unknown>){}
 static forInternalWorker(db:Database,recovery:ProductionRecovery,scheduler:ProductionScheduler,executor:ProductionExecutor,documentStage?:()=>Promise<unknown>){return new ProductionTick(db,recovery,scheduler,executor,documentStage);}
 async runProductionTick(){
  const token=await this.db.transaction(async tx=>{
   await tx.execute(sql`select pg_advisory_xact_lock(${PRODUCTION_TICK_LOCK})`);
   await tx.insert(productionTick).values({id:"production"}).onConflictDoNothing();
   const [owner]=await tx.select().from(productionTick).where(eq(productionTick.id,"production")).for("update");
   const now=await databaseTime(tx);if(owner.expiresAt&&owner.expiresAt>now)return;
   const token=randomUUID();await tx.update(productionTick).set({token,expiresAt:new Date(now.getTime()+productionRecoveryPolicy.tickLeaseMs)}).where(eq(productionTick.id,"production"));return token;
  });
  if(!token)return {status:"BUSY" as const,claimed:0,outcomes:[] as ExecutionResult[]};
  try{
   const recovery=await this.recovery.reconcileProductionWork();
   if(!await this.renew(token))return {status:"SUPERSEDED" as const,claimed:0,outcomes:[] as ExecutionResult[],recovery};
   const cycle=await this.scheduler.claimProductionWork(),outcomes:ExecutionResult[]=[];
   for(const item of cycle.claimed){
    if(!await this.renew(token))return {status:"SUPERSEDED" as const,claimed:cycle.claimed.length,outcomes,recovery};
    outcomes.push(await this.executor.execute(item.id,item.claimToken!));
   }
   if(!await this.renew(token))return {status:"SUPERSEDED" as const,claimed:cycle.claimed.length,outcomes,recovery};
   const documents=this.documentStage?await this.documentStage():{status:"STORAGE_NOT_CONFIGURED"};
   return {status:"FINISHED" as const,claimed:cycle.claimed.length,outcomes,recovery,documents};
  }finally{
   await this.db.update(productionTick).set({token:null,expiresAt:null}).where(and(eq(productionTick.id,"production"),eq(productionTick.token,token)));
  }
 }
 private async renew(token:string){
  return this.db.transaction(async tx=>{
   const [owner]=await tx.select().from(productionTick).where(and(eq(productionTick.id,"production"),eq(productionTick.token,token))).for("update");
   const now=await databaseTime(tx);if(!owner?.expiresAt||owner.expiresAt<=now)return false;
   await tx.update(productionTick).set({expiresAt:new Date(now.getTime()+productionRecoveryPolicy.tickLeaseMs)}).where(and(eq(productionTick.id,"production"),eq(productionTick.token,token)));return true;
  });
 }
}
