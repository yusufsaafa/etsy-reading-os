// Explicit owner/operator invocation only. Never invoked by a page, startup, worker or timer.
import {z} from "zod";
import {createDatabase} from "../src/db/client";
import {authorizeStore} from "../src/modules/identity/service";
import {backfillOrderFinance,refreshOrderFinance} from "../src/modules/orders-finance/service";
async function main(){
 const [mode,userId,storeId,target,after]=process.argv.slice(2);
 if(!process.env.DATABASE_URL||!userId||!storeId||!['refresh','backfill'].includes(mode))throw new Error("INVALID_OPERATOR_ARGUMENTS");
 z.uuid().parse(storeId);
 const {db,client}=createDatabase(process.env.DATABASE_URL);
 try{
  const scope=await authorizeStore(db,userId,storeId,true);
  const result=mode==='refresh'?await refreshOrderFinance(db,scope,z.uuid().parse(target)):await backfillOrderFinance(db,scope,{limit:target===undefined?10:z.coerce.number().int().min(1).max(20).parse(target),...(after?{after:z.uuid().parse(after)}:{})});
  console.log(JSON.stringify(result));
 }finally{await client.end();}
}
main().catch(()=>{console.error("FINANCE_OPERATOR_FAILED");process.exitCode=1;});
