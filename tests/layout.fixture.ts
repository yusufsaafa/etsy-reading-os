import { randomUUID,createHash } from "node:crypto";
import { stableJson } from "../src/modules/intake/contracts";
import { configurationHash,documentDesignSchema } from "../src/modules/documents/contracts";
import { documentSnapshotHash,immutableDocumentSnapshot } from "../src/modules/documents/snapshot-contract";
import { renderInputSchema,documentMediaHash,immutableRenderInput } from "../src/modules/documents/media-contract";
import { CANONICAL_CARDS } from "../src/modules/media/catalog";
export function layoutFixture(template="mystic",count=0,bodies=["Exact short reading.\n\nSecond paragraph.","Another section."]) {
 const configuration=documentDesignSchema.parse({contractVersion:"document-design/v1",template,brand:{name:"Synthetic Studio",primaryColor:"#112233",accentColor:"#AA9966"},typography:{heading:"source-serif-4",body:"inter"},cover:"BRAND",display:{customerName:true,readingDate:true,sectionDividers:true,cardImagery:count>0,footer:true},footerText:"Synthetic footer"});
 const sections=bodies.map((content,i)=>({sectionId:"section-"+i,title:"Section "+i,content}));
 const raw={contractVersion:"document-snapshot/v1",id:randomUUID(),organizationId:randomUUID(),storeId:randomUUID(),reading:{readingId:randomUUID(),order:{id:randomUUID(),reference:"synthetic",customerName:"Synthetic recipient"},product:{id:randomUUID(),name:"Synthetic Reading"},readingNumber:1,quantity:1,sections,contentHash:createHash("sha256").update(stableJson({sections})).digest("hex"),approvedAt:"2026-10-07T00:00:00.000Z"},design:{id:randomUUID(),revision:1,name:"Synthetic design",source:"STORE_DEFAULT" as const,template:{key:template,contractVersion:"document-template/v1" as const,version:1},configuration,configurationHash:configurationHash(configuration)},provenance:{reviewId:randomUUID(),generationId:randomUUID()},createdAt:"2026-10-07T00:01:00.000Z"};
 const snapshot=immutableDocumentSnapshot({...raw,snapshotHash:documentSnapshotHash(raw as never)});
 const media=count?{mode:"TAROT_CARDS" as const,deck:{deckKey:"synthetic",deckVersion:1},cards:CANONICAL_CARDS.slice(0,count).map((c,position)=>({cardKey:c.key,position,orientation:position%2?"REVERSED" as const:"UPRIGHT" as const,asset:{id:randomUUID(),contentHash:"a".repeat(64),mediaType:"image/png" as const,byteSize:128,width:300,height:500}}))}:{mode:"NONE" as const};
 return renderInputSchema.parse(immutableRenderInput(snapshot,{contractVersion:"document-media-snapshot/v1",id:randomUUID(),organizationId:snapshot.organizationId,storeId:snapshot.storeId,documentSnapshotId:snapshot.id,readingId:snapshot.reading.readingId,provenance:{...snapshot.provenance,approvedMediaHash:"b".repeat(64)},media,mediaHash:documentMediaHash(media),createdAt:"2026-10-07T00:02:00.000Z"}));
}
