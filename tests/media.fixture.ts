import { randomUUID, createHash } from "node:crypto";
import { CANONICAL_CARDS } from "../src/modules/media/catalog";
import { mappingHash } from "../src/modules/media/contracts";
export const bytes=Uint8Array.from([137,80,78,71,1,2,3]); // synthetic integrity bytes, not real artwork or a renderable fixture
export function rights() {return {state:"APPROVED" as const,classification:"PLATFORM_ORIGINAL" as const,source:"Synthetic test fixture",evidenceReference:"fixture-only-no-commercial-license",notes:"Not real artwork. Test authorization only."};}
export function assetFixture() {const id=randomUUID();return {id,kind:"TAROT_CARD_IMAGE" as const,objectKey:`platform/fixtures/${id}.png`,mediaType:"image/png" as const,byteSize:bytes.length,contentHash:createHash("sha256").update(bytes).digest("hex"),width:600,height:1000,status:"READY" as const,rights:rights(),createdAt:"2026-10-06T00:00:00.000Z"};}
export function deckFixture(assetId:string,deckKey="synthetic",version=1) {const mappings=CANONICAL_CARDS.map(c=>({cardKey:c.key,assetId}));return {deckKey,version,status:"PUBLISHED" as const,rights:rights(),mappings,mappingHash:mappingHash(mappings),createdAt:"2026-10-06T00:00:00.000Z"};}
