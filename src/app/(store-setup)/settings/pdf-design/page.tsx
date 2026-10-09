import { notFound } from "next/navigation";
import { z } from "zod";
import { database } from "@/db/client";
import { currentStoreScope } from "@/modules/identity/session";
import { verifyScope } from "@/modules/intake/service";
import { DOCUMENT_FONTS } from "@/modules/documents/contracts";
import { getDocumentDesign,listDocumentDesigns,listStudioProducts } from "@/modules/documents/service";
import { studioPreset } from "@/modules/documents/studio-templates";
import { DesignStudio } from "@/components/documents/design-studio";
export const dynamic="force-dynamic";
export default async function PdfDesignPage({searchParams}:{searchParams:Promise<{design?:string}>}) {
 const scope=await currentStoreScope(),db=database();await verifyScope(db,scope,true);
 const query=await searchParams;let initial=null;
 if(query.design){const parsed=z.uuid().safeParse(query.design);if(!parsed.success)notFound();try{const row=await getDocumentDesign(db,scope,parsed.data);if(row.status!=="ACTIVE")notFound();initial={id:row.id,name:row.name,revision:row.revision,configuration:row.configuration};}catch{notFound();}}
 const designs=(await listDocumentDesigns(db,scope)).filter(d=>d.status==="ACTIVE").map(d=>({id:d.id,name:d.name,revision:d.revision}));
 const products=await listStudioProducts(db,scope);
 return <DesignStudio key={initial?.id??"new"} initial={initial} configuration={initial?.configuration??studioPreset("classic")} designs={designs} fonts={Object.entries(DOCUMENT_FONTS)} products={products}/>;
}
