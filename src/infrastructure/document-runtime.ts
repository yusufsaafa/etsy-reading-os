import {constants} from "node:fs";
import {lstat,realpath,open} from "node:fs/promises";
import {resolve,isAbsolute,sep} from "node:path";
import {LocalArtifactStorage} from "./local-artifact-storage";
import {ArtifactStorageError,type PlatformAssetStorage} from "./object-storage";
import {objectKeySchema} from "../modules/media/contracts";
import type {DocumentProductionPorts} from "../modules/production/documents";
/** Optional read-only platform image root. No remote fetching or buyer uploads. */
export class LocalPlatformAssets implements PlatformAssetStorage {
 constructor(private readonly root?:string){}
 async read(input:Parameters<PlatformAssetStorage["read"]>[0]){
  try{
   if(!this.root||!isAbsolute(this.root)||await realpath(this.root)!==resolve(this.root)||!objectKeySchema.safeParse(input.objectKey).success)throw new ArtifactStorageError("UNAVAILABLE");
   if(!Number.isSafeInteger(input.maxBytes)||input.maxBytes<1||input.maxBytes>25*1024*1024)throw new ArtifactStorageError("LIMIT");
   let path=resolve(this.root);
   for(const part of input.objectKey.split("/")){path=resolve(path,part);if((await lstat(path)).isSymbolicLink())throw new ArtifactStorageError("INTEGRITY");}
   const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
   try{const stat=await file.stat();if(!stat.isFile()||stat.size>input.maxBytes)throw new ArtifactStorageError("LIMIT");
    const bytes=Buffer.alloc(stat.size+1);let offset=0;while(offset<bytes.length){const r=await file.read(bytes,offset,bytes.length-offset,offset);if(!r.bytesRead)break;offset+=r.bytesRead;}
    if(offset!==stat.size)throw new ArtifactStorageError("INTEGRITY");return Uint8Array.from(bytes.subarray(0,offset));
   }finally{await file.close();}
  }catch(e){if(e instanceof ArtifactStorageError)throw e;throw new ArtifactStorageError("UNAVAILABLE");}
 }
}
/** Packaged approved artwork is read-only and independent of private customer artifact storage. */
export function configuredPlatformAssets(env:NodeJS.ProcessEnv=process.env):PlatformAssetStorage {
 return new LocalPlatformAssets(env.DOCUMENT_ASSET_ROOT??resolve(process.cwd(),"resources"));
}
/** No implicit directory creation or work execution. Production needs separately supplied durable ports. */
export function configuredDocumentPorts(env:NodeJS.ProcessEnv=process.env):DocumentProductionPorts|undefined {
 if(!env.DOCUMENT_STORAGE_DRIVER)return undefined;
 if(env.DOCUMENT_STORAGE_DRIVER!=="local"||env.NODE_ENV==="production"||!env.DOCUMENT_ARTIFACT_ROOT)throw new ArtifactStorageError("UNAVAILABLE");
 const root=resolve(env.DOCUMENT_ARTIFACT_ROOT),repo=resolve(process.cwd());
 if(root===repo||root.startsWith(repo+sep))throw new ArtifactStorageError("UNAVAILABLE");
 return Object.freeze({artifacts:new LocalArtifactStorage(env.DOCUMENT_ARTIFACT_ROOT),assets:configuredPlatformAssets(env)});
}

/** Bounded infrastructure status; no paths, keys or filesystem writes returned. */
export async function localDocumentStorageReadiness(env:NodeJS.ProcessEnv=process.env,repositoryRoot=process.cwd()):Promise<"NOT_CONFIGURED"|"LOCAL_READY"|"INVALID_CONFIGURATION"|"PRODUCTION_CONFIGURATION_REQUIRED"> {
 if(env.NODE_ENV==="production")return "PRODUCTION_CONFIGURATION_REQUIRED";
 if(!["development","test"].includes(env.NODE_ENV??""))return "INVALID_CONFIGURATION";
 if(!env.DOCUMENT_STORAGE_DRIVER&&!env.DOCUMENT_ARTIFACT_ROOT)return "NOT_CONFIGURED";
 try{
  const ports=configuredDocumentPorts(env);
  const root=env.DOCUMENT_ARTIFACT_ROOT;
  if(!ports||!root||!isAbsolute(root))return "INVALID_CONFIGURATION";
  const repo=await realpath(repositoryRoot),canonical=resolve(root);
  if(canonical===repo||canonical.startsWith(repo+sep))return "INVALID_CONFIGURATION";
  await (ports.artifacts as LocalArtifactStorage).checkReady();
  return "LOCAL_READY";
 }catch{return "INVALID_CONFIGURATION";}
}
