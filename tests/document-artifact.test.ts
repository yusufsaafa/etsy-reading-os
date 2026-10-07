import { it,expect } from "vitest";
import { randomUUID } from "node:crypto";
import { artifactSchema,artifactObjectKey } from "../src/modules/documents/artifact-contract";
import { readArtifactBytes } from "../src/modules/documents/artifact-storage";
import { sha256 } from "../src/modules/documents/resources/bytes";
import { documentFailure } from "../src/modules/production/documents";
import { ArtifactStorageError } from "../src/infrastructure/object-storage";
import { MemoryArtifactStorage } from "./artifact-storage.fixture";
function artifact(){const value={contractVersion:"document-artifact/v1" as const,id:randomUUID(),organizationId:randomUUID(),storeId:randomUUID(),orderId:randomUUID(),readingId:randomUUID(),documentSnapshotId:randomUUID(),mediaSnapshotId:randomUUID(),rendererVersion:"reading-pdf/1" as const,layoutHash:"a".repeat(64),resourceHash:"b".repeat(64),sha256:sha256(new Uint8Array([1,2,3])),byteLength:3,pageCount:2,contentType:"application/pdf" as const,state:"AVAILABLE" as const,createdAt:"2026-10-07T00:00:00.000Z",availableAt:"2026-10-07T00:00:01.000Z"};return {...value,objectKey:artifactObjectKey(value)};}
it("strict owned artifact contract and immutable input-derived key",()=>{const a=artifact();expect(artifactSchema.parse(a)).toEqual(a);expect(a.objectKey).toContain(a.organizationId+"/"+a.storeId);});
it.each([{sha256:"xyz"},{contentType:"text/plain"},{byteLength:0},{byteLength:134217729},{pageCount:0},{pageCount:1001},{url:"https://evil.invalid"},{storeId:randomUUID()},{objectKey:"../x"},{availableAt:null},{availableAt:"2026-10-06T00:00:00.000Z"}])("rejects invalid artifact %j",change=>{expect(()=>artifactSchema.parse({...artifact(),...change})).toThrow();});
it("conditional immutable write idempotency/conflict and bounded detached reads",async()=>{
 const a=artifact(),storage=new MemoryArtifactStorage(),bytes=new Uint8Array([1,2,3]),v={...a,bytes};await storage.putImmutable(v);await storage.putImmutable(v);expect(storage.objects.size).toBe(1);
 await expect(storage.putImmutable({...v,bytes:new Uint8Array([3,2,1]),sha256:sha256(new Uint8Array([3,2,1]))})).rejects.toThrow("CONFLICT");
 const copy=await readArtifactBytes(storage,a);copy.fill(0);expect(await readArtifactBytes(storage,a)).toEqual(bytes);
 await expect(storage.read({...a,maxBytes:2})).rejects.toThrow("LIMIT");
 await expect(storage.read({...a,objectKey:a.objectKey+"missing",maxBytes:3})).rejects.toThrow("MISSING");
});
it.each(["length","sha","mime","key"])("full read rejects %s mismatch",async change=>{
 const a=artifact(),storage=new MemoryArtifactStorage();await storage.putImmutable({...a,bytes:new Uint8Array([1,2,3])});const v=storage.objects.get(a.objectKey)!;
 if(change==="length")v.bytes=new Uint8Array([1]);if(change==="sha")v.bytes[0]=9;if(change==="mime")v.contentType="text/plain";if(change==="key")v.objectKey="wrong";
 await expect(readArtifactBytes(storage,a)).rejects.toThrow("INTEGRITY");
});
it("failure policy retries only safe storage transport/missing, never evidence conflicts",()=>{
 expect(documentFailure(new ArtifactStorageError("UNAVAILABLE"))).toEqual({code:"STORAGE_UNAVAILABLE",retryable:true});
 expect(documentFailure(new ArtifactStorageError("MISSING")).retryable).toBe(true);
 for(const code of ["CONFLICT","INTEGRITY","LIMIT"] as const)expect(documentFailure(new ArtifactStorageError(code)).retryable).toBe(false);
 expect(documentFailure(new Error("FONT_RESOURCE_MISSING")).retryable).toBe(false);expect(documentFailure(new Error("DOCUMENT_DESIGN_SETUP_REQUIRED")).code).toBe("SETUP_REQUIRED");
});
