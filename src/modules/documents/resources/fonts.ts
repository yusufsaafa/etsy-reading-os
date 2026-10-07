import { open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, sep } from "node:path";
import { create, type Font as ParsedFont } from "fontkit";
import { z } from "zod";
import { fontSchema } from "../layout/measurement";
import { detached, hashSchema } from "../../media/contracts";
import { FONT_PACKAGE_PINS } from "./font-pins";
import { RESOURCE_LIMITS, RenderResourceError, retainedBytes, sha256, type VerifiedBytes } from "./bytes";

export const fontResourceSchema = z.strictObject({
 fontKey: fontSchema, family: z.enum(["Inter", "Source Serif 4"]), style: z.literal("normal"),
 weight: z.union([z.literal(400), z.literal(600), z.literal(700)]), resourceVersion: z.enum(["4.1", "4.005"]),
 filename: z.string().regex(/^[A-Za-z0-9-]+\.ttf$/), upstreamPath: z.string().min(1).max(200),
 byteLength: z.number().int().positive().max(RESOURCE_LIMITS.fontBytes), sha256: hashSchema, format: z.literal("STATIC_TTF"),
});
export const fontPackageSchema = z.strictObject({
 contractVersion: z.literal("controlled-font-package/v1"),
 repository: z.enum(["https://github.com/rsms/inter", "https://github.com/adobe-fonts/source-serif"]),
 releaseTag: z.enum(["v4.1", "4.005R"]), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
 releaseUrl: z.string().max(200), releaseAsset: z.string().max(100), releaseAssetUrl: z.string().max(250),
 archiveSha256: hashSchema, licenseIdentifier: z.literal("OFL-1.1"), licenseFile: z.enum(["LICENSE.txt", "LICENSE.md"]),
 licenseSha256: hashSchema, resources: z.array(fontResourceSchema).length(3),
});
export type FontResourceMetadata = z.infer<typeof fontResourceSchema>;
export type ShapedRun = Readonly<{
 unitsPerEm: number; advance: number; inkLeft: number; inkRight: number;
 glyphs: readonly Readonly<{ id: number; xAdvance: number; yAdvance: number; xOffset: number; yOffset: number }>[];
}>;
export type ControlledFont = VerifiedBytes & Readonly<{
 metadata: Readonly<FontResourceMetadata>; unitsPerEm: number; ascent: number; descent: number;
 shape(text: string): ShapedRun;
}>;
const verified = new WeakSet<object>();
export function isControlledFont(value: ControlledFont) { return verified.has(value); }

// Retained capability: LTR Latin (including Turkish), combining accents and common punctuation.
// Explicitly exclude bidi controls, emoji, RTL/complex scripts, unpaired surrogates and host fallback.
export function assertLatinCapability(text: string) {
 if (text.length > 40000) throw new RenderResourceError("TEXT_RESOURCE_LIMIT");
 let base = false;
 for (const c of text) {
  const cp = c.codePointAt(0)!;
  const mark = cp >= 0x300 && cp <= 0x36f;
  const latin = /\p{Script=Latin}/u.test(c) && cp <= 0x1eff;
  const common = (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xbf) ||
   [0x2010,0x2011,0x2012,0x2013,0x2014,0x2018,0x2019,0x201a,0x201c,0x201d,0x201e,0x2022,0x2026,0x20ac,0x2122].includes(cp);
  if (!(latin || common || mark || c === "\n" || c === "\r" || c === "\t") || (mark && !base))
   throw new RenderResourceError("SHAPING_CAPABILITY_UNAVAILABLE");
  if (!mark) base = latin;
 }
}
/** Pin enforcement is separate from parsing; no caller can bless arbitrary bytes as production. */
export function verifyFontBytes(raw: unknown, bytes: Uint8Array) {
 const meta = fontResourceSchema.parse(raw);
 if (bytes.byteLength !== meta.byteLength) throw new RenderResourceError("FONT_LENGTH_MISMATCH");
 if (sha256(bytes) !== meta.sha256) throw new RenderResourceError("FONT_DIGEST_MISMATCH");
 return meta;
}
function controlledFont(meta: FontResourceMetadata, bytes: Uint8Array): ControlledFont {
 verifyFontBytes(meta, bytes);
 let font: ParsedFont;
 try {
  const parsed = create(Buffer.from(bytes));
  if (!("layout" in parsed)) throw new Error("collection");
  font = parsed;
  if (Object.keys(font.variationAxes).length || font.postscriptName !== meta.filename.slice(0,-4) || font.italicAngle !== 0 ||
   (font as unknown as { "OS/2": { usWeightClass: number } })["OS/2"].usWeightClass !== meta.weight)
   throw new Error("font identity/style mismatch");
 } catch (cause) { throw new RenderResourceError("FONT_FORMAT_OR_IDENTITY", cause); }
 const value: ControlledFont = Object.freeze({
  metadata: detached(meta), unitsPerEm: font.unitsPerEm,
  // Use the retained font's global ink bounds, not guessed character classes/host line metrics.
  ascent: Math.max(font.ascent, font.bbox.maxY), descent: Math.min(font.descent, font.bbox.minY),
  ...retainedBytes(bytes),
  shape(text: string): ShapedRun {
   assertLatinCapability(text);
   // CR/LF carry exact text offsets but no glyph; TAB is exactly four space advances.
   const printable = text.replace(/[\r\n]/g, "").replace(/\t/g, "    ");
   for (const c of printable) if (!font.hasGlyphForCodePoint(c.codePointAt(0)!)) throw new RenderResourceError("FONT_GLYPH_UNAVAILABLE");
   const run = font.layout(printable, { kern: true, liga: true, clig: true, mark: true, mkmk: true }, "latn", "dflt", "ltr");
   let x = 0, left = 0, right = 0;
   for (const [i,glyph] of run.glyphs.entries()) {
    if (glyph.id === 0) throw new RenderResourceError("FONT_GLYPH_UNAVAILABLE");
   const p = run.positions[i];
    if(p.yOffset+glyph.bbox.maxY>Math.max(font.ascent,font.bbox.maxY) || p.yOffset+glyph.bbox.minY<Math.min(font.descent,font.bbox.minY))
     throw new RenderResourceError("TEXT_INK_OUT_OF_BOUNDS");
    left = Math.min(left, x + p.xOffset + glyph.bbox.minX);
    right = Math.max(right, x + p.xOffset + glyph.bbox.maxX);
    x += p.xAdvance;
   }
   return detached({ unitsPerEm: font.unitsPerEm, advance: x, inkLeft: left, inkRight: Math.max(x,right),
    glyphs: run.glyphs.map((g,i) => ({ id:g.id, ...run.positions[i] })) });
  },
 });
 verified.add(value); return value;
}
async function boundedLocalFile(root: string, path: string, max: number) {
 try {
  const actual = await realpath(resolve(root,path));
  if (!actual.startsWith(root + sep)) throw new RenderResourceError("FONT_PATH_UNAVAILABLE");
  const file=await open(actual,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
   const info=await file.stat();
   if(!info.isFile()||info.size>max)throw new RenderResourceError("FONT_RESOURCE_LIMIT");
   const buffer=Buffer.alloc(max+1);let length=0;
   while(length<buffer.length){const result=await file.read(buffer,length,buffer.length-length,null);if(!result.bytesRead)break;length+=result.bytesRead;}
   if(length>max)throw new RenderResourceError("FONT_RESOURCE_LIMIT");
   return buffer.subarray(0,length);
  }finally{await file.close();}
 } catch(cause) { if (cause instanceof RenderResourceError) throw cause; throw new RenderResourceError("FONT_RESOURCE_MISSING"); }
}
export type FontRegistry = Readonly<{ resolve(raw: unknown): ControlledFont; resources: readonly ControlledFont[] }>;
/** No path parameter: deployed resources are resolved from fixed repository-owned packages. */
export async function loadControlledFonts(): Promise<FontRegistry> {
 let root:string;
 try{root=await realpath(resolve(process.cwd(),"resources/fonts"));}catch{throw new RenderResourceError("FONT_RESOURCE_MISSING");}
 const resources: ControlledFont[] = [];
 for (const pin of FONT_PACKAGE_PINS) {
  const bytes = await boundedLocalFile(root, pin.package + "/provenance.json", 20000);
  if (sha256(bytes) !== pin.manifestSha256) throw new RenderResourceError("FONT_MANIFEST_DIGEST_MISMATCH");
  const manifest = fontPackageSchema.parse(JSON.parse(bytes.toString("utf8")));
  const license = await boundedLocalFile(root,pin.package + "/" + manifest.licenseFile,20000);
  if (sha256(license) !== manifest.licenseSha256) throw new RenderResourceError("FONT_LICENSE_DIGEST_MISMATCH");
  for (const meta of manifest.resources) resources.push(controlledFont(meta,await boundedLocalFile(root,pin.package + "/" + meta.filename,RESOURCE_LIMITS.fontBytes)));
 }
 return Object.freeze({ resources: Object.freeze(resources), resolve(raw: unknown) {
  const input = z.strictObject({font:fontSchema,style:z.literal("normal"),weight:z.union([z.literal(400),z.literal(600),z.literal(700)])}).parse(raw);
  const result = resources.find(r=>r.metadata.fontKey===input.font && r.metadata.weight===input.weight && r.metadata.style===input.style);
  if (!result) throw new RenderResourceError("FONT_RESOURCE_MISSING"); return result;
 } });
}
