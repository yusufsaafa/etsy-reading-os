import { z } from "zod";
import { detached, hashSchema } from "../media/contracts";
import { PDF_RENDERER, PDF_LIMITS } from "./pdf/contract";
export const artifactSchema=z.strictObject({
 contractVersion:z.literal("document-artifact/v1"),id:z.uuid(),organizationId:z.uuid(),storeId:z.uuid(),orderId:z.uuid(),readingId:z.uuid(),
 documentSnapshotId:z.uuid(),mediaSnapshotId:z.uuid(),rendererVersion:z.literal(PDF_RENDERER),layoutHash:hashSchema,resourceHash:hashSchema,sha256:hashSchema,
 byteLength:z.number().int().positive().max(PDF_LIMITS.bytes),pageCount:z.number().int().min(2).max(PDF_LIMITS.pages),contentType:z.literal("application/pdf"),
 objectKey:z.string().max(400),state:z.enum(["PENDING","AVAILABLE"]),createdAt:z.iso.datetime(),availableAt:z.iso.datetime().nullable(),
}).superRefine((v,c)=>{
 if(v.objectKey!==artifactObjectKey(v))c.addIssue({code:"custom",message:"Invalid owned object identity"});
 if((v.state==="AVAILABLE")!==(v.availableAt!==null)||(v.availableAt!==null&&Date.parse(v.availableAt)<Date.parse(v.createdAt)))c.addIssue({code:"custom",message:"Invalid artifact lifecycle"});
});
export type DocumentArtifact=Readonly<z.infer<typeof artifactSchema>>;
/** Include exact source intent as well as digest: no collision between different historical sources. */
export function artifactObjectKey(v:{organizationId:string;storeId:string;readingId:string;mediaSnapshotId:string;rendererVersion:string;sha256:string}){
 return `private/documents/v1/${v.organizationId}/${v.storeId}/${v.readingId}/${v.mediaSnapshotId}/${v.rendererVersion.replace("/","-")}/${v.sha256}.pdf`;
}
export function immutableArtifact(raw:unknown):DocumentArtifact{return detached(artifactSchema.parse(raw));}
export class DocumentArtifactError extends Error{constructor(readonly code:string){super(code);}}

const {objectKey:privateObjectKey,...publicShape}=artifactSchema.shape;
void privateObjectKey;
export const availableArtifactSchema=z.strictObject({...publicShape,contractVersion:z.literal("available-document-artifact/v1"),state:z.literal("AVAILABLE"),availableAt:z.iso.datetime()});
