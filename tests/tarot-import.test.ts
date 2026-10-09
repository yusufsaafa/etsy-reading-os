import {it,expect} from "vitest";
import {loadBundledDeck,validateBundledDeck,verifyBundledArtwork} from "../src/modules/media/bundled-deck";
import {configuredPlatformAssets,LocalPlatformAssets} from "../src/infrastructure/document-runtime";
import {CANONICAL_CARDS} from "../src/modules/media/catalog";
import {mappingHash} from "../src/modules/media/contracts";
it("all 78 original JPEGs have exact canonical identities, unique hashes and fully decodable evidence",async()=>{
 const p=await loadBundledDeck();expect(p.version.mappings.map(m=>m.cardKey)).toEqual(CANONICAL_CARDS.map(c=>c.key));expect(p.assets).toHaveLength(78);await verifyBundledArtwork(p,configuredPlatformAssets());
});
it.each(["missing","duplicate","wrong-identity","duplicate-artwork","unapproved"])("rejects %s before provisioning",async change=>{
 const p=structuredClone(await loadBundledDeck()) as any;
 if(change==="missing")p.assets.pop();if(change==="duplicate")p.version.mappings[1]={...p.version.mappings[0]};if(change==="wrong-identity")p.source.files[0].cardKey="THE_STAR";if(change==="duplicate-artwork")p.assets[1].contentHash=p.assets[0].contentHash;if(change==="unapproved")p.version.rights.state="UNVERIFIED";
 p.version.mappingHash=mappingHash(p.version.mappings);expect(()=>validateBundledDeck(p)).toThrow();
});
it("corrupt/missing image bytes fail closed without replacement",async()=>{
 const p=await loadBundledDeck();await expect(verifyBundledArtwork(p,{read:async()=>new Uint8Array([0])})).rejects.toThrow();await expect(verifyBundledArtwork(p,{read:async()=>{throw Error("missing");}})).rejects.toThrow();
});
it("asset storage rejects traversal, URLs and invalid bounds",async()=>{
 const storage=new LocalPlatformAssets(process.cwd()+"/resources");for(const objectKey of ["../private.jpeg","platform/../private.jpeg","https://example.test/card.jpeg"])await expect(storage.read({objectKey,maxBytes:1000})).rejects.toThrow();await expect(storage.read({objectKey:"platform/card.jpeg",maxBytes:0})).rejects.toThrow();
});
