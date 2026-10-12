import {it,expect,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
vi.mock("@/app/(operations)/orders/actions",()=>({assignReadingAction:vi.fn()}));
import {ReadingRecovery} from "../src/components/reading-recovery";
it("offers an explicit first-assignment form without automatic selection or generation",()=>{
 const markup=renderToStaticMarkup(createElement(ReadingRecovery,{unitId:"unit",revision:2,candidates:[{id:"version",title:"Approved reading",number:3,status:"ARCHIVED",sections:["Reading"],fields:["Context"],output:"PDF",historical:true}]}));
 expect(markup).toContain("Assign first reading configuration");expect(markup).toContain("Purchase Information");expect(markup).toContain('name="versionId"');expect(markup).toContain("Select a configuration");expect(markup).toContain("version 3 · archived");expect(markup).toContain('name="confirmed"');expect(markup).toContain("binding cannot be changed");expect(markup).toContain("does not start generation");expect(markup).toContain('disabled=""');
});
it("shows a recovery reason and existing Products link when evidence/configuration is unavailable",()=>{
 const markup=renderToStaticMarkup(createElement(ReadingRecovery,{unitId:"unit",revision:0,candidates:[],reason:"Purchased historical evidence is incomplete."}));
 expect(markup).toContain("Purchased historical evidence is incomplete.");expect(markup).toContain('href="/products"');expect(markup).not.toContain("<form");
});
