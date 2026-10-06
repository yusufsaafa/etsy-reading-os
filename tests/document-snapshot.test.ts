import { it, expect } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { stableJson } from "../src/modules/intake/contracts";
import { documentSnapshotSchema, documentSnapshotHash, immutableDocumentSnapshot, MAX_DOCUMENT_SNAPSHOT_BYTES, historicalTemplate } from "../src/modules/documents/snapshot-contract";
import { documentDesignSchema, configurationHash } from "../src/modules/documents/contracts";
import { createDocumentSnapshotCommand } from "../src/modules/documents/snapshot-service";
function fixture() {
 const configuration=documentDesignSchema.parse({contractVersion:"document-design/v1",template:"classic",brand:{name:"Studio",primaryColor:"#112233",accentColor:"#abcdef"},typography:{heading:"inter",body:"source-serif-4"},cover:"SIMPLE",display:{customerName:true,readingDate:true,sectionDividers:true,cardImagery:false,footer:true},footerText:"Thank you"});
 const sections=[{sectionId:"first",title:"First",content:"Exact edited text — 猫 🐾\n\n<script>plain text</script>"},{sectionId:"second",title:"Second",content:"Second body"}];
 const value={contractVersion:"document-snapshot/v1" as const,id:randomUUID(),organizationId:randomUUID(),storeId:randomUUID(),
 reading:{readingId:randomUUID(),order:{id:randomUUID(),reference:"2002",customerName:"Synthetic recipient"},product:{id:randomUUID(),name:"Reading"},readingNumber:1,quantity:2,sections,contentHash:createHash("sha256").update(stableJson({sections})).digest("hex"),approvedAt:"2026-10-06T10:00:00.000Z"},
 design:{id:randomUUID(),revision:3,name:"Main",source:"STORE_DEFAULT" as const,template:{key:"classic",contractVersion:"document-template/v1" as const,version:1},configuration,configurationHash:configurationHash(configuration)},
 provenance:{reviewId:randomUUID(),generationId:randomUUID()},createdAt:"2026-10-06T10:05:00.000Z"};
 return {...value,snapshotHash:documentSnapshotHash(value)};
}
it("strict snapshot freezes exact ordered approved content, display context and bounded design",()=>{
 const raw=fixture(),snapshot=immutableDocumentSnapshot(raw);raw.reading.sections[0].content="Changed";raw.design.configuration.brand.name="Changed";
 expect(snapshot.reading.sections[0].content).toContain("Exact edited");expect(snapshot.design.configuration.brand.name).toBe("Studio");expect(Object.isFrozen(snapshot.reading.sections[0])).toBe(true);expect(Object.isFrozen(snapshot.design.configuration)).toBe(true);
 expect(Object.keys(snapshot)).not.toContain("draft");expect(Object.keys(snapshot)).not.toContain("provider");expect(snapshot.reading).not.toHaveProperty("answers");
});
it("semantic hash excludes timestamp, snapshot identity and database provenance but observes every display/content/design input",()=>{
 const value=fixture(),other=structuredClone(value);other.id=randomUUID();other.createdAt="2026-10-07T10:00:00.000Z";other.design.revision++;other.design.id=randomUUID();other.provenance.reviewId=randomUUID();
 expect(documentSnapshotHash(other)).toBe(value.snapshotHash);
 for(const change of [(v:typeof value)=>v.reading.sections.reverse(),(v:typeof value)=>v.reading.sections[0].content+="\n",(v:typeof value)=>v.reading.order.customerName="New",(v:typeof value)=>v.reading.product.name="New",(v:typeof value)=>v.reading.approvedAt="2026-10-07T10:00:00.000Z",(v:typeof value)=>v.design.configuration.brand.primaryColor="#AA0000",(v:typeof value)=>v.design.template.version=2]) {const changed=structuredClone(value);change(changed);expect(documentSnapshotHash(changed)).not.toBe(value.snapshotHash);}
});
it.each(["contract","sections","order","contentHash","config","designHash","template","snapshotHash","date","duplicate","unknown","asset"])("corrupt %s fails closed",kind=>{
 const value=fixture();const changed=structuredClone(value) as unknown as Record<string,any>;
 if(kind==="contract")changed.contractVersion="document-snapshot/v2";
 if(kind==="sections")changed.reading.sections=[];
 if(kind==="order")changed.reading.sections.reverse();
 if(kind==="contentHash")changed.reading.contentHash="0".repeat(64);
 if(kind==="config")changed.design.configuration.typography.body="anything";
 if(kind==="designHash")changed.design.configurationHash="0".repeat(64);
 if(kind==="template")changed.design.template.version=99;
 if(kind==="snapshotHash")changed.snapshotHash="0".repeat(64);
 if(kind==="date")changed.createdAt="not a date";
 if(kind==="duplicate")changed.reading.sections[1].sectionId=changed.reading.sections[0].sectionId;
 if(kind==="unknown")changed.provider="google";
 if(kind==="asset")changed.design.configuration.logoUrl="https://example.invalid";
 expect(()=>immutableDocumentSnapshot(changed)).toThrow("DOCUMENT_SNAPSHOT_UNAVAILABLE");
});
it("preserves near-bound long Unicode content without truncation; rejects oversized approved aggregates",()=>{
 const value=fixture();value.reading.sections[0].content="猫".repeat(39000);value.reading.contentHash=createHash("sha256").update(stableJson({sections:value.reading.sections})).digest("hex");value.snapshotHash=documentSnapshotHash(value);
 expect(immutableDocumentSnapshot(value).reading.sections[0].content).toHaveLength(39000);expect(Buffer.byteLength(stableJson(value))).toBeLessThan(MAX_DOCUMENT_SNAPSHOT_BYTES);
 value.reading.sections=Array.from({length:20},(_,i)=>({sectionId:String(i),title:"Section",content:"x".repeat(40000)}));value.reading.contentHash=createHash("sha256").update(stableJson({sections:value.reading.sections})).digest("hex");value.snapshotHash=documentSnapshotHash(value);expect(()=>immutableDocumentSnapshot(value)).toThrow();
});
it("client intent permits only owned lookup identifiers and retained template versions are explicit",()=>{
 const intent={orderId:randomUUID(),readingId:randomUUID()};expect(createDocumentSnapshotCommand.parse(intent)).toEqual(intent);
 for(const key of ["productId","designId","sections","contentHash","generationId","storeId","provenance"])expect(createDocumentSnapshotCommand.safeParse({...intent,[key]:randomUUID()}).success).toBe(false);
 expect(historicalTemplate("classic",1)?.contractVersion).toBe("document-template/v1");expect(historicalTemplate("classic",2)).toBeUndefined();expect(historicalTemplate("__proto__",1)).toBeUndefined();
 expect(documentSnapshotSchema.safeParse({...fixture(),snapshotHash:"bad"}).success).toBe(false);
});
