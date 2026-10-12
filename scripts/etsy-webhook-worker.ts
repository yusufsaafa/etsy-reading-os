import {createDatabase} from "../src/db/client";
import {runWebhookIntakeTick} from "../src/modules/etsy/webhook-intake";
import {webhookSecretConfigured} from "../src/modules/etsy/webhook-digest";

async function main(){
if(!process.env.DATABASE_URL||process.env.ETSY_WEBHOOK_WORKER_ENABLED!=="true"||
   process.env.ETSY_ADAPTER!=="etsy"||process.env.ETSY_LIVE_OAUTH_ENABLED!=="true"||
   !webhookSecretConfigured(process.env.ETSY_WEBHOOK_SIGNING_SECRET)) {
  throw new Error("Webhook intake worker requires server signing configuration, enabled OAuth and explicit ETSY_WEBHOOK_WORKER_ENABLED=true");
}
const {db,client}=createDatabase(process.env.DATABASE_URL);
let stopping=false;
process.on("SIGINT",()=>{stopping=true;});process.on("SIGTERM",()=>{stopping=true;});
try {
  do {
    try {await runWebhookIntakeTick(db);}
    catch {console.error("WEBHOOK_WORKER_TICK_FAILED");if(process.argv.includes("--once"))process.exitCode=1;}
    if(process.argv.includes("--once"))break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  } while(!stopping);
} finally {await client.end();}

}
main().catch(()=>{console.error("WEBHOOK_WORKER_START_FAILED");process.exitCode=1;});
