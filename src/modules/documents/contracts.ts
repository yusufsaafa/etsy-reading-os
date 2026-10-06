import { z } from "zod";
import { createHash } from "node:crypto";
import { stableJson } from "../intake/contracts";

// Historical definitions are retained independently of current template selection.
export const DOCUMENT_TEMPLATE_VERSIONS = Object.freeze({
  classic: Object.freeze({1:Object.freeze({ name: "Classic", contractVersion: "document-template/v1", version: 1, cardImagery: true })}),
  mystic: Object.freeze({1:Object.freeze({ name: "Mystic", contractVersion: "document-template/v1", version: 1, cardImagery: true })}),
  minimal: Object.freeze({1:Object.freeze({ name: "Minimal", contractVersion: "document-template/v1", version: 1, cardImagery: false })}),
  modern: Object.freeze({1:Object.freeze({ name: "Modern", contractVersion: "document-template/v1", version: 1, cardImagery: false })}),
});
export const DOCUMENT_TEMPLATES = Object.freeze({
  classic:DOCUMENT_TEMPLATE_VERSIONS.classic[1], mystic:DOCUMENT_TEMPLATE_VERSIONS.mystic[1],
  minimal:DOCUMENT_TEMPLATE_VERSIONS.minimal[1], modern:DOCUMENT_TEMPLATE_VERSIONS.modern[1],
});
// Stable keys only; controlled font assets and rendering are deferred.
export const DOCUMENT_FONTS = Object.freeze({ inter: "Inter", "source-serif-4": "Source Serif 4" });
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(v => v.toUpperCase());
const plain = (max: number) => z.string().max(max).refine(v => !/[<>]/.test(v), "Plain text only");
export const documentDesignSchema = z.strictObject({
  contractVersion: z.literal("document-design/v1"),
  template: z.enum(["classic", "mystic", "minimal", "modern"]),
  brand: z.strictObject({ name: plain(120), primaryColor: color, accentColor: color }),
  typography: z.strictObject({ heading: z.enum(["inter", "source-serif-4"]), body: z.enum(["inter", "source-serif-4"]) }),
  cover: z.enum(["SIMPLE", "BRAND"]),
  display: z.strictObject({ customerName: z.boolean(), readingDate: z.boolean(), sectionDividers: z.boolean(), cardImagery: z.boolean(), footer: z.boolean() }),
  footerText: plain(500),
}).refine(v => !v.display.cardImagery || DOCUMENT_TEMPLATE_VERSIONS[v.template][1].cardImagery, "Template does not support card imagery")
  .refine(v => Buffer.byteLength(stableJson(v), "utf8") <= 8192, "Configuration too large");
export type DocumentDesignConfiguration = z.infer<typeof documentDesignSchema>;
export const designWriteSchema = z.strictObject({ name: plain(100).refine(v => v.trim().length > 0), configuration: documentDesignSchema });
export const resolvedDocumentDesignSchema = z.strictObject({
  contractVersion: z.literal("resolved-document-design/v1"), organizationId: z.uuid(), storeId: z.uuid(), productId: z.uuid(),
  designId: z.uuid(), revision: z.number().int().nonnegative(), name: z.string().min(1).max(100),
  source: z.enum(["PRODUCT", "STORE_DEFAULT"]), templateVersion: z.literal(1), configuration: documentDesignSchema,
  configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
});
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type ResolvedDocumentDesign = DeepReadonly<z.infer<typeof resolvedDocumentDesignSchema>>;
export function configurationHash(configuration: DocumentDesignConfiguration) { return createHash("sha256").update(stableJson(configuration)).digest("hex"); }
export function immutableResolvedDesign(value: unknown): ResolvedDocumentDesign {
  const parsed = resolvedDocumentDesignSchema.parse(value);
  if (configurationHash(parsed.configuration) !== parsed.configurationHash) throw new Error("DOCUMENT_DESIGN_UNAVAILABLE");
  function freeze(value: object) { for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child); Object.freeze(value); }
  freeze(parsed); return parsed;
}
