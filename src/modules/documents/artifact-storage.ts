import type { ImmutableArtifactStorage } from "../../infrastructure/object-storage";
import { ArtifactStorageError } from "../../infrastructure/object-storage";
import { sha256 } from "./resources/bytes";
import type { DocumentArtifact } from "./artifact-contract";
/** Full bounded read/hash is authoritative, not adapter-provided digest metadata. */
export async function readArtifactBytes(storage:ImmutableArtifactStorage,artifact:DocumentArtifact){
 const result=await storage.read({organizationId:artifact.organizationId,objectKey:artifact.objectKey,maxBytes:artifact.byteLength});
 if(result.objectKey!==artifact.objectKey||result.contentType!=="application/pdf"||result.bytes.length!==artifact.byteLength||sha256(result.bytes)!==artifact.sha256)
  throw new ArtifactStorageError("INTEGRITY");
 return Uint8Array.from(result.bytes);
}
