import type { Database } from "../../../db/client";
import type { Scope } from "../../intake/contracts";
import type { PlatformAssetStorage } from "../../../infrastructure/object-storage";
import { getDocumentRenderInput } from "../media-service";
import { readFrozenPlatformAssetBytes } from "../../media/service";
import { composeDocumentLayout } from "../layout/engine";
import { loadControlledFonts } from "./fonts";
import { productionMeasurement } from "./measurement";
import { prepareLayoutResources } from "./bundle";

/** Production preview may derive geometry without reading any image bytes. Same engine as PDF. */
export async function getProductionDocumentLayout(db:Database,scope:Scope,mediaSnapshotId:string) {
 const input=await getDocumentRenderInput(db,scope,mediaSnapshotId);
 return composeDocumentLayout(input,productionMeasurement(await loadControlledFonts()));
}
/** Owned immutable ID only. No client resource/deck/path/hash overrides and no writes. */
export async function prepareDocumentRendering(db:Database,scope:Scope,mediaSnapshotId:string,storage:PlatformAssetStorage) {
 const input=await getDocumentRenderInput(db,scope,mediaSnapshotId);
 const measurement=productionMeasurement(await loadControlledFonts());
 const layout=composeDocumentLayout(input,measurement);
 const resources=await prepareLayoutResources(input,layout,measurement,asset=>readFrozenPlatformAssetBytes(db,storage,asset));
 return Object.freeze({layout,resources});
}
