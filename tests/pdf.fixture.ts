import sharp from "sharp";
import { layoutFixture } from "./layout.fixture";
import { documentMediaHash, immutableRenderInput } from "../src/modules/documents/media-contract";
import { composeDocumentLayout } from "../src/modules/documents/layout/engine";
import { loadControlledFonts } from "../src/modules/documents/resources/fonts";
import { productionMeasurement } from "../src/modules/documents/resources/measurement";
import { prepareLayoutResources } from "../src/modules/documents/resources/bundle";
import { sha256 } from "../src/modules/documents/resources/bytes";
import { configurationHash } from "../src/modules/documents/contracts";
import { documentSnapshotHash } from "../src/modules/documents/snapshot-contract";

/** Red top / blue bottom proves reversal visibly; no artwork or rights claims. */
export async function pdfFixture(count=3,template="mystic",format:"png"|"jpeg"|"webp"="png",bodies?:string[],imagery=true,footerText?:string){
 const pixels=Buffer.alloc(60*100*3);
 for(let y=0;y<100;y++)for(let x=0;x<60;x++){const i=(y*60+x)*3;pixels[i]=y<50?230:20;pixels[i+1]=40;pixels[i+2]=y<50?20:230;}
 const bytes=await sharp(pixels,{raw:{width:60,height:100,channels:3}}).toFormat(format).toBuffer();
 const raw=layoutFixture(template,count,bodies);
 const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
 raw.snapshot.id=id(1);raw.snapshot.organizationId=raw.media.organizationId=id(2);raw.snapshot.storeId=raw.media.storeId=id(3);
 raw.snapshot.reading.readingId=raw.media.readingId=id(4);raw.snapshot.reading.order.id=id(5);raw.snapshot.reading.product.id=id(6);raw.snapshot.design.id=id(7);
 raw.snapshot.provenance.reviewId=raw.media.provenance.reviewId=id(8);raw.snapshot.provenance.generationId=raw.media.provenance.generationId=id(9);
 raw.media.id=id(10);raw.media.documentSnapshotId=raw.snapshot.id;
 if(raw.media.media.mode==="TAROT_CARDS")for(const card of raw.media.media.cards)Object.assign(card.asset,{id:id(20+card.position),mediaType:`image/${format}`,byteSize:bytes.length,contentHash:sha256(bytes),width:60,height:100});
 // Resolve using the supported design flag through the actual immutable input parser.
 if(!imagery||footerText!==undefined){
  if(!imagery)raw.snapshot.design.configuration.display.cardImagery=false;
  if(footerText!==undefined)raw.snapshot.design.configuration.footerText=footerText;
  raw.snapshot.design.configurationHash=configurationHash(raw.snapshot.design.configuration);raw.snapshot.snapshotHash=documentSnapshotHash(raw.snapshot);
 }
 raw.snapshot.snapshotHash=documentSnapshotHash(raw.snapshot);
 raw.media.mediaHash=documentMediaHash(raw.media.media);
 const input=immutableRenderInput(raw.snapshot,raw.media),measurement=productionMeasurement(await loadControlledFonts());
 const layout=composeDocumentLayout(input,measurement);
 let reads=0;
 const resources=await prepareLayoutResources(input,layout,measurement,async()=>{reads++;return bytes;});
 return {input,layout,resources,measurement,reads,bytes};
}
