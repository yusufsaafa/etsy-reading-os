import {expect,it,vi} from "vitest";
import {drizzle} from "drizzle-orm/postgres-js";
import {sql} from "drizzle-orm";
import type {Sql} from "postgres";
import {acceptanceTransaction,safeErrorCode,type RunDiagnostic} from "../scripts/acceptance/webhook/diagnostics";
it("scoped postgres-js transaction cannot be reconstructed with drizzle; real Drizzle transaction preserves nested savepoints",async()=>{
 const unsafe=vi.fn(async(_query:string,_params?:unknown[])=>[]);
 const scoped:{unsafe:typeof unsafe;savepoint?:unknown}={unsafe};
 scoped.savepoint=vi.fn(async callback=>callback(scoped));
 expect(()=>drizzle(scoped as unknown as Sql)).toThrow(TypeError);
 const root={options:{parsers:{},serializers:{}},unsafe,begin:vi.fn(async callback=>callback(scoped))};
 const db=drizzle(root as unknown as Sql),diagnostic:RunDiagnostic={stage:"START",transaction:"NOT_STARTED"};
 const value=await acceptanceTransaction(db,diagnostic,async tx=>{
  await tx.execute(sql`select 1`);
  return tx.transaction(async nested=>{await nested.execute(sql`select 2`);return "verified";});
 });
 expect(value).toBe("verified");expect(diagnostic.transaction).toBe("COMMITTED");expect(root.begin).toHaveBeenCalledOnce();expect(scoped.savepoint).toHaveBeenCalledOnce();
 expect(unsafe.mock.calls[0][0]).toContain("read write");
});
it("reports callback rollback without exposing database query/params in wrapped errors",async()=>{
 const diagnostic:RunDiagnostic={stage:"START",transaction:"NOT_STARTED"};
 const failure=Object.assign(new Error("secret query params"),{cause:{code:"23503",detail:"private payload"}});
 const transaction=vi.fn(async(callback:(tx:{})=>Promise<unknown>)=>callback({}));
 await expect(acceptanceTransaction({transaction},diagnostic,async()=>{diagnostic.stage="INBOX_PERSISTENCE";throw failure;})).rejects.toBe(failure);
 expect(diagnostic).toMatchObject({stage:"INBOX_PERSISTENCE",transaction:"ROLLBACK_REPORTED_BY_DRIVER"});expect(safeErrorCode(failure)).toBe("DRIVER_23503");
});
it("does not claim rollback when commit or rollback fails",async()=>{
 for(const during of ["commit","rollback"]){
  const diagnostic:RunDiagnostic={stage:"START",transaction:"NOT_STARTED"};
  const transaction=async(callback:(tx:{})=>Promise<string>)=>{try{await callback({});}catch{/* simulate driver rollback failure */}throw new Error("connection failure");};
  await expect(acceptanceTransaction({transaction},diagnostic,async()=>{if(during==="rollback")throw new Error("original callback error");return "ok";})).rejects.toThrow();
  expect(diagnostic.transaction).toBe("UNKNOWN");
 }
});
it("begin failure reports no transaction and diagnostics never echo arbitrary error messages",async()=>{
 const diagnostic:RunDiagnostic={stage:"START",transaction:"NOT_STARTED"};
 const transaction=async()=>{throw Object.assign(new Error("connection string secret"),{code:"EPERM"});};
 await expect(acceptanceTransaction({transaction},diagnostic,async()=>"never")).rejects.toThrow();
 expect(diagnostic.transaction).toBe("NOT_STARTED");expect(diagnostic.stage).toBe("TRANSACTION_BEGIN");
 expect(safeErrorCode(new Error("SECRET_TOKEN"))).toBe("UNCLASSIFIED_ERROR");
 expect(safeErrorCode(new TypeError("Cannot read properties of undefined (reading parsers)"))).toBe("INTERNAL_TYPE_ERROR");
 expect(safeErrorCode(new Error("PINNED_VERSION_MISMATCH"))).toBe("PINNED_VERSION_MISMATCH");
});
