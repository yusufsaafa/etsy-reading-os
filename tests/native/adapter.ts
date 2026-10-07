// Acceptance only: never reads DATABASE_URL or application environment files.
import postgres from "postgres";
import { userInfo } from "node:os";
import { randomUUID } from "node:crypto";
import { drizzle as nativeDrizzle } from "drizzle-orm/postgres-js";
export class PGlite {
 readonly name=`mrh_native_${randomUUID().replaceAll("-","")}`;
 readonly client=postgres({host:"127.0.0.1",port:5432,username:userInfo().username,password:"",ssl:false,database:this.name,max:5,connect_timeout:5,onnotice:()=>{},connection:{statement_timeout:15000,lock_timeout:10000}});
 private readonly raw=postgres({host:"127.0.0.1",port:5432,username:userInfo().username,password:"",ssl:false,database:this.name,max:1,onnotice:()=>{},types:{json:{to:114,from:[114,3802],serialize:(v:unknown)=>typeof v==="string"?v:JSON.stringify(v),parse:JSON.parse}},connection:{statement_timeout:15000,lock_timeout:10000}});
 private readonly ready=this.create();
 private async create(){const admin=postgres({host:"127.0.0.1",port:5432,username:userInfo().username,password:"",ssl:false,database:"postgres",max:1,onnotice:()=>{}});try{await admin.unsafe(`CREATE DATABASE "${this.name}"`);}finally{await admin.end();}}
 async exec(text:string){await this.ready;await this.raw.unsafe(text);}
 async query<T=Record<string,unknown>>(text:string,args:unknown[]=[]){await this.ready;return {rows:await this.raw.unsafe(text,args as never[]) as unknown as T[]};}
 async close(){await this.ready;await this.client.end();await this.raw.end();const admin=postgres({host:"127.0.0.1",port:5432,username:userInfo().username,password:"",ssl:false,database:"postgres",max:1,onnotice:()=>{}});try{await admin.unsafe(`DROP DATABASE "${this.name}"`);}finally{await admin.end();}}
}
export function drizzle(pg:PGlite,options:Parameters<typeof nativeDrizzle>[1]){return nativeDrizzle(pg.client,options!);}
