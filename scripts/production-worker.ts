import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {createDatabase} from "../src/db/client";
import {productionRuntime} from "../src/modules/production/runtime";
import {configuredDocumentPorts,localDocumentStorageReadiness} from "../src/infrastructure/document-runtime";
/** Pure launch guard. No connections, provider dispatch or filesystem writes. */
export function productionWorkerConfiguration(env:Readonly<Record<string,string|undefined>>,nodeVersion=process.versions.node){
 if(!/^\d+\.\d+\.\d+$/.test(nodeVersion))throw new Error("NODE_22_12_REQUIRED");
 const [major,minor]=nodeVersion.split(".").map(Number);
 if(!Number.isInteger(major)||major<22||major===22&&minor<12)throw new Error("NODE_22_12_REQUIRED");
 if(env.NODE_ENV!=="production"||env.PRODUCTION_WORKER_ENABLED!=="true"||env.AI_PROVIDER!=="google")throw new Error("PRODUCTION_WORKER_DISABLED");
 if(!env.DATABASE_URL||!env.GEMINI_API_KEY)throw new Error("PRODUCTION_CONFIGURATION_REQUIRED");
 const url=new URL(env.DATABASE_URL);
 if(!["postgres:","postgresql:"].includes(url.protocol)||!url.hostname||url.pathname.length<=1)throw new Error("DATABASE_CONFIGURATION_REQUIRED");
 if(!/^\d+$/.test(env.AI_DAILY_BUDGET_NANOS??"")||!/^\d+$/.test(env.AI_ATTEMPT_BUDGET_NANOS??""))throw new Error("AI_BUDGET_CONFIGURATION_REQUIRED");
 if(env.DOCUMENT_STORAGE_DRIVER!=="persistent-volume"||env.DOCUMENT_STORAGE_PERSISTENCE_CONFIRMED!=="true"||!env.DOCUMENT_ARTIFACT_ROOT)throw new Error("PERSISTENT_STORAGE_REQUIRED");
 const interval=Number(env.PRODUCTION_WORKER_INTERVAL_MS??"2000");
 if(!Number.isInteger(interval)||interval<1000||interval>60000)throw new Error("INVALID_WORKER_INTERVAL");
 return {interval};
}
async function main(){
 const {interval}=productionWorkerConfiguration(process.env);
 if(await localDocumentStorageReadiness()!=="PERSISTENT_READY")throw new Error("PERSISTENT_STORAGE_UNAVAILABLE");
 const ports=configuredDocumentPorts();if(!ports)throw new Error("PERSISTENT_STORAGE_UNAVAILABLE");
 const {db,client}=createDatabase(process.env.DATABASE_URL!);let stopping=false;
 const stop=()=>{stopping=true;};process.on("SIGINT",stop);process.on("SIGTERM",stop);
 try{
  const runtime=productionRuntime(db,ports);
  do{
   try{await runtime.runProductionTick();}
   catch{console.error("PRODUCTION_WORKER_TICK_FAILED");if(process.argv.includes("--once"))process.exitCode=1;}
   if(stopping||process.argv.includes("--once"))break;
   await new Promise(resolve=>setTimeout(resolve,interval));
  }while(!stopping);
 }finally{process.removeListener("SIGINT",stop);process.removeListener("SIGTERM",stop);await client.end();}
}
// Importable guard tests do not start a worker. Only explicit executable invocation does.
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 main().catch(()=>{console.error("PRODUCTION_WORKER_START_FAILED");process.exitCode=1;});
}
