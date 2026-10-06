import { expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { CANONICAL_CARDS, SUITS, RANKS, getCanonicalCard, validateCanonicalCard, orientationSchema } from "../src/modules/media/catalog";
import { validateAsset, validateDeckVersion, mappingHash, preferenceCommandSchema } from "../src/modules/media/contracts";
import { assetFixture, deckFixture } from "./media.fixture";
it("canonical v1 catalog is exactly 78, unique, ordered, frozen and deterministic",()=>{
 expect(CANONICAL_CARDS).toHaveLength(78);expect(new Set(CANONICAL_CARDS.map(c=>c.key)).size).toBe(78);
 expect(CANONICAL_CARDS.map(c=>c.order)).toEqual(Array.from({length:78},(_,i)=>i));expect(CANONICAL_CARDS[0].key).toBe("THE_FOOL");expect(CANONICAL_CARDS[21].key).toBe("THE_WORLD");expect(CANONICAL_CARDS[77].key).toBe("KING_OF_PENTACLES");
 expect(Object.isFrozen(CANONICAL_CARDS)).toBe(true);expect(getCanonicalCard("THE_FOOL")).not.toBe(CANONICAL_CARDS[0]);
 for(const card of CANONICAL_CARDS) {expect(validateCanonicalCard(card)).toEqual(card);expect(Object.isFrozen(card)).toBe(true);if(card.arcana==="MAJOR"){expect(card.suit).toBeNull();expect(card.rank).toBeNull();}else {expect(SUITS).toContain(card.suit);expect(RANKS).toContain(card.rank);}}
 for(const key of ["The Lovers","the_lovers","__proto__","NO_CARD",null])expect(()=>getCanonicalCard(key)).toThrow();
 for(const field of ["arcana","suit","rank","order","label"])expect(()=>validateCanonicalCard({...CANONICAL_CARDS[0],[field]:"wrong"})).toThrow();
 expect(orientationSchema.parse("UPRIGHT")).toBe("UPRIGHT");expect(orientationSchema.parse("REVERSED")).toBe("REVERSED");expect(orientationSchema.safeParse("upright").success).toBe(false);
});
it("trusted bounded raster asset is detached and deeply frozen",()=>{const raw=assetFixture(),value=validateAsset(raw);raw.rights.source="changed";expect(value.rights.source).toBe("Synthetic test fixture");expect(Object.isFrozen(value.rights)).toBe(true);});
it.each([
 {contentHash:"bad"},{mediaType:"image/svg+xml"},{mediaType:"text/html"},{width:0},{height:-1},{width:16385},{width:16384,height:16384},{byteSize:0},{byteSize:1.5},{byteSize:26214401},{objectKey:"https://example.invalid/a.png"},{objectKey:"data:image/png;base64,test"},{objectKey:"platform/../a.png"},{objectKey:"platform//a.png"},{kind:"LOGO"},{status:"fake"},{url:"https://example.invalid"},{provider:"google"},{customerName:"Synthetic"},
])("rejects malformed/untrusted asset %j",change=>{expect(()=>validateAsset({...assetFixture(),...change})).toThrow("MEDIA_UNAVAILABLE");});
it("complete approved deck maps canonical identity independently of artwork and orientation",()=>{
 const a=assetFixture(),d=deckFixture(a.id),v=validateDeckVersion(d,[a]);expect(v.mappings).toHaveLength(78);expect(Object.isFrozen(v.mappings[0])).toBe(true);d.mappings[0].assetId=randomUUID();expect(v.mappings[0].assetId).toBe(a.id);expect(v).not.toHaveProperty("orientation");
});
it.each(["77","79","duplicate","unknown","missing","unavailable","asset-rights","deck-rights","hash","dimensions","kind","evidence","draft"])("fails closed for %s deck",change=>{
 const a=assetFixture(),d:Record<string,any>=deckFixture(a.id);
 if(change==="77")d.mappings.pop();if(change==="79")d.mappings.push({...d.mappings[0]});if(change==="duplicate")d.mappings[1]={...d.mappings[0]};if(change==="unknown")d.mappings[0].cardKey="FAKE";if(change==="missing")d.mappings[0].assetId=randomUUID();if(change==="unavailable")a.status="UNAVAILABLE" as never;if(change==="asset-rights")a.rights.state="UNVERIFIED" as never;if(change==="deck-rights")d.rights.state="RESTRICTED";if(change==="dimensions")a.width=0;if(change==="kind")a.kind="LOGO" as never;if(change==="evidence")d.rights.evidenceReference=null;if(change==="draft")d.status="DRAFT";
 d.mappingHash=change==="hash" ? "0".repeat(64) : mappingHash(d.mappings);expect(()=>validateDeckVersion(d,[a])).toThrow("MEDIA_UNAVAILABLE");
});
it("retired versions resolve only explicitly historical and preference commands cannot smuggle ownership/media",()=>{
 const a=assetFixture(),d={...deckFixture(a.id),status:"RETIRED"};expect(()=>validateDeckVersion(d,[a])).toThrow();expect(validateDeckVersion(d,[a],true).status).toBe("RETIRED");
 for(const key of ["storeId","organizationId","assetId","url","rights","mappings","provider","sections"])expect(preferenceCommandSchema.safeParse({deckKey:"synthetic",deckVersion:1,expectedRevision:0,[key]:"forged"}).success).toBe(false);
});
