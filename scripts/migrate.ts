import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "../src/db/client";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const { db, client } = createDatabase(process.env.DATABASE_URL);
try { await migrate(db, { migrationsFolder: "./drizzle" }); console.log("Migrations applied"); }
finally { await client.end(); }
