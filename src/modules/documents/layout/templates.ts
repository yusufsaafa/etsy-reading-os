import { z } from "zod";
import { detached } from "../../media/contracts";
export const A4=Object.freeze({width:595276,height:841890}); // round(mm * 72 / 25.4 * 1000)
export const templateDefinitionSchema=z.strictObject({
 key:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),version:z.literal(1),
 family:z.enum(["CLASSIC_IVORY","MYSTIC_PARCHMENT","MINIMAL","MODERN","LUXURY_EDITORIAL","TAROT_ATELIER"]),
 margin:z.number().int().min(51024).max(62362),footerZone:z.literal(34016),
 bodySize:z.number().int().min(10500).max(11500),lineHeight:z.number().int().min(14000).max(18000),
 headingSize:z.number().int().min(22000).max(30000),displaySize:z.number().int().min(42000).max(64000),
 gap:z.number().int().min(10000).max(24000),inset:z.number().int().min(0).max(36000),
 background:z.enum(["IVORY","PARCHMENT","WHITE"]),frame:z.enum(["NONE","ANTIQUE","RULE"]),
 ornament:z.enum(["NONE","CELESTIAL","EDITORIAL"]),columns:z.number().int().min(2).max(3),
 cardHeight:z.number().int().min(190000).max(280000),continuation:z.boolean(),
});
export type LayoutTemplate=ReturnType<typeof templateDefinitionSchema.parse>;
const base={version:1 as const,margin:56693,footerZone:34016 as const,bodySize:11000,lineHeight:16000,headingSize:26000,displaySize:48000,gap:16000,inset:0,background:"IVORY" as const,frame:"RULE" as const,ornament:"NONE" as const,columns:3,cardHeight:210000,continuation:true};
/** Independent retained layout-definition version, never replaces the historical design registry. */
export const LAYOUT_TEMPLATES=detached(Object.fromEntries([
 {...base,key:"classic",family:"CLASSIC_IVORY"},
 {...base,key:"mystic",family:"MYSTIC_PARCHMENT",background:"PARCHMENT",frame:"ANTIQUE",ornament:"CELESTIAL"},
 {...base,key:"minimal",family:"MINIMAL",margin:62362,background:"WHITE",frame:"NONE",headingSize:22000,gap:20000},
 {...base,key:"modern",family:"MODERN",background:"WHITE",headingSize:28000},
 {...base,key:"luxury-editorial",family:"LUXURY_EDITORIAL",displaySize:64000,inset:28000,ornament:"EDITORIAL",headingSize:30000,gap:22000},
 {...base,key:"tarot-atelier",family:"TAROT_ATELIER",columns:2,cardHeight:270000,background:"WHITE",gap:20000},
].map(raw=>{const t=templateDefinitionSchema.parse(raw);return [t.key,t];}))) as Readonly<Record<string,Readonly<LayoutTemplate>>>;
export function layoutTemplate(key:string,version:number):Readonly<LayoutTemplate> {
 if(version!==1||!Object.hasOwn(LAYOUT_TEMPLATES,key))throw new Error("UNSUPPORTED_LAYOUT_TEMPLATE");
 return LAYOUT_TEMPLATES[key];
}
