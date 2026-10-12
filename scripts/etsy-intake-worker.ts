import {createDatabase} from "../src/db/client";
import {automaticIntakeConfigured,runAutomaticIntakeTick} from "../src/modules/etsy/automatic-intake";
async function main(){
if(!process.env.DATABASE_URL||!automaticIntakeConfigured())throw new Error("Automatic Etsy intake requires configured OAuth and ETSY_AUTOMATIC_INTAKE_ENABLED=true");
const {db,client}=createDatabase(process.env.DATABASE_URL);
let stopping=false;
process.on("SIGINT",()=>{stopping=true;});process.on("SIGTERM",()=>{stopping=true;});
try{do{await runAutomaticIntakeTick(db);if(process.argv.includes("--once"))break;await new Promise(resolve=>setTimeout(resolve,1000));}while(!stopping);}finally{await client.end();}

}
main().catch(()=>{console.error("ETSY_INTAKE_WORKER_START_OR_TICK_FAILED");process.exitCode=1;});
