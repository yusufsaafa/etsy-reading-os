import {it,expect,beforeEach,afterEach} from "vitest";
import {mkdtemp,realpath,rm,readdir,chmod,symlink,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {LocalArtifactStorage} from "../src/infrastructure/local-artifact-storage";
import {localDocumentStorageReadiness,configuredDocumentPorts} from "../src/infrastructure/document-runtime";
import {artifactObjectKey} from "../src/modules/documents/artifact-contract";
let root:string,storage:LocalArtifactStorage;
const bytes=Uint8Array.from(Buffer.from("%PDF-synthetic-test-data"));
function input(){const organizationId=randomUUID(),sha256=createHash("sha256").update(bytes).digest("hex");return {organizationId,objectKey:artifactObjectKey({organizationId,storeId:randomUUID(),readingId:randomUUID(),mediaSnapshotId:randomUUID(),rendererVersion:"reading-pdf/1",sha256}),bytes,contentType:"application/pdf" as const,sha256,byteLength:bytes.length};}
beforeEach(async()=>{root=await realpath(await mkdtemp(join(tmpdir(),"reading-storage-")));storage=new LocalArtifactStorage(root);});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
it("private atomic upload and exact bounded read are replay/concurrency safe",async()=>{
 const data=input();await Promise.all([storage.putImmutable(data),storage.putImmutable(data),storage.putImmutable(data)]);
 const result=await storage.read({...data,maxBytes:bytes.length});expect(result.bytes).toEqual(bytes);expect(result.contentType).toBe("application/pdf");
 const files=await readdir(root);expect(files).toHaveLength(1);expect(files[0]).toMatch(/^[a-f0-9]{64}\.artifact$/);expect(files[0]).not.toContain(data.organizationId);
 result.bytes.fill(0);expect((await storage.read({...data,maxBytes:bytes.length})).bytes).toEqual(bytes);
});
it("cross-organization, traversal, malformed identities and arbitrary keys fail closed",async()=>{
 const data=input();await storage.putImmutable(data);
 for(const objectKey of ["../secret",data.objectKey+"/../",data.objectKey.replace("reading-pdf-1","unknown"),"private/documents/v1/arbitrary.pdf"]){await expect(storage.read({...data,objectKey,maxBytes:100})).rejects.toThrow("INTEGRITY");}
 await expect(storage.read({...data,organizationId:randomUUID(),maxBytes:100})).rejects.toThrow("INTEGRITY");
});
it("missing object, bounded size and tampered bytes are controlled failures",async()=>{
 const data=input();await expect(storage.read({...data,maxBytes:100})).rejects.toThrow("MISSING");await storage.putImmutable(data);
 await expect(storage.read({...data,maxBytes:1})).rejects.toThrow();await expect(storage.read({...data,maxBytes:Infinity})).rejects.toThrow("LIMIT");
 const file=(await readdir(root))[0];await writeFile(join(root,file),"bad");await expect(storage.read({...data,maxBytes:100})).rejects.toThrow("INTEGRITY");
});
it("invalid content/hash cannot overwrite an immutable artifact",async()=>{
 const data=input();await storage.putImmutable(data);await expect(storage.putImmutable({...data,bytes:Uint8Array.from(Buffer.from("%PDF-different"))})).rejects.toThrow("INTEGRITY");
 await expect(storage.putImmutable({...data,contentType:"text/html" as never})).rejects.toThrow();expect((await storage.read({...data,maxBytes:100})).bytes).toEqual(bytes);
});
it("public roots, symlink roots/files and permissive directory permissions are rejected",async()=>{
 expect(()=>new LocalArtifactStorage(join(root,"public"))).toThrow();await chmod(root,0o755);await expect(storage.putImmutable(input())).rejects.toThrow("UNAVAILABLE");await chmod(root,0o700);
 const linked=join(root,"link");await symlink(root,linked);await expect(new LocalArtifactStorage(linked).putImmutable(input())).rejects.toThrow("UNAVAILABLE");
 const data=input();await storage.putImmutable(data);const file=(await readdir(root)).find(f=>f.endsWith(".artifact"))!;await rm(join(root,file));await symlink(join(root,"outside"),join(root,file));await expect(storage.read({...data,maxBytes:100})).rejects.toThrow();
});
it("local runtime is explicit, optional and unavailable in production",()=>{
 expect(configuredDocumentPorts({NODE_ENV:"development"})).toBeUndefined();
 expect(configuredDocumentPorts({NODE_ENV:"development",DOCUMENT_STORAGE_DRIVER:"local",DOCUMENT_ARTIFACT_ROOT:root})?.artifacts).toBeInstanceOf(LocalArtifactStorage);
 expect(()=>configuredDocumentPorts({NODE_ENV:"production",DOCUMENT_STORAGE_DRIVER:"local",DOCUMENT_ARTIFACT_ROOT:root})).toThrow("UNAVAILABLE");
 expect(()=>configuredDocumentPorts({NODE_ENV:"development",DOCUMENT_STORAGE_DRIVER:"unknown",DOCUMENT_ARTIFACT_ROOT:root})).toThrow();
});
it("optional platform resources remain bounded and never fetch remote URLs",async()=>{
 const ports=configuredDocumentPorts({NODE_ENV:"development",DOCUMENT_STORAGE_DRIVER:"local",DOCUMENT_ARTIFACT_ROOT:root})!;
 await expect(ports.assets.read({objectKey:"https://example.invalid/image",maxBytes:100})).rejects.toThrow("UNAVAILABLE");
});

it("read-only storage readiness never creates directories and requires private canonical roots outside repo",async()=>{
 const env:NodeJS.ProcessEnv={NODE_ENV:"development",DOCUMENT_STORAGE_DRIVER:"local",DOCUMENT_ARTIFACT_ROOT:root};
 expect(await localDocumentStorageReadiness(env)).toBe("LOCAL_READY");expect(await readdir(root)).toEqual([]);
 expect(await localDocumentStorageReadiness({NODE_ENV:"development"})).toBe("NOT_CONFIGURED");
 expect(await localDocumentStorageReadiness({...env,DOCUMENT_ARTIFACT_ROOT:join(root,"missing")})).toBe("INVALID_CONFIGURATION");expect(await readdir(root)).toEqual([]);
 expect(await localDocumentStorageReadiness(env,root)).toBe("INVALID_CONFIGURATION");
 await chmod(root,0o755);expect(await localDocumentStorageReadiness(env)).toBe("INVALID_CONFIGURATION");await chmod(root,0o500);expect(await localDocumentStorageReadiness(env)).toBe("INVALID_CONFIGURATION");await chmod(root,0o700);
 expect(await localDocumentStorageReadiness({...env,NODE_ENV:"production"})).toBe("PRODUCTION_CONFIGURATION_REQUIRED");
});
it("production persistent-volume storage requires explicit durability and survives adapter restart",async()=>{
 const env:NodeJS.ProcessEnv={NODE_ENV:"production",DOCUMENT_STORAGE_DRIVER:"persistent-volume",DOCUMENT_STORAGE_PERSISTENCE_CONFIRMED:"true",DOCUMENT_ARTIFACT_ROOT:root};
 expect(()=>configuredDocumentPorts({...env,DOCUMENT_STORAGE_PERSISTENCE_CONFIRMED:"false"})).toThrow("UNAVAILABLE");
 expect(await localDocumentStorageReadiness(env)).toBe("PERSISTENT_READY");const data=input();await configuredDocumentPorts(env)!.artifacts.putImmutable(data);
 const reread=await configuredDocumentPorts(env)!.artifacts.read({organizationId:data.organizationId,objectKey:data.objectKey,maxBytes:data.byteLength});expect(reread.bytes).toEqual(data.bytes);
});
it("missing persistent-volume root fails closed and is never created as an ephemeral fallback",async()=>{
 const missing=join(root,"unmounted"),env:NodeJS.ProcessEnv={NODE_ENV:"production",DOCUMENT_STORAGE_DRIVER:"persistent-volume",DOCUMENT_STORAGE_PERSISTENCE_CONFIRMED:"true",DOCUMENT_ARTIFACT_ROOT:missing};
 expect(await localDocumentStorageReadiness(env)).toBe("INVALID_CONFIGURATION");await expect(configuredDocumentPorts(env)!.artifacts.putImmutable(input())).rejects.toThrow("MISSING");expect(await readdir(root)).not.toContain("unmounted");
});
