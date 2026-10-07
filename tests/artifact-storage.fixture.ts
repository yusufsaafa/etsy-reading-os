import type { ImmutableArtifactStorage } from "../src/infrastructure/object-storage";
import { ArtifactStorageError } from "../src/infrastructure/object-storage";
import { sha256 } from "../src/modules/documents/resources/bytes";
/** Test double only. Production conditional creation must be accepted separately. */
export class MemoryArtifactStorage implements ImmutableArtifactStorage{
 objects=new Map<string,{objectKey:string;contentType:string;bytes:Uint8Array}>();writes=0;reads=0;
 failBefore=false;loseWriteResponse=false;
 async putImmutable(v:Parameters<ImmutableArtifactStorage["putImmutable"]>[0]){
  this.writes++;if(this.failBefore)throw new ArtifactStorageError("UNAVAILABLE");
  if(v.bytes.length!==v.byteLength||sha256(v.bytes)!==v.sha256||v.contentType!=="application/pdf")throw new ArtifactStorageError("INTEGRITY");
  if(!v.objectKey.startsWith(`private/documents/v1/${v.organizationId}/`))throw new ArtifactStorageError("INTEGRITY");
  const old=this.objects.get(v.objectKey);
  if(old&&(old.contentType!==v.contentType||old.bytes.length!==v.byteLength||sha256(old.bytes)!==v.sha256))throw new ArtifactStorageError("CONFLICT");
  if(!old)this.objects.set(v.objectKey,{objectKey:v.objectKey,contentType:v.contentType,bytes:Uint8Array.from(v.bytes)});
  if(this.loseWriteResponse)throw new ArtifactStorageError("UNAVAILABLE");
 }
 async read(v:Parameters<ImmutableArtifactStorage["read"]>[0]){
  this.reads++;if(!v.objectKey.startsWith(`private/documents/v1/${v.organizationId}/`))throw new ArtifactStorageError("INTEGRITY");
  const object=this.objects.get(v.objectKey);if(!object)throw new ArtifactStorageError("MISSING");
  if(object.bytes.length>v.maxBytes)throw new ArtifactStorageError("LIMIT");
  return {...object,bytes:Uint8Array.from(object.bytes)};
 }
}
