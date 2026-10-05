import { createDatabase } from "../src/db/client";
import { PostgresSyncJobs } from "../src/infrastructure/jobs";
import { FixtureEtsyAdapter } from "../src/modules/etsy/fixtures";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
if (process.env.ETSY_ADAPTER !== "fixtures" || process.env.NODE_ENV === "production") throw new Error("Live intake adapter remains gated");
const { db, client } = createDatabase(process.env.DATABASE_URL);
const jobs = new PostgresSyncJobs(db);
let stopping = false;
process.on("SIGINT", () => { stopping = true; }); process.on("SIGTERM", () => { stopping = true; });
try {
  while (!stopping) { await jobs.runNext(new FixtureEtsyAdapter()); await new Promise(resolve => setTimeout(resolve, 1000)); }
} finally { await client.end(); }
