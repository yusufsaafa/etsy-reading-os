'use server';
import {revalidatePath} from 'next/cache';
import {unstable_rethrow} from 'next/navigation';
import {database} from '@/db/client';
import {currentStoreScope} from '@/modules/identity/session';
import {searchReuseSources,previewConfigurationReuse,applyConfigurationReuse} from '@/modules/products/reuse';
const messages:Record<string,string>={REUSE_SAME_PRODUCT:'Choose a different source Product.',REUSE_SOURCE_UNAVAILABLE:'The selected source version is no longer available. Select it again.',REUSE_SOURCE_INVALID:'The source configuration is malformed or contains unsupported fields. Correct it before copying.',REUSE_STALE_PREVIEW:'Saved configuration or evidence changed after preview. Review a new preview before applying.',REUSE_INCOMPATIBLE:'This configuration is incompatible. Correct the source before copying.'};
function safe(error:unknown){unstable_rethrow(error);return error instanceof Error&&messages[error.message]||'Unable to complete configuration reuse. Check your access and reload the saved configuration.';}
export async function findConfigurationSources(destinationId:string,search:string,page:number){try{return {data:await searchReuseSources(database(),await currentStoreScope(),destinationId,{search,page})};}catch(error){return {error:safe(error)};}}
export async function previewConfigurationCopy(destinationId:string,sourceId:string,sourceVersionId:string){try{return {data:await previewConfigurationReuse(database(),await currentStoreScope(),{destinationId,sourceId,sourceVersionId})};}catch(error){return {error:safe(error)};}}
export async function applyConfigurationCopy(destinationId:string,sourceId:string,sourceVersionId:string,token:string,confirmed:boolean){try{const data=await applyConfigurationReuse(database(),await currentStoreScope(),{destinationId,sourceId,sourceVersionId,token,confirmed});revalidatePath('/','layout');return {data};}catch(error){return {error:safe(error)};}}
