/** Preview-only samples. Never imported by intake, generation or customer snapshot assembly. */
import type {Database} from "../../db/client";
import type {Scope} from "../intake/contracts";
import {listSelectableTarotDecks,resolveTarotCardAsset,readFrozenPlatformAssetBytes} from "../media/service";
import {configuredPlatformAssets} from "../../infrastructure/document-runtime";
export const STUDIO_SAMPLE_CARDS=Object.freeze(["THE_FOOL","THE_LOVERS","THE_STAR"] as const);
export const STUDIO_SAMPLE_DECK=Object.freeze({deckKey:"rider-waite",deckVersion:1});
export async function studioPreviewMedia(db:Database,scope:Scope){
 const available=await listSelectableTarotDecks(db,scope);
 if(!available.some(d=>d.deckKey===STUDIO_SAMPLE_DECK.deckKey&&d.deckVersion===STUDIO_SAMPLE_DECK.deckVersion))throw Error("PREVIEW_CARDS_UNAVAILABLE");
 const cards=[];
 for(const [position,cardKey] of STUDIO_SAMPLE_CARDS.entries()){
  const resolved=await resolveTarotCardAsset(db,{...STUDIO_SAMPLE_DECK,cardKey});
  cards.push({cardKey,orientation:"UPRIGHT" as const,position,asset:resolved.asset});
 }
 const storage=configuredPlatformAssets();
 return {media:{mode:"TAROT_CARDS" as const,deck:STUDIO_SAMPLE_DECK,cards},readAsset:(asset:Parameters<typeof readFrozenPlatformAssetBytes>[2])=>readFrozenPlatformAssetBytes(db,storage,asset)};
}
