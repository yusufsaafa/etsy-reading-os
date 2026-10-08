import {constants} from "node:fs";
import {mkdir,realpath,lstat,open,link,unlink} from "node:fs/promises";
import {resolve,isAbsolute} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";
import {ArtifactStorageError,type ImmutableArtifactStorage} from "./object-storage";
import {PDF_LIMITS} from "../modules/documents/pdf/contract";
const digest=(bytes:Uint8Array|string)=>createHash("sha256").update(bytes).digest("hex");
const envelope=z.strictObject({organizationId:z.uuid(),objectKey:z.string().max(400),contentType:z.literal("application/pdf"),sha256:z.string().regex(/^[a-f0-9]{64}$/),byteLength:z.number().int().positive().max(PDF_LIMITS.bytes)});
function identity(organizationId:string,objectKey:string) {
 if(!z.uuid().safeParse(organizationId).success)throw new ArtifactStorageError("INTEGRITY");
 const parts=objectKey.split("/");
 if(parts.length!==9||parts.slice(0,3).join("/")!=="private/documents/v1"||parts[3]!==organizationId||parts.slice(3,7).some(p=>!z.uuid().safeParse(p).success)||parts[7]!=="reading-pdf-1"||!/^([a-f0-9]{64})\.pdf$/.test(parts[8]))throw new ArtifactStorageError("INTEGRITY");
 return digest(organizationId+"\n"+objectKey)+".artifact";
}
function error(error:unknown):never {
 if(error instanceof ArtifactStorageError)throw error;
 throw new ArtifactStorageError((error as NodeJS.ErrnoException)?.code==="ENOENT"?"MISSING":"UNAVAILABLE");
}
/** Private local development ONLY. One atomic immutable envelope per artifact.
 * Root must be outside public/static directories, owned exclusively by the app OS user.
 * No overwrite/remove capability, no buyer content in paths, no URL interface.
 */
export class LocalArtifactStorage implements ImmutableArtifactStorage {
 private readonly root:string;
 constructor(root:string){
  if(!isAbsolute(root)||root.split(/[\\/]/).some(p=>["public","static",".next","node_modules"].includes(p)))throw new ArtifactStorageError("UNAVAILABLE");
  this.root=resolve(root);
 }
 private async directory(create=false){
  if(create)await mkdir(this.root,{recursive:true,mode:0o700});
  const stat=await lstat(this.root);
  if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(this.root)!==this.root||(stat.mode&0o077)!==0||(typeof process.getuid==="function"&&stat.uid!==process.getuid()))throw new ArtifactStorageError("UNAVAILABLE");
 }
 /** Read-only readiness probe: never creates or repairs directories. */
 async checkReady(){await this.directory();if(((await lstat(this.root)).mode&0o700)!==0o700)throw new ArtifactStorageError("UNAVAILABLE");}
 async putImmutable(input:Parameters<ImmutableArtifactStorage["putImmutable"]>[0]){
  let temporary:string|undefined;
  try{
   const name=identity(input.organizationId,input.objectKey),meta=envelope.parse({organizationId:input.organizationId,objectKey:input.objectKey,contentType:input.contentType,sha256:input.sha256,byteLength:input.byteLength});
   if(input.bytes.length!==meta.byteLength||digest(input.bytes)!==meta.sha256||!input.objectKey.endsWith(meta.sha256+".pdf")||Buffer.from(input.bytes.subarray(0,5)).toString()!=="%PDF-")throw new ArtifactStorageError("INTEGRITY");
   await this.directory(true);
   temporary=resolve(this.root,"."+randomUUID()+".pending");
   const handle=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
   try{await handle.writeFile(Buffer.concat([Buffer.from(JSON.stringify(meta)+"\n"),Buffer.from(input.bytes)]));await handle.sync();}finally{await handle.close();}
   try{await link(temporary,resolve(this.root,name));const dir=await open(this.root,constants.O_RDONLY);try{await dir.sync();}finally{await dir.close();}}
   catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;
    const prior=await this.read({organizationId:input.organizationId,objectKey:input.objectKey,maxBytes:input.byteLength});
    if(prior.bytes.length!==input.byteLength||digest(prior.bytes)!==input.sha256)throw new ArtifactStorageError("CONFLICT");
   }
  }catch(e){error(e);}finally{if(temporary)await unlink(temporary).catch(()=>undefined);}
 }
 async read(input:Parameters<ImmutableArtifactStorage["read"]>[0]){
  try{
   const name=identity(input.organizationId,input.objectKey);
   if(!Number.isSafeInteger(input.maxBytes)||input.maxBytes<1||input.maxBytes>PDF_LIMITS.bytes)throw new ArtifactStorageError("LIMIT");
   await this.directory();
   const handle=await open(resolve(this.root,name),constants.O_RDONLY|constants.O_NOFOLLOW);
   try{
    const stat=await handle.stat();if(!stat.isFile()||(stat.mode&0o077)!==0)throw new ArtifactStorageError("INTEGRITY");
    if(stat.size>input.maxBytes+1024)throw new ArtifactStorageError("LIMIT");
    // Read at most the bound + header + sentinel even if a file grows concurrently.
    const buffer=Buffer.alloc(Math.min(stat.size+1,input.maxBytes+1025));let count=0;
    while(count<buffer.length){const result=await handle.read(buffer,count,buffer.length-count,count);if(!result.bytesRead)break;count+=result.bytesRead;}
    if(count!==stat.size)throw new ArtifactStorageError("INTEGRITY");
    const body=buffer.subarray(0,count),end=body.indexOf(10);if(end<0||end>1023)throw new ArtifactStorageError("INTEGRITY");
    const meta=envelope.parse(JSON.parse(body.subarray(0,end).toString())),bytes=body.subarray(end+1);
    if(meta.organizationId!==input.organizationId||meta.objectKey!==input.objectKey||bytes.length!==meta.byteLength||bytes.length>input.maxBytes||digest(bytes)!==meta.sha256||!meta.objectKey.endsWith(meta.sha256+".pdf"))throw new ArtifactStorageError("INTEGRITY");
    return Object.freeze({objectKey:input.objectKey,contentType:meta.contentType,bytes:Uint8Array.from(bytes)});
   }finally{await handle.close();}
  }catch(e){error(e);}
 }
}
