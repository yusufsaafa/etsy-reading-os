import {it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {TARGET,ROLE,requireRuntime,requireConfirmation,requireIdentity,requireAbsent,connectionOptions,IdentityMismatch} from "../scripts/acceptance/recovery/safety";
it.each(["22.12.0","22.23.1","24.0.0"])("accepts supported runtime %s",v=>expect(()=>requireRuntime(v)).not.toThrow());
it.each(["20.16.0","22.11.9","invalid"])("rejects unsupported runtime %s",v=>expect(()=>requireRuntime(v)).toThrow());
it("requires the exact explicit creation confirmation",()=>{for(const value of [undefined,"true","etsy_reading_os","etsy_reading_os_webhook_test"])expect(()=>requireConfirmation({RECOVERY_ACCEPTANCE_CONFIRM:value})).toThrow();expect(()=>requireConfirmation({RECOVERY_ACCEPTANCE_CONFIRM:TARGET})).not.toThrow();});
it("refuses any existing acceptance database",()=>{expect(()=>requireAbsent([])).not.toThrow();expect(()=>requireAbsent([{datname:TARGET}])).toThrow("ALREADY_EXISTS");});
it("only produces fixed maintenance and acceptance connection targets",()=>{
 for(const name of ["etsy_reading_os","etsy_reading_os_webhook_test","other"])expect(()=>connectionOptions(name,"")).toThrow("DATABASE_TARGET_FORBIDDEN");
 for(const name of ["postgres",TARGET])expect(connectionOptions(name,"")).toMatchObject({host:"127.0.0.1",port:5432,database:name,username:ROLE,password:"",max:1,debug:false,connection:{statement_timeout:20000,lock_timeout:5000}});
});
it("checks database, role, address, port and OID before allowing writes",()=>{
 const row={database:TARGET,role:ROLE,address:"127.0.0.1",port:5432,oid:123};expect(()=>requireIdentity(row,TARGET)).not.toThrow();
 for(const changed of [{database:"etsy_reading_os"},{role:"other"},{address:"192.0.2.1"},{port:5433},{oid:undefined}])expect(()=>requireIdentity({...row,...changed},TARGET)).toThrow();
});
it("entry point does not load environment files, use PGlite, or automatically drop databases",()=>{
 const source=readFileSync("scripts/acceptance/recovery/native.ts","utf8"),pkg=JSON.parse(readFileSync("package.json","utf8"));
 expect(pkg.scripts["acceptance:recovery-native"]).toBe("tsx scripts/acceptance/recovery/native.ts");
 expect(source).not.toMatch(/DROP\s+DATABASE|PGlite|dotenv|--env-file/i);
 expect(source).toContain("readMigrationFiles");expect(source).toContain("pg_stat_activity");expect(source).toContain("wait_event_type='Lock'");
});

it("uses host(inet_server_addr()) instead of PostgreSQL inet-to-text netmask formatting",()=>{
 const source=readFileSync("scripts/acceptance/recovery/native.ts","utf8");
 expect(source).toContain("host(inet_server_addr()) AS address");
 expect(source).not.toContain("inet_server_addr()::text");
});
it.each([null,"::1","127.0.0.1/32","192.0.2.1"])("continues rejecting nonexact or non-TCP addresses %s",address=>{
 expect(()=>requireIdentity({database:"postgres",role:ROLE,address,port:5432,oid:123},"postgres")).toThrow("DATABASE_IDENTITY_MISMATCH");
});
it("identifies every failed identity field using only fixed labels",()=>{
 const row={database:"postgres",role:ROLE,address:"127.0.0.1",port:5432,oid:123};
 for(const [field,value] of [["database","other"],["role","other"],["address","127.0.0.1/32"],["port","5432"],["oid","123"]]){
  try{requireIdentity({...row,[field]:value},"postgres");throw new Error("expected rejection");}catch(error){expect(error).toBeInstanceOf(IdentityMismatch);expect((error as IdentityMismatch).fields).toEqual([field]);expect((error as Error).message).toBe("DATABASE_IDENTITY_MISMATCH");}
 }
 expect(()=>requireIdentity(undefined,"postgres")).toThrow("DATABASE_IDENTITY_MISMATCH");
});
