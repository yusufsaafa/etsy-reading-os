// Explicit authenticated operator command only. Never runs at startup or as a worker.
import {z} from "zod";
import {createDatabase} from "../src/db/client";
import {authorizeStore} from "../src/modules/identity/service";
import {syncCatalog} from "../src/modules/catalog/sync";
async function main(){
 const [userId,storeId,restart]=process.argv.slice(2);if(!process.env.DATABASE_URL||!userId)throw new Error();z.uuid().parse(storeId);if(restart&&restart!=="restart")throw new Error();
 const {db,client}=createDatabase(process.env.DATABASE_URL);try{const scope=await authorizeStore(db,userId,storeId,true);console.log(JSON.stringify(await syncCatalog(db,scope,{restart:restart==="restart"})));}finally{await client.end();}
}
main().catch(()=>{console.error("CATALOG_OPERATOR_FAILED");process.exitCode=1;});
