import {expect} from "vitest";
import {Readable} from "node:stream";
import {GetObjectCommand,PutObjectCommand,type GetObjectCommandOutput} from "@aws-sdk/client-s3";
import type {S3Transport} from "../src/infrastructure/s3-artifact-storage";
export class FakeS3 implements S3Transport {
 objects=new Map<string,{bytes:Uint8Array;meta:Record<string,string>;type:string}>();puts=0;gets=0;lose=false;error?:string;stall=false;corrupt=false;
 async send(command:PutObjectCommand|GetObjectCommand):Promise<Partial<GetObjectCommandOutput>>{
  if(this.error)throw {name:this.error};
  const key=command.input.Key!;
  if(command instanceof PutObjectCommand){
   this.puts++;expect(command.input.IfNoneMatch).toBe("*");expect(command.input.ACL).toBeUndefined();
   if(this.objects.has(key))throw {name:"PreconditionFailed",$metadata:{httpStatusCode:412}};
   this.objects.set(key,{bytes:Uint8Array.from(command.input.Body as Uint8Array),meta:{...command.input.Metadata!},type:command.input.ContentType!});
   if(this.lose)throw {name:"TimeoutError",message:"provider secret and private key must not escape"};return {};
  }
  this.gets++;const object=this.objects.get(key);if(!object)throw {name:"NoSuchKey"};
  const bytes=Uint8Array.from(object.bytes);if(this.corrupt)bytes[bytes.length-1]^=1;
  const body=this.stall?{[Symbol.asyncIterator](){return {next:()=>new Promise<IteratorResult<Uint8Array>>(()=>{})};}}:Readable.from([bytes.subarray(0,4),bytes.subarray(4)]);
  return {ContentLength:object.bytes.length,ContentType:object.type,Metadata:{...object.meta},Body:body as GetObjectCommandOutput["Body"]};
 }
}
