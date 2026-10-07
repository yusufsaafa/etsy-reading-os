import sharp from "sharp";
import { resolvedCardSchema, detached } from "../../media/contracts";
import { RESOURCE_LIMITS, RenderResourceError, retainedBytes, sha256, type VerifiedBytes } from "./bytes";
import type { z } from "zod";

export type FrozenAsset=z.infer<typeof resolvedCardSchema.shape.asset>;
export type VerifiedImage=VerifiedBytes & Readonly<{metadata:Readonly<FrozenAsset>}>;
const trustedImages=new WeakSet<object>();
export function isVerifiedImage(value:VerifiedImage){return trustedImages.has(value);}
export function validateImageEvidence(raw:unknown):FrozenAsset {
 const a=resolvedCardSchema.shape.asset.parse(raw);
 if(a.byteSize>RESOURCE_LIMITS.imageBytes || a.width>RESOURCE_LIMITS.imageDimension || a.height>RESOURCE_LIMITS.imageDimension || a.width*a.height>RESOURCE_LIMITS.imagePixels)
  throw new RenderResourceError("IMAGE_RESOURCE_LIMIT");
 return a;
}
/** Strict inspection plus full bounded decode. Returned bytes remain the original unmodified file. */
export async function verifyImageBytes(raw:unknown,input:Uint8Array):Promise<VerifiedImage> {
 const expected=validateImageEvidence(raw);
 if(input.byteLength!==expected.byteSize)throw new RenderResourceError("ASSET_LENGTH_MISMATCH");
 const bytes=Buffer.from(input);
 if(sha256(bytes)!==expected.contentHash)throw new RenderResourceError("ASSET_DIGEST_MISMATCH");
 const actual=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?"image/png":
  bytes[0]===255&&bytes[1]===216&&bytes[2]===255?"image/jpeg":
  bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP"?"image/webp":null;
 if(!actual)throw new RenderResourceError("IMAGE_FORMAT_UNSUPPORTED");
 if(actual!==expected.mediaType)throw new RenderResourceError("IMAGE_MIME_MISMATCH");
 if(actual==="image/png") {
  // Some PNG decoders ignore APNG animation. Reject it explicitly, and bound chunk traversal.
  let offset=8,chunks=0,ended=false;
  while(offset+12<=bytes.length) {
   if(++chunks>10000)throw new RenderResourceError("IMAGE_RESOURCE_LIMIT");
   const length=bytes.readUInt32BE(offset),type=bytes.toString("ascii",offset+4,offset+8);
   if(offset+length+12>bytes.length)throw new RenderResourceError("IMAGE_DECODE_FAILED");
   if(type==="acTL")throw new RenderResourceError("IMAGE_PRESENTATION_UNSUPPORTED");
   offset+=length+12;
   if(type==="IEND"){ended=length===0;break;}
  }
  if(!ended||offset!==bytes.length)throw new RenderResourceError("IMAGE_DECODE_FAILED");
 }
 if(actual==="image/webp"&&bytes.readUInt32LE(4)+8!==bytes.length)throw new RenderResourceError("IMAGE_DECODE_FAILED");
 try {
  const decoder=sharp(bytes,{limitInputPixels:RESOURCE_LIMITS.imagePixels,failOn:"warning",animated:false});
  const metadata=await decoder.metadata();
  if(metadata.format!==actual.slice(6))throw new RenderResourceError("IMAGE_MIME_MISMATCH");
  if((metadata.pages??1)!==1 || (metadata.orientation??1)!==1)throw new RenderResourceError("IMAGE_PRESENTATION_UNSUPPORTED");
  if(metadata.width!==expected.width||metadata.height!==expected.height)throw new RenderResourceError("IMAGE_DIMENSION_MISMATCH");
  // Decode every pixel; metadata-only success cannot bless truncated/corrupt compressed data.
  await decoder.timeout({seconds:10}).toColourspace("srgb").ensureAlpha().raw({depth:"uchar"}).toBuffer();
 }catch(cause){if(cause instanceof RenderResourceError)throw cause;throw new RenderResourceError("IMAGE_DECODE_FAILED",cause);}
 const resource=Object.freeze({metadata:detached(expected),...retainedBytes(bytes)});trustedImages.add(resource);return resource;
}
