import { z } from "zod";

export const externalId = z.string().regex(/^[1-9]\d{0,19}$/);
export const answerSchema = z.object({
  label: z.string().max(500), value: z.string().max(10000),
  kind: z.enum(["text", "upload", "unknown"]).default("text"),
});
export const variationSchema = z.object({ propertyId: externalId, valueId: externalId.nullable(), label: z.string().max(500), value: z.string().max(1000) });
export const listingSchema = z.object({
  externalId, title: z.string().min(1).max(1000), state: z.string().max(40),
  updatedAt: z.number().int().nonnegative(),
  personalization: z.array(z.object({ label: z.string(), required: z.boolean(), type: z.string() })),
});
export const lineSchema = z.object({
  externalId, listingId: externalId, title: z.string().min(1).max(1000),
  quantity: z.number().int().min(1).max(1000), sku: z.string().max(500).nullable(),
  variantKey: z.string().max(2000).default("default"), variations: z.array(variationSchema),
  answers: z.array(answerSchema), digital: z.boolean(),
});
export const orderSchema = z.object({
  externalId, buyerName: z.string().max(500), createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(), paid: z.boolean(), canceled: z.boolean(),
  refund: z.enum(["none", "partial", "full", "unknown"]),
  lines: z.array(lineSchema).min(1).max(1000),
}).superRefine((order, ctx) => {
  if (new Set(order.lines.map(l => l.externalId)).size !== order.lines.length)
    ctx.addIssue({ code: "custom", message: "Duplicate transaction identifiers" });
});
export type ExternalOrder = z.infer<typeof orderSchema>;
export type ExternalListing = z.infer<typeof listingSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type Scope = { userId: string; organizationId: string; storeId: string };
export type InputPolicy = { label: string; minimumLength: number }[];
export function stableJson(value: unknown): string {
  const normalize = (input: unknown): unknown => Array.isArray(input) ? input.map(normalize) : input !== null && typeof input === "object" ? Object.fromEntries(Object.entries(input).sort(([a],[b]) => a.localeCompare(b)).map(([key,entry]) => [key,normalize(entry)])) : input;
  return JSON.stringify(normalize(value));
}
export type IssueCode = "unmapped_listing" | "missing_input" | "unusable_input" | "quantity_context" | "canceled" | "refund_review" | "unpaid" | "not_digital" | "source_changed";
export function validateInputs(answers: Answer[], required: InputPolicy): IssueCode[] {
  if (answers.some(a => a.kind !== "text" || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(a.value))) return ["unusable_input"];
  return required.flatMap(rule => {
    const matches = answers.filter(a => a.label.normalize("NFC") === rule.label.normalize("NFC"));
    if (matches.length > 1) return ["unusable_input" as const];
    if (!matches.length || !matches[0].value.trim()) return ["missing_input" as const];
    return [...matches[0].value.trim()].length < rule.minimumLength ? ["unusable_input" as const] : [];
  });
}
export function triage(order: ExternalOrder, line: ExternalOrder["lines"][number], mapping?: { required: InputPolicy; paused: boolean }, answers = line.answers, allocated = false, sourceChanged = false): string[] {
  const issues: string[] = [];
  if (!order.paid) issues.push("unpaid");
  if (order.canceled) issues.push("canceled");
  if (order.refund !== "none") issues.push("refund_review");
  if (!line.digital) issues.push("not_digital");
  if (!mapping) issues.push("unmapped_listing");
  else { if (mapping.paused) issues.push("mapping_paused"); issues.push(...validateInputs(answers, mapping.required)); }
  if (line.quantity > 1 && !allocated) issues.push("quantity_context");
  if (sourceChanged) issues.push("source_changed");
  return [...new Set(issues)];
}
