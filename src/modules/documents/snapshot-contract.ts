import { createHash } from "node:crypto";
import { z } from "zod";
import { stableJson } from "../intake/contracts";
import { approvedReadingForDocumentSchema } from "../review/approved-reading";
import { MAX_DRAFT_BYTES } from "../review/draft-contract";
import { documentDesignSchema, configurationHash, DOCUMENT_TEMPLATE_VERSIONS } from "./contracts";

// Retained v1 definitions, distinct from future current-template selection policy.
// Rendering-semantic changes require a new explicit version; retain every historical entry.
export const DOCUMENT_TEMPLATE_HISTORY = DOCUMENT_TEMPLATE_VERSIONS;
export function historicalTemplate(key: string, version: number) {
  if (!Object.hasOwn(DOCUMENT_TEMPLATE_HISTORY,key)) return undefined;
  return (DOCUMENT_TEMPLATE_HISTORY[key as keyof typeof DOCUMENT_TEMPLATE_HISTORY] as Readonly<Record<number,{contractVersion:string;version:number}>>)[version];
}
export const MAX_DOCUMENT_SNAPSHOT_BYTES = 600000;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const reading = approvedReadingForDocumentSchema.omit({contractVersion:true,organizationId:true,storeId:true,provenance:true})
  .extend({product:approvedReadingForDocumentSchema.shape.product.extend({id:z.uuid()}).strict()});
export const documentSnapshotSchema = z.strictObject({
  contractVersion:z.literal("document-snapshot/v1"), id:z.uuid(), organizationId:z.uuid(), storeId:z.uuid(),
  reading,
  design:z.strictObject({id:z.uuid(),revision:z.number().int().nonnegative(),name:z.string().min(1).max(100),source:z.enum(["PRODUCT","STORE_DEFAULT"]),
    template:z.strictObject({key:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),contractVersion:z.literal("document-template/v1"),version:z.number().int().positive()}),
    configuration:documentDesignSchema,configurationHash:hash}),
  provenance:approvedReadingForDocumentSchema.shape.provenance,
  snapshotHash:hash,createdAt:z.iso.datetime(),
});
type Snapshot = z.infer<typeof documentSnapshotSchema>;
type DeepReadonly<T> = T extends object ? {readonly [K in keyof T]:DeepReadonly<T[K]>} : T;
export type DocumentSnapshot = DeepReadonly<Snapshot>;
/** v1 semantic hash: exact content/display context + template/version/config. No database provenance or creation time. */
export function documentSnapshotHash(value: Pick<Snapshot,"reading"|"design"> | Pick<DocumentSnapshot,"reading"|"design">) {
  return createHash("sha256").update(stableJson({
    reading:{order:value.reading.order,product:value.reading.product,readingNumber:value.reading.readingNumber,quantity:value.reading.quantity,
      sections:value.reading.sections,approvedAt:value.reading.approvedAt},
    template:value.design.template,configuration:value.design.configuration,
  })).digest("hex");
}
export class DocumentSnapshotUnavailable extends Error { constructor(){ super("DOCUMENT_SNAPSHOT_UNAVAILABLE"); } }
export function immutableDocumentSnapshot(raw:unknown):DocumentSnapshot {
  try {
    const value=documentSnapshotSchema.parse(raw);
    const approved={sections:value.reading.sections};
    if (Buffer.byteLength(stableJson(approved),"utf8")>MAX_DRAFT_BYTES || new Set(value.reading.sections.map(s=>s.sectionId)).size!==value.reading.sections.length) throw new Error();
    if (createHash("sha256").update(stableJson(approved)).digest("hex")!==value.reading.contentHash) throw new Error();
    if (configurationHash(value.design.configuration)!==value.design.configurationHash) throw new Error();
    const template=historicalTemplate(value.design.template.key,value.design.template.version);
    if (!template || template.contractVersion!==value.design.template.contractVersion || value.design.template.key!==value.design.configuration.template) throw new Error();
    if (value.reading.readingNumber>value.reading.quantity || documentSnapshotHash(value)!==value.snapshotHash || Buffer.byteLength(stableJson(value),"utf8")>MAX_DOCUMENT_SNAPSHOT_BYTES) throw new Error();
    function freeze(object:object) { for(const child of Object.values(object))if(child&&typeof child==="object")freeze(child);Object.freeze(object); }
    freeze(value);return value;
  }catch{throw new DocumentSnapshotUnavailable();}
}
