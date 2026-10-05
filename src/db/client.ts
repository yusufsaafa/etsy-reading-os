import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
export function createDatabase(url: string) {
  const client = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
  return { db: drizzle(client, { schema }), client };
}
export type Database = ReturnType<typeof createDatabase>["db"];
export type DbExecutor = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;
let instance: ReturnType<typeof createDatabase> | undefined;
export function database() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return (instance ??= createDatabase(process.env.DATABASE_URL)).db;
}
