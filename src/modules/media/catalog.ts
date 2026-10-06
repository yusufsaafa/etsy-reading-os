import { z } from "zod";
export const orientationSchema = z.enum(["UPRIGHT", "REVERSED"]);
export type CardOrientation = z.infer<typeof orientationSchema>;
const majors = ["THE_FOOL", "THE_MAGICIAN", "THE_HIGH_PRIESTESS", "THE_EMPRESS", "THE_EMPEROR", "THE_HIEROPHANT", "THE_LOVERS", "THE_CHARIOT", "STRENGTH", "THE_HERMIT", "WHEEL_OF_FORTUNE", "JUSTICE", "THE_HANGED_MAN", "DEATH", "TEMPERANCE", "THE_DEVIL", "THE_TOWER", "THE_STAR", "THE_MOON", "THE_SUN", "JUDGEMENT", "THE_WORLD"] as const;
export const SUITS = Object.freeze(["WANDS", "CUPS", "SWORDS", "PENTACLES"] as const);
export const RANKS = Object.freeze(["ACE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "PAGE", "KNIGHT", "QUEEN", "KING"] as const);
export type CardKey = typeof majors[number] | `${typeof RANKS[number]}_OF_${typeof SUITS[number]}`;
export type CanonicalCard = Readonly<{key:CardKey; arcana:"MAJOR"; order:number; label:string; suit:null; rank:null}> | Readonly<{key:CardKey; arcana:"MINOR"; order:number; label:string; suit:typeof SUITS[number]; rank:typeof RANKS[number]}>;
function title(text:string) { return text.toLowerCase().replace(/(^|_)([a-z])/g,(_,sep:string,char:string)=>(sep ? " " : "")+char.toUpperCase()); }
/** Stable v1 order: Major 0–21 (Strength 8, Justice 11), then suits/ranks above. */
export const CANONICAL_CARDS:readonly CanonicalCard[] = Object.freeze([
 ...majors.map((key,order)=>Object.freeze({key,arcana:"MAJOR" as const,order,label:title(key),suit:null,rank:null})),
 ...SUITS.flatMap((suit,s)=>RANKS.map((rank,r)=>Object.freeze({key:`${rank}_OF_${suit}` as CardKey,arcana:"MINOR" as const,order:22+s*14+r,label:`${title(rank)} of ${title(suit)}`,suit,rank}))),
]);
const catalog = new Map(CANONICAL_CARDS.map(card=>[card.key,card]));
export const cardKeySchema = z.string().refine((key):key is CardKey=>catalog.has(key as CardKey),"Unsupported canonical card").transform(key=>key as CardKey);
export function getCanonicalCard(raw:unknown):CanonicalCard { return Object.freeze({...catalog.get(cardKeySchema.parse(raw))!}); }
export function validateCanonicalCard(raw:unknown):CanonicalCard {
 const parsed=z.strictObject({key:cardKeySchema,arcana:z.enum(["MAJOR","MINOR"]),order:z.number().int(),label:z.string(),suit:z.enum(SUITS).nullable(),rank:z.enum(RANKS).nullable()}).parse(raw);
 const card=getCanonicalCard(parsed.key);
 if(Object.keys(card).some(key=>card[key as keyof CanonicalCard]!==parsed[key as keyof typeof parsed]))throw new Error("INVALID_CANONICAL_CARD");
 return card;
}
