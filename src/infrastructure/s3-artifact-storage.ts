import {createHash} from "node:crypto";
import {S3Client,PutObjectCommand,GetObjectCommand,type GetObjectCommandOutput} from "@aws-sdk/client-s3";
import {z} from "zod";
import {ArtifactStorageError,type ImmutableArtifactStorage} from "./object-storage";
import {PDF_LIMITS} from "../modules/documents/pdf/contract";
const sha=(bytes:Uint8Array|string)=>createHash("sha256").update(bytes).digest("hex");
const keySchema=z.string().regex(/^private\/documents\/v1\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\/reading-pdf-1\/[0-9a-f]{64}\.pdf$/).max(400);
export type S3Configuration=Readonly<{endpoint:string;bucket:string;region:string;accessKeyId:string;secretAccessKey:string;prefix:string}>;
/** No environment credential chain, metadata service, bucket creation or public URL discovery. */
export function s3Configuration(env:Readonly<Record<string,string|undefined>>):S3Configuration {
 try{
  const endpoint=new URL(env.S3_ENDPOINT??"");
  if(endpoint.protocol!=="https:"||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=="/"||!endpoint.hostname)throw new Error();
  if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.S3_BUCKET??"")||!/^[a-zA-Z0-9-]{1,64}$/.test(env.S3_REGION??"")||!env.S3_ACCESS_KEY_ID?.trim()||!env.S3_SECRET_ACCESS_KEY?.trim()||env.S3_CONDITIONAL_WRITES_CONFIRMED!=="true")throw new Error();
  const prefix=env.S3_KEY_PREFIX??"";
  if(prefix.length>128||(prefix!==""&&!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix)))throw new Error();
  return Object.freeze({endpoint:endpoint.origin,bucket:env.S3_BUCKET!,region:env.S3_REGION!,accessKeyId:env.S3_ACCESS_KEY_ID!,secretAccessKey:env.S3_SECRET_ACCESS_KEY!,prefix});
 }catch{throw new ArtifactStorageError("UNAVAILABLE");}
}
export interface S3Transport {
 send(command:PutObjectCommand|GetObjectCommand,options:{abortSignal:AbortSignal}):Promise<Partial<GetObjectCommandOutput>>;
}
function ownedKey(organizationId:string,key:string){
 if(!z.uuid().safeParse(organizationId).success||!keySchema.safeParse(key).success)throw new ArtifactStorageError("INTEGRITY");
 const parts=key.split("/");
 if(parts[3]!==organizationId||parts.slice(3,7).some(p=>!z.uuid().safeParse(p).success))throw new ArtifactStorageError("INTEGRITY");
 return sha(organizationId+"\n"+key);
}
function failure(error:unknown):never {
 if(error instanceof ArtifactStorageError)throw error;
 const e=error as {name?:string};
 throw new ArtifactStorageError(e?.name==="NoSuchKey"?"MISSING":"UNAVAILABLE");
}
/** SDK calls are single-attempt; the existing PostgreSQL production protocol owns retries.
 * Activation requires provider-specific confirmation of atomic If-None-Match semantics.
 */
export class S3ArtifactStorage implements ImmutableArtifactStorage {
 private readonly transport:S3Transport;
 constructor(private readonly config:S3Configuration,transport?:S3Transport,private readonly timeoutMs=30000){
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new ArtifactStorageError("UNAVAILABLE");
  this.transport=transport??new S3Client({endpoint:config.endpoint,region:config.region,credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey},forcePathStyle:true,maxAttempts:1,requestChecksumCalculation:"WHEN_REQUIRED",responseChecksumValidation:"WHEN_REQUIRED"}) as S3Transport;
 }
 private key(logical:string){return this.config.prefix?`${this.config.prefix}/${logical}`:logical;}
 async putImmutable(input:Parameters<ImmutableArtifactStorage["putImmutable"]>[0]){
  try{
   const identity=ownedKey(input.organizationId,input.objectKey);
   if(input.contentType!=="application/pdf"||!Number.isSafeInteger(input.byteLength)||input.byteLength<1||input.byteLength>PDF_LIMITS.bytes||input.bytes.length!==input.byteLength||sha(input.bytes)!==input.sha256||!input.objectKey.endsWith(input.sha256+".pdf")||Buffer.from(input.bytes.subarray(0,5)).toString()!=="%PDF-")throw new ArtifactStorageError("INTEGRITY");
   try{await this.transport.send(new PutObjectCommand({Bucket:this.config.bucket,Key:this.key(input.objectKey),Body:Uint8Array.from(input.bytes),ContentType:input.contentType,ContentLength:input.byteLength,IfNoneMatch:"*",Metadata:{identity,sha256:input.sha256,"byte-length":String(input.byteLength)}}),{abortSignal:AbortSignal.timeout(this.timeoutMs)});}
   catch(e){
    const error=e as {name?:string;$metadata?:{httpStatusCode?:number}};
    if(![409,412].includes(error?.$metadata?.httpStatusCode??0)&&!["PreconditionFailed","ConditionalRequestConflict"].includes(error?.name??""))throw e;
    try{await this.read({organizationId:input.organizationId,objectKey:input.objectKey,maxBytes:input.byteLength});return;}
    catch(e){if(e instanceof ArtifactStorageError&&["INTEGRITY","LIMIT"].includes(e.code))throw new ArtifactStorageError("CONFLICT");throw e;}
   }
   // Acknowledgement alone is not integrity evidence; read back the exact private object.
   await this.read({organizationId:input.organizationId,objectKey:input.objectKey,maxBytes:input.byteLength});
  }catch(e){failure(e);}
 }
 async read(input:Parameters<ImmutableArtifactStorage["read"]>[0]){
  let body:(AsyncIterable<Uint8Array>&{destroy?:()=>void})|undefined;
  try{
   const identity=ownedKey(input.organizationId,input.objectKey);
   if(!Number.isSafeInteger(input.maxBytes)||input.maxBytes<1||input.maxBytes>PDF_LIMITS.bytes)throw new ArtifactStorageError("LIMIT");
   const signal=AbortSignal.timeout(this.timeoutMs);
   const result=await this.transport.send(new GetObjectCommand({Bucket:this.config.bucket,Key:this.key(input.objectKey)}),{abortSignal:signal});
   body=result.Body as typeof body;
   const length=result.ContentLength;
   if(!body||typeof length!=="number"||!Number.isSafeInteger(length)||length<1||length>input.maxBytes)throw new ArtifactStorageError("LIMIT");
   const digest=input.objectKey.slice(-68,-4),meta=result.Metadata;
   if(result.ContentType!=="application/pdf"||meta?.identity!==identity||meta.sha256!==digest||meta["byte-length"]!==String(length))throw new ArtifactStorageError("INTEGRITY");
   const chunks:Uint8Array[]=[];let size=0;const iterator=body[Symbol.asyncIterator]();
   while(true){
    if(signal.aborted)throw new ArtifactStorageError("UNAVAILABLE");
    let cancel=()=>{};
    const aborted=new Promise<never>((_,reject)=>{const listener=()=>reject(new ArtifactStorageError("UNAVAILABLE"));signal.addEventListener("abort",listener,{once:true});cancel=()=>signal.removeEventListener("abort",listener);});
    let next:IteratorResult<Uint8Array>;try{next=await Promise.race([iterator.next(),aborted]);}finally{cancel();}
    if(next.done)break;
    if(!(next.value instanceof Uint8Array))throw new ArtifactStorageError("INTEGRITY");
    size+=next.value.byteLength;if(size>input.maxBytes||size>length)throw new ArtifactStorageError("LIMIT");chunks.push(Uint8Array.from(next.value));
   }
   const bytes=Uint8Array.from(Buffer.concat(chunks));
   if(size!==length||sha(bytes)!==digest||Buffer.from(bytes.subarray(0,5)).toString()!=="%PDF-")throw new ArtifactStorageError("INTEGRITY");
   return Object.freeze({objectKey:input.objectKey,contentType:"application/pdf",bytes});
  }catch(e){failure(e);}finally{body?.destroy?.();}
 }
}
