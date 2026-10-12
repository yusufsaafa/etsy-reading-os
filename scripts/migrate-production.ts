import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {migrate} from "drizzle-orm/postgres-js/migrator";
import {createDatabase} from "../src/db/client";
/** Explicit production target/authorization, without local env-file loading. */
export function productionMigrationConfiguration(env:Readonly<Record<string,string|undefined>>){
 if(env.NODE_ENV!=="production"||!env.DATABASE_URL||!env.PRODUCTION_DATABASE_NAME||!env.PRODUCTION_DATABASE_ROLE||env.PRODUCTION_MIGRATION_CONFIRM!==env.PRODUCTION_DATABASE_NAME)throw new Error("PRODUCTION_MIGRATION_NOT_AUTHORIZED");
 const url=new URL(env.DATABASE_URL);
 if(!["postgres:","postgresql:"].includes(url.protocol)||!url.hostname||decodeURIComponent(url.pathname.slice(1))!==env.PRODUCTION_DATABASE_NAME)throw new Error("PRODUCTION_DATABASE_TARGET_MISMATCH");
 return {database:env.PRODUCTION_DATABASE_NAME,role:env.PRODUCTION_DATABASE_ROLE};
}
async function main(){
 const expected=productionMigrationConfiguration(process.env),{db,client}=createDatabase(process.env.DATABASE_URL!);
 try{
  const [identity]=await client`select current_database() as database, current_user as role, session_user as session_role`;
  if(identity?.database!==expected.database||identity.role!==expected.role||identity.session_role!==expected.role)throw new Error("PRODUCTION_DATABASE_IDENTITY_MISMATCH");
  await migrate(db,{migrationsFolder:"./drizzle"});console.log("PRODUCTION_MIGRATIONS_APPLIED");
 }finally{await client.end();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){main().catch(()=>{console.error("PRODUCTION_MIGRATION_FAILED");process.exitCode=1;});}
