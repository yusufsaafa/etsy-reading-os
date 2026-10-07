import { z } from "zod";
import { detached, hashSchema } from "../../media/contracts";
import { retainedBytes, sha256 } from "../resources/bytes";

export const PDF_RENDERER = "reading-pdf/1" as const;
export const PDF_LIMITS = Object.freeze({ pages:1000, bytes:128*1024*1024, convertedImageBytes:64*1024*1024,
 contentBytes:32*1024*1024, glyphs:1000000, cidsPerFont:65534 });
export class DocumentPdfError extends Error {
 constructor(readonly code:string,cause?:unknown){super(code,{cause});}
}
export const pdfResultSchema=z.strictObject({
 contractVersion:z.literal("validated-document-pdf/v1"),rendererVersion:z.literal(PDF_RENDERER),
 layoutHash:hashSchema,resourceHash:hashSchema,sha256:hashSchema,
 byteLength:z.number().int().positive().max(PDF_LIMITS.bytes),pageCount:z.number().int().min(2).max(PDF_LIMITS.pages),
 metadataPolicy:z.literal("stable-input-id/no-clock/1"),
});
export type ValidatedDocumentPdf=Readonly<{metadata:Readonly<z.infer<typeof pdfResultSchema>>;copyBytes():Uint8Array}>;
/** Private backing bytes, never JSON snapshot/persistence. Each consumer owns its returned copy. */
export function validatedPdfResult(bytes:Uint8Array,layoutHash:string,resourceHash:string,pageCount:number):ValidatedDocumentPdf {
 const metadata=detached(pdfResultSchema.parse({contractVersion:"validated-document-pdf/v1",rendererVersion:PDF_RENDERER,
 layoutHash,resourceHash,sha256:sha256(bytes),byteLength:bytes.length,pageCount,metadataPolicy:"stable-input-id/no-clock/1"}));
 return Object.freeze({metadata,...retainedBytes(bytes)});
}
