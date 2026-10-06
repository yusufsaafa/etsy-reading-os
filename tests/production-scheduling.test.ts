import { it,expect } from "vitest";
import { compareProductionWork,defaultSchedulingConfiguration as config,schedulingConfigurationFromEnvironment } from "../src/modules/production/scheduling";
const now=new Date("2026-10-06T09:00:00Z");
const item=(id:string,extra:Partial<Parameters<typeof compareProductionWork>[0]>={})=>({id,createdAt:new Date(now.getTime()-60000),targetDeadline:null,priorityClass:"STANDARD",...extra});
const sort=(items:ReturnType<typeof item>[])=>items.sort((a,b)=>compareProductionWork(a,b,now,config)).map(x=>x.id);
it("Express precedes unaged Standard even when the Standard is older",()=>{expect(sort([item("standard",{createdAt:new Date(now.getTime()-3600000)}),item("express",{priorityClass:"EXPRESS"})])).toEqual(["express","standard"]);});
it("deadline window includes exact boundary, overdue first, and distant deadline retains class",()=>{
 expect(sort([item("express",{priorityClass:"EXPRESS"}),item("near",{targetDeadline:new Date(now.getTime()+config.deadlineWindowMs)}),item("overdue",{targetDeadline:new Date(now.getTime()-1)}),item("later",{targetDeadline:new Date(now.getTime()+config.deadlineWindowMs+1)})])).toEqual(["overdue","near","express","later"]);
});
it("aging threshold overrides endless newer deadline and Express arrivals",()=>{
 expect(sort([item("urgent",{targetDeadline:now}),item("express",{priorityClass:"EXPRESS"}),item("old",{createdAt:new Date(now.getTime()-config.agingThresholdMs)})])).toEqual(["old","urgent","express"]);
});
it("aged work sorts oldest first; waiting age and ID resolve equal ranks deterministically",()=>{
 const date=new Date(now.getTime()-config.agingThresholdMs);expect(sort([item("b",{createdAt:date}),item("a",{createdAt:date}),item("older",{createdAt:new Date(date.getTime()-1)})])).toEqual(["older","a","b"]);
});
it("batch configuration is centralized and rejects invalid server limits",()=>{
 expect(schedulingConfigurationFromEnvironment({PRODUCTION_CLAIM_BATCH_SIZE:"2"}).claimBatchSize).toBe(2);
 for(const value of ["0","101","1.5","NaN","-1"])expect(()=>schedulingConfigurationFromEnvironment({PRODUCTION_CLAIM_BATCH_SIZE:value})).toThrow();
 expect(schedulingConfigurationFromEnvironment({})).toEqual(config);
});
