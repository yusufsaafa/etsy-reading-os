import { createHash } from "node:crypto";
import { stableJson } from "../intake/contracts";
import { documentDesignSchema, configurationHash } from "./contracts";
import { immutableDocumentSnapshot, documentSnapshotHash } from "./snapshot-contract";
import { immutableRenderInput, documentMediaHash } from "./media-contract";
import { loadControlledFonts } from "./resources/fonts";
import { productionMeasurement } from "./resources/measurement";
import { composeDocumentLayout } from "./layout/engine";
import { prepareLayoutResources } from "./resources/bundle";
import type { z } from "zod";
import { documentMediaSchema } from "./media-contract";
import type { FrozenAsset } from "./resources/images";
import { renderDocumentPdf } from "./pdf/renderer";
const id="00000000-0000-4000-8000-000000000001";
const date="2026-01-01T12:00:00.000Z";
/** In-memory canonical render input. No repository, customer lookup, storage or AI access. */
export function studioPreviewInput(raw:unknown,media:z.infer<typeof documentMediaSchema>={mode:"NONE"}) {
 const configuration=documentDesignSchema.parse(raw);
 const paragraph="This illustrative passage demonstrates the spacing, typography and flow of a finished reading. It is synthetic preview content, not a customer's reading. Your approved section text will retain its paragraphs and continue naturally across pages. ";
 const sections=[{sectionId:"current-situation",title:"Current situation",content:paragraph.repeat(40)+"\n\n"+paragraph.repeat(8)},{sectionId:"future-direction",title:"Future direction",content:paragraph.repeat(10)},{sectionId:"guidance",title:"Guidance",content:paragraph.repeat(4)}];
 const reading={readingId:id,order:{id,reference:"preview",customerName:"Example customer"},product:{id,name:"Your personalized reading"},reader:{displayName:"Example studio",source:"STORE" as const},readingNumber:1,quantity:1,sections,contentHash:createHash("sha256").update(stableJson({sections})).digest("hex"),approvedAt:date};
 const rawSnapshot={contractVersion:"document-snapshot/v1",id,organizationId:id,storeId:id,reading,design:{id,revision:0,name:"Studio preview",source:"PRODUCT" as const,template:{key:configuration.template,contractVersion:"document-template/v1" as const,version:1},configuration,configurationHash:configurationHash(configuration)},provenance:{reviewId:id,generationId:id},createdAt:date};
 const snapshot=immutableDocumentSnapshot({...rawSnapshot,snapshotHash:documentSnapshotHash(rawSnapshot as never)});
 return immutableRenderInput(snapshot,{contractVersion:"document-media-snapshot/v1",id,organizationId:id,storeId:id,documentSnapshotId:id,readingId:id,provenance:{reviewId:id,generationId:id,approvedMediaHash:"0".repeat(64)},media,mediaHash:documentMediaHash(media),createdAt:date});
}
export async function renderStudioPreview(raw:unknown,ports?:{media:z.infer<typeof documentMediaSchema>;readAsset:(asset:Readonly<FrozenAsset>)=>Promise<Uint8Array>}) {
 const input=studioPreviewInput(raw,ports?.media),measurement=productionMeasurement(await loadControlledFonts()),layout=composeDocumentLayout(input,measurement);
 const resources=await prepareLayoutResources(input,layout,measurement,ports?.readAsset??(async()=>{throw new Error("PREVIEW_RESOURCE_UNAVAILABLE");}));
 const pdf=await renderDocumentPdf({layout,resources});
 return {pdf,layout};
}
