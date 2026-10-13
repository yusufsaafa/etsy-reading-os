import {it,expect} from "vitest";
import {randomUUID,createHash} from "node:crypto";
import {FakeS3} from "./s3-storage.fixture";
import {S3ArtifactStorage,s3Configuration} from "../src/infrastructure/s3-artifact-storage";
import {artifactObjectKey} from "../src/modules/documents/artifact-contract";
import {configuredDocumentPorts,localDocumentStorageReadiness} from "../src/infrastructure/document-runtime";
const env={NODE_ENV:"production" as const,DOCUMENT_STORAGE_DRIVER:"s3-compatible",S3_ENDPOINT:"https://example.r2.cloudflarestorage.com",S3_BUCKET:"private-pdfs",S3_REGION:"auto",S3_ACCESS_KEY_ID:"synthetic-key",S3_SECRET_ACCESS_KEY:"synthetic-secret",S3_KEY_PREFIX:"reading-os",S3_CONDITIONAL_WRITES_CONFIRMED:"true"};
function fixture(){const organizationId=randomUUID(),bytes=Uint8Array.from(Buffer.from("%PDF-synthetic-test-only")),sha256=createHash("sha256").update(bytes).digest("hex");return {organizationId,bytes,sha256,byteLength:bytes.length,contentType:"application/pdf" as const,objectKey:artifactObjectKey({organizationId,storeId:randomUUID(),readingId:randomUUID(),mediaSnapshotId:randomUUID(),rendererVersion:"reading-pdf/1",sha256})};}
function setup(){const transport=new FakeS3();return {transport,storage:new S3ArtifactStorage(s3Configuration(env),transport),data:fixture()};}
it("uploads conditionally and independently configured web/worker instances read the same private object",async()=>{
 const {transport,storage,data}=setup();await storage.putImmutable(data);
 const web=new S3ArtifactStorage(s3Configuration(env),transport);
 expect((await web.read({...data,maxBytes:data.byteLength})).bytes).toEqual(data.bytes);
 expect([...transport.objects.keys()][0]).toBe(`reading-os/${data.objectKey}`);
});
it("idempotent concurrent creates produce one immutable object",async()=>{
 const {transport,storage,data}=setup();await Promise.all([storage.putImmutable(data),storage.putImmutable(data)]);expect(transport.objects.size).toBe(1);
});
it("worker restart adopts an uncertain completed upload without overwriting it",async()=>{
 const {transport,storage,data}=setup();transport.lose=true;await expect(storage.putImmutable(data)).rejects.toThrow("UNAVAILABLE");
 transport.lose=false;const restarted=new S3ArtifactStorage(s3Configuration(env),transport);expect((await restarted.read({...data,maxBytes:data.byteLength})).bytes).toEqual(data.bytes);await restarted.putImmutable(data);expect(transport.objects.size).toBe(1);
});
it("conflicting existing metadata fails closed without replacing bytes",async()=>{
 const {transport,storage,data}=setup();await storage.putImmutable(data);transport.objects.get(`reading-os/${data.objectKey}`)!.meta.identity="incorrect";
 await expect(storage.putImmutable(data)).rejects.toThrow("CONFLICT");expect(transport.objects.get(`reading-os/${data.objectKey}`)!.bytes).toEqual(data.bytes);
});
it("missing objects differ from missing bucket/credentials/network failures; raw errors are hidden",async()=>{
 const {transport,storage,data}=setup();await expect(storage.read({...data,maxBytes:100})).rejects.toThrow("MISSING");
 for(const error of ["NoSuchBucket","AccessDenied","InvalidAccessKeyId","NetworkingError","TimeoutError"]){transport.error=error;await expect(storage.putImmutable(data)).rejects.toThrow(/^UNAVAILABLE$/);}
});
it("corrupted and oversized stored bytes are rejected",async()=>{
 const {transport,storage,data}=setup();await storage.putImmutable(data);transport.corrupt=true;await expect(storage.read({...data,maxBytes:data.byteLength})).rejects.toThrow("INTEGRITY");
 transport.corrupt=false;await expect(storage.read({...data,maxBytes:1})).rejects.toThrow("LIMIT");
});
it("invalid bytes and tenant/key identity are rejected before any S3 operation",async()=>{
 const {transport,storage,data}=setup();await expect(storage.putImmutable({...data,bytes:new Uint8Array([1])})).rejects.toThrow("INTEGRITY");
 await expect(storage.read({...data,organizationId:randomUUID(),maxBytes:100})).rejects.toThrow("INTEGRITY");expect(transport.puts+transport.gets).toBe(0);
});
it("a stalled download stream is bounded by the operation deadline",async()=>{
 const {transport,storage,data}=setup();await storage.putImmutable(data);transport.stall=true;
 await expect(new S3ArtifactStorage(s3Configuration(env),transport,15).read({...data,maxBytes:100})).rejects.toThrow("UNAVAILABLE");
});
it("configuration requires explicit private credentials and verified conditional-write support",async()=>{
 for(const field of ["S3_ENDPOINT","S3_BUCKET","S3_REGION","S3_ACCESS_KEY_ID","S3_SECRET_ACCESS_KEY","S3_CONDITIONAL_WRITES_CONFIRMED"]){expect(()=>s3Configuration({...env,[field]:""})).toThrow("UNAVAILABLE");}
 for(const endpoint of ["http://example.test","https://user:password@example.test","https://example.test/public","https://example.test?key=secret"]){expect(()=>s3Configuration({...env,S3_ENDPOINT:endpoint})).toThrow("UNAVAILABLE");}
 expect(()=>s3Configuration({...env,S3_KEY_PREFIX:"../public"})).toThrow();
 expect(configuredDocumentPorts(env)!.artifacts).toBeInstanceOf(S3ArtifactStorage);
 expect(await localDocumentStorageReadiness(env)).toBe("S3_CONFIGURED");
 expect(await localDocumentStorageReadiness({...env,S3_BUCKET:""})).toBe("INVALID_CONFIGURATION");
});
it("SDK serializes a conditional signed PUT without public ACL or unsupported optional checksum",async()=>{
 const {S3Client}=await import("@aws-sdk/client-s3");const {Readable}=await import("node:stream");
 const data=fixture();let metadata:Record<string,string>={},writes=0;
 const client=new S3Client({endpoint:env.S3_ENDPOINT,region:"auto",credentials:{accessKeyId:"fake",secretAccessKey:"fake"},forcePathStyle:true,maxAttempts:1,requestChecksumCalculation:"WHEN_REQUIRED",responseChecksumValidation:"WHEN_REQUIRED",requestHandler:{async handle(request:{method:string;headers:Record<string,string>}){
  if(request.method==="PUT"){
   writes++;expect(request.headers["if-none-match"]).toBe("*");expect(request.headers["x-amz-acl"]).toBeUndefined();expect(request.headers["x-amz-sdk-checksum-algorithm"]).toBeUndefined();
   metadata=Object.fromEntries(Object.entries(request.headers).filter(([k])=>k.startsWith("x-amz-meta-")));
   return {response:{statusCode:200,headers:{},body:Readable.from([])}};
  }
  return {response:{statusCode:200,headers:{...metadata,"content-length":String(data.byteLength),"content-type":"application/pdf"},body:Readable.from([data.bytes])}};
 }}});
 try{await new S3ArtifactStorage(s3Configuration(env),client).putImmutable(data);expect(writes).toBe(1);}finally{client.destroy();}
});
it("upload deadline failures remain sanitized and do not fall back to an unconditional PUT",async()=>{
 let calls=0;
 const transport={async send(_command:unknown,{abortSignal}:{abortSignal:AbortSignal}):Promise<never>{calls++;return new Promise((_,reject)=>abortSignal.addEventListener("abort",()=>reject(new Error("secret transport diagnostics")),{once:true}));}};
 await expect(new S3ArtifactStorage(s3Configuration(env),transport,15).putImmutable(fixture())).rejects.toThrow(/^UNAVAILABLE$/);expect(calls).toBe(1);
});
