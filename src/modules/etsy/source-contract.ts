import { z } from "zod";

// Internal purchased evidence, NOT a parser for raw Etsy HTTP responses.
// Every object is strict: an unsupported field must be rejected or explicitly represented.
export const etsyId = z.string().regex(/^[1-9]\d{0,19}$/);
const sourceId = z.string().regex(/^\d{1,20}$/);
const text = z.string().max(10000);
const display = z.string().max(500);
export const observed = <T extends z.ZodType>(value: T) => z.discriminatedUnion("presence", [
  z.object({ presence: z.literal("absent") }).strict(),
  z.object({ presence: z.literal("null") }).strict(),
  z.object({ presence: z.literal("value"), value }).strict(),
]);
const ordinal = z.number().int().min(0).max(127);
export const selectionIdentitySchema = z.object({ propertyId: etsyId, valueIds: z.array(etsyId).min(1).max(30) }).strict();
export type SelectionIdentity = z.infer<typeof selectionIdentitySchema>;
export function selectionKey(selections: readonly SelectionIdentity[]): string {
  // IDs are strings; sorting is for a canonical set, never seller semantics or display order.
  const rows = z.array(selectionIdentitySchema).max(3).parse(selections);
  if (new Set(rows.map(r => r.propertyId)).size !== rows.length || rows.some(r => new Set(r.valueIds).size !== r.valueIds.length))
    throw new Error("AMBIGUOUS_ETSY_SELECTION");
  return "etsy-selection/1:" + rows.map(r => `${r.propertyId}=${[...r.valueIds].sort().join(",")}`).sort().join(";");
}
const money = z.object({ amount: z.number().int().nonnegative().safe(), divisor: z.number().int().positive().safe(), currencyCode: z.string().regex(/^[A-Z]{3}$/) }).strict();
const definition = z.object({
  provenance: z.enum(["PURCHASE_PINNED", "CURRENT_LISTING_OBSERVATION"]),
  observedAt: z.number().int().nonnegative().safe(), questionId: observed(etsyId),
  questionType: observed(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)),
  questionText: observed(display), instructions: observed(z.string().max(10000)), required: observed(z.boolean()),
  maxCharacters: observed(z.number().int().min(1).max(10000)), maxFiles: observed(z.number().int().min(1).max(10)),
  options: observed(z.array(z.object({ optionId: observed(etsyId), label: display }).strict()).max(30)),
}).strict();
const contentIdentity = z.object({
  sourceOrder: ordinal, propertyId: observed(sourceId), questionId: observed(etsyId), valueId: observed(sourceId),
  sourceType: observed(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)),
  formattedName: observed(display), definition: definition.optional(),
}).strict();
const content = z.discriminatedUnion("encoding",[
  contentIdentity.extend({encoding:z.literal("TEXT"),value:observed(text)}).strict(),
  contentIdentity.extend({encoding:z.literal("UNRESOLVED_DROPDOWN"),value:observed(text)}).strict(),
  // Unknown content could be a future upload encoding. Keep presence and identity,
  // never retain arbitrary values that might contain signed buyer URLs.
  contentIdentity.extend({encoding:z.literal("UNKNOWN"),valuePresence:z.enum(["absent","null","value"])}).strict(),
]);
const file = z.object({
  state: z.literal("UNRESOLVED"), sourceOrder: ordinal, questionId: observed(etsyId), propertyId: observed(sourceId),
  sourceType: observed(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)), mimeType: observed(z.string().max(100)),
  valuePresence: z.enum(["absent", "null", "value"]),
  // Structural observation only, not an invented Etsy file identifier/list encoding.
  observedFileCount: observed(z.number().int().min(0).max(10)),
  definition: definition.optional(),
}).strict();
export const etsySourceSchema = z.object({
  contractVersion: z.literal("etsy-purchased-line/v1"),
  receipt: z.object({
    receiptId: etsyId, shopId: etsyId, observedAt: z.number().int().nonnegative().safe(),
    createdTimestamp: observed(z.number().int().nonnegative().safe()), updatedTimestamp: observed(z.number().int().nonnegative().safe()),
    isPaid: observed(z.boolean()), status: observed(z.string().max(80)),
    // No synthetic canceled=false when the actual contract supplies no cancellation flag.
    cancellation: z.object({ state: z.enum(["UNKNOWN", "CANCELED", "NOT_CANCELED"]), basis: z.enum(["STATUS", "EXPLICIT_SOURCE", "UNRESOLVED"]) }).strict(),
    refunds: observed(z.array(z.object({ amount: observed(money), createdTimestamp: observed(z.number().int().nonnegative().safe()), status: observed(z.string().max(80)), reasonPresence: z.enum(["absent", "null", "value"]) }).strict()).max(100)),
    refundAssessment: z.enum(["NONE_REPORTED", "PARTIAL", "FULL", "UNRESOLVED"]),
  }).strict(),
  transaction: z.object({ transactionId: etsyId, receiptId: observed(etsyId), listingId: observed(etsyId),
    quantity: z.number().int().min(0).max(1000), sku: observed(z.string().max(500)), isDigital: observed(z.boolean()),
    listingType: observed(z.enum(["physical", "download", "both"])),
    listingTypeProvenance: z.enum(["PURCHASE_PINNED", "CURRENT_LISTING_OBSERVATION", "UNAVAILABLE"]),
  }).strict(),
  purchaseSelections: z.array(z.object({ sourceOrder: ordinal, propertyId: sourceId, valueIds: observed(z.array(sourceId).max(30)), formattedName: observed(display), formattedValues: observed(z.array(display).max(30)) }).strict()).max(3),
  // Separate purchased product_data corroboration, not another variation position
  // or an authority to repair missing purchased selection identities.
  purchaseProductData: observed(z.array(z.object({sourceOrder:ordinal,propertyId:observed(sourceId),
    propertyName:observed(display),scaleId:observed(sourceId),scaleName:observed(display),
    valueIds:observed(z.array(sourceId).max(30)),values:observed(z.array(display).max(30)),
  }).strict()).max(3)).optional(),
  buyerInputs: z.array(content).max(5),
  buyerFiles: z.array(file).max(10),
  unsupported: z.array(z.object({ sourceOrder: ordinal.optional(), code: z.enum(["UNKNOWN_INPUT", "UNKNOWN_FIELD", "UNRESOLVED_ENCODING", "INCOMPLETE_SOURCE", "LIMIT_EXCEEDED"]),
    sourceType: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(), fieldNames: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,79}$/)).max(30),
  }).strict()).max(30),
}).strict().superRefine((s,ctx) => {
  const positions=[...s.purchaseSelections,...s.buyerInputs,...s.buyerFiles].map(x=>x.sourceOrder);
  if(new Set(positions).size!==positions.length) ctx.addIssue({code:"custom",message:"Duplicate source position"});
  if(s.transaction.receiptId.presence==="value"&&s.transaction.receiptId.value!==s.receipt.receiptId)
    ctx.addIssue({code:"custom",message:"Receipt linkage mismatch"});
  if(s.buyerInputs.some(i=>i.sourceType.presence==="value"&&["unlabeled_upload","labeled_upload"].includes(i.sourceType.value)))
    ctx.addIssue({code:"custom",message:"Upload evidence must use file boundary"});
  if(s.buyerInputs.some(i=>i.encoding!=="UNKNOWN"&&i.sourceType.presence==="value"&&!["text_input","dropdown"].includes(i.sourceType.value)))
    ctx.addIssue({code:"custom",message:"Unknown type requires unresolved value boundary"});
  if(s.receipt.cancellation.state!=="UNKNOWN"&&s.receipt.cancellation.basis==="UNRESOLVED")
    ctx.addIssue({code:"custom",message:"Cancellation assessment requires evidence"});
  // Bounded whole envelope, even when every individual collection is at its limit.
  if(Buffer.byteLength(JSON.stringify(s),"utf8")>131072) ctx.addIssue({code:"custom",message:"Source evidence exceeds limit"});
});
export type EtsySourceEvidence = z.infer<typeof etsySourceSchema>;

export const etsyProductPolicySchema = z.object({
  contractVersion: z.literal("etsy-product-policy/v1"), fulfillment: z.literal("READING"),
  listingId: etsyId, purchaseSelections: z.array(selectionIdentitySchema).max(3),
  // Only purchased text encoding is accepted today. Dropdown/file types remain held.
  inputMappings: z.array(z.object({questionId: etsyId, propertyId: z.literal("54"), sourceType: z.literal("text_input"), inputKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)}).strict()).max(5),
}).strict().superRefine((p,ctx)=>{
  try { selectionKey(p.purchaseSelections); } catch {ctx.addIssue({code:"custom",message:"Ambiguous purchase identities"});}
  if(new Set(p.inputMappings.map(x=>x.questionId)).size!==p.inputMappings.length||new Set(p.inputMappings.map(x=>x.inputKey)).size!==p.inputMappings.length)
    ctx.addIssue({code:"custom",message:"Ambiguous question mappings"});
});
export type EtsyProductPolicy = z.infer<typeof etsyProductPolicySchema>;
export type EtsySourceIssue = "unmapped_listing" | "unmapped_purchase_selection" | "unknown_buyer_input" | "unresolved_dropdown" | "unresolved_upload" | "ambiguous_historical_mapping" | "source_evidence_incomplete" | "unusable_input" | "missing_input" | "unpaid" | "canceled" | "refund_review";

/** Deterministic approved-source projection, not live Etsy normalization or an ingestion command. */
export function assessEtsySource(raw: unknown, rawPolicy?: unknown) {
  const source=etsySourceSchema.parse(raw), issues: EtsySourceIssue[]=[], answers:{label:string;value:string;kind:"text"}[]=[];
  const parsed=etsyProductPolicySchema.safeParse(rawPolicy), policy=parsed.success?parsed.data:undefined;
  if(source.receipt.isPaid.presence!=="value"||!source.receipt.isPaid.value) issues.push("unpaid");
  if(source.receipt.cancellation.state==="CANCELED") issues.push("canceled");
  if(source.receipt.cancellation.state==="UNKNOWN"||source.receipt.status.presence!=="value") issues.push("source_evidence_incomplete");
  if(source.receipt.status.presence==="value"){
    const status=source.receipt.status.value.toLowerCase();
    if(status==="canceled") issues.push("canceled");
    else if(["fully refunded","partially refunded"].includes(status)) issues.push("refund_review");
    else if(!["paid","completed"].includes(status)) issues.push("source_evidence_incomplete");
  }
  if(source.receipt.refundAssessment!=="NONE_REPORTED"||source.receipt.refunds.presence!=="value"||source.receipt.refunds.value.length) issues.push("refund_review");
  if(source.transaction.quantity<1||source.transaction.isDigital.presence!=="value") issues.push("source_evidence_incomplete");
  if(!policy||source.transaction.listingId.presence!=="value"||source.transaction.listingId.value!==policy.listingId) issues.push("unmapped_listing");
  else {
    try {
      const key=selectionKey(source.purchaseSelections.map(x=>({propertyId:x.propertyId,valueIds:x.valueIds.presence==="value"?x.valueIds.value:[]})));
      if(key!==selectionKey(policy.purchaseSelections)) issues.push("unmapped_purchase_selection");
    } catch {issues.push("unmapped_purchase_selection");}
  }
  if(source.unsupported.length) issues.push("unknown_buyer_input");
  if(source.purchaseProductData?.presence==="value"){
    const seenProperties=new Set<string>();
    for(const p of source.purchaseProductData.value){
      const id=p.propertyId.presence==="value"?p.propertyId.value:undefined;
      const matches=source.purchaseSelections.filter(s=>s.propertyId===id);
      if(!id||seenProperties.has(id)||matches.length!==1||matches[0].valueIds.presence!=="value"||p.valueIds.presence!=="value"||
        new Set(p.valueIds.value).size!==p.valueIds.value.length||JSON.stringify([...matches[0].valueIds.value].sort())!==JSON.stringify([...p.valueIds.value].sort())||
        p.scaleId.presence==="value"||p.scaleName.presence==="value")issues.push("source_evidence_incomplete");
      if(id)seenProperties.add(id);
    }
  }
  if(source.buyerFiles.length) issues.push("unresolved_upload");
  const seen=new Set<string>();
  for(const input of source.buyerInputs){
    if(input.encoding==="UNRESOLVED_DROPDOWN") {issues.push("unresolved_dropdown");continue;}
    if(input.encoding!=="TEXT"|| (input.sourceType.presence==="value"&&input.sourceType.value!=="text_input")) {issues.push("unknown_buyer_input");continue;}
    // Non-null selected-value evidence is not verified purchased text encoding.
    if(input.valueId.presence==="value") {issues.push("unknown_buyer_input");continue;}
    const id=input.questionId.presence==="value"?input.questionId.value:undefined;
    const mapping=policy?.inputMappings.find(m=>m.questionId===id&&input.propertyId.presence==="value"&&m.propertyId===input.propertyId.value);
    if(!id||seen.has(id)||!mapping) {issues.push("ambiguous_historical_mapping");continue;}
    seen.add(id);
    // A current definition with a different identity never repairs/rebinds a purchase.
    if(input.definition?.questionId.presence==="value"&&input.definition.questionId.value!==id) {issues.push("ambiguous_historical_mapping");continue;}
    if(input.definition?.questionType.presence==="value"&&input.definition.questionType.value!=="text_input") {issues.push("ambiguous_historical_mapping");continue;}
    if(input.value.presence==="value") answers.push({label:mapping.inputKey,value:input.value.value,kind:"text"});
  }
  return {source,policy,issues:[...new Set(issues)],answers};
}
