import sharp from "sharp";
import { layoutFixture } from "./layout.fixture";
import { documentMediaHash,immutableRenderInput } from "../src/modules/documents/media-contract";
import { sha256 } from "../src/modules/documents/resources/bytes";
/** Flat solid-colour rectangle, deliberately not tarot artwork. Generated without network. */
export async function syntheticImage(format:"png"|"jpeg"|"webp"="png") {
 return sharp({create:{width:60,height:100,channels:3,background:{r:255,g:0,b:255}}}).toFormat(format).toBuffer();
}
export async function resourcesFixture(count=3,template="mystic",bodies?:string[]) {
 const bytes=await syntheticImage(),raw=layoutFixture(template,count,bodies);
 if(raw.media.media.mode==="TAROT_CARDS")for(const card of raw.media.media.cards)Object.assign(card.asset,{byteSize:bytes.length,contentHash:sha256(bytes),width:60,height:100});
 raw.media.mediaHash=documentMediaHash(raw.media.media);
 return {bytes,input:immutableRenderInput(raw.snapshot,raw.media)};
}
