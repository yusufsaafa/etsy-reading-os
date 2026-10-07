import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({resolve:{alias:[
 {find:"@electric-sql/pglite",replacement:fileURLToPath(new URL("./tests/native/adapter.ts",import.meta.url))},
 {find:"drizzle-orm/pglite/migrator",replacement:"drizzle-orm/postgres-js/migrator"},
 {find:"drizzle-orm/pglite",replacement:fileURLToPath(new URL("./tests/native/adapter.ts",import.meta.url))}
]},test:{include:["tests/document-artifact.db.test.ts","tests/reading-media.db.test.ts","tests/native/*.native.ts"],fileParallelism:false,testTimeout:30000,hookTimeout:30000}});
