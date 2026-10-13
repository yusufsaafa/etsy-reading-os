import {it,expect} from "vitest";
import {productionWorkerConfiguration} from "../scripts/production-worker";
import config from "../next.config";
const env:NodeJS.ProcessEnv={NODE_ENV:"production",PRODUCTION_WORKER_ENABLED:"true",AI_PROVIDER:"google",GEMINI_API_KEY:"synthetic-unused",DATABASE_URL:"postgresql://synthetic@127.0.0.1:1/build_only",AI_DAILY_BUDGET_NANOS:"100",AI_ATTEMPT_BUDGET_NANOS:"10",DOCUMENT_STORAGE_DRIVER:"persistent-volume",DOCUMENT_STORAGE_PERSISTENCE_CONFIRMED:"true",DOCUMENT_ARTIFACT_ROOT:"/srv/private-reading-documents"};
it("worker launch guard is explicit and does not dispatch on import",()=>{expect(productionWorkerConfiguration(env,"22.12.0")).toEqual({interval:2000});});
it.each([{NODE_ENV:"development"},{PRODUCTION_WORKER_ENABLED:"false"},{AI_PROVIDER:"fake"},{GEMINI_API_KEY:""},{DATABASE_URL:"https://example.invalid/db"},{AI_DAILY_BUDGET_NANOS:"-1"},{DOCUMENT_STORAGE_DRIVER:"local"},{DOCUMENT_STORAGE_PERSISTENCE_CONFIRMED:"false"},{PRODUCTION_WORKER_INTERVAL_MS:"0"}])("invalid production launch %j is rejected",patch=>{expect(()=>productionWorkerConfiguration({...env,...patch},"22.23.1")).toThrow();});
it("unsupported Node is rejected without changing engine requirements",()=>{expect(()=>productionWorkerConfiguration(env,"20.16.0")).toThrow("NODE_22_12_REQUIRED");expect(()=>productionWorkerConfiguration(env,"22.11.0")).toThrow();});
it("production-compatible form referrer policy remains same-origin, never sends external referrers",async()=>{const headers=await config.headers!();expect(headers.find(h=>h.source==="/:path*")?.headers).toContainEqual({key:"Referrer-Policy",value:"same-origin"});});
import {productionMigrationConfiguration} from "../scripts/migrate-production";
it("production migration requires exact target and explicit authorization without connecting on import",()=>{
 const migration={NODE_ENV:"production",DATABASE_URL:"postgresql://synthetic@127.0.0.1:1/build_only",PRODUCTION_DATABASE_NAME:"build_only",PRODUCTION_DATABASE_ROLE:"synthetic",PRODUCTION_MIGRATION_CONFIRM:"build_only"};
 expect(productionMigrationConfiguration(migration)).toEqual({database:"build_only",role:"synthetic"});
 for(const patch of [{NODE_ENV:"development"},{PRODUCTION_MIGRATION_CONFIRM:""},{PRODUCTION_DATABASE_NAME:"other"},{PRODUCTION_DATABASE_ROLE:""},{DATABASE_URL:"postgresql://synthetic@127.0.0.1:1/other"}])expect(()=>productionMigrationConfiguration({...migration,...patch})).toThrow();
});

it("independent S3-backed worker requires verified storage configuration without a shared root",()=>{
 const config={...env,DOCUMENT_STORAGE_DRIVER:"s3-compatible",DOCUMENT_ARTIFACT_ROOT:undefined,DOCUMENT_STORAGE_PERSISTENCE_CONFIRMED:undefined,S3_ENDPOINT:"https://example.invalid",S3_BUCKET:"synthetic-pdfs",S3_REGION:"auto",S3_ACCESS_KEY_ID:"fake",S3_SECRET_ACCESS_KEY:"fake",S3_CONDITIONAL_WRITES_CONFIRMED:"true"};
 expect(productionWorkerConfiguration(config,"22.23.1")).toEqual({interval:2000});
 expect(()=>productionWorkerConfiguration({...config,S3_CONDITIONAL_WRITES_CONFIRMED:"false"},"22.23.1")).toThrow();
});
