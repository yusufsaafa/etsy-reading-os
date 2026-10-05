import type { Database } from "../../db/client";
import type { Scope } from "../intake/contracts";
import { sellerStyleData, previousWorkContent } from "./service";
// Server-only domain data, never a provider prompt. No network calls or generation records.
// Repeatable read keeps identity, pointer and source metadata from the same committed snapshot.
export async function sellerProductionContext(db:Database,scope:Scope,styleVersionId?:string) {
  return db.transaction(async tx=>{
    const data=await sellerStyleData(tx,scope);
    const style=styleVersionId ? data.versions.find(v=>v.id===styleVersionId&&v.status!=="DRAFT"):data.active;
    if(styleVersionId&&!style)throw new Error("STYLE_VERSION_UNAVAILABLE");
    if(!data.seller||!style)return {ready:false as const,missing:[...(!data.seller?["profile"]:[]),...(!style?["style"]:[])]};
    return {ready:true as const,seller:{id:data.seller.id,displayName:data.seller.displayName,shortBio:data.seller.shortBio,updatedAt:data.seller.updatedAt},style:{id:style.id,versionNumber:style.versionNumber,configuration:style.configuration},sources:data.sources.map(s=>({id:s.id,title:s.title,sourceType:s.sourceType,contentHash:s.contentHash}))};
  },{isolationLevel:"repeatable read"});
}
// Explicit source selection, bounded by the caller's future production budget; no automatic loading.
export { previousWorkContent };
