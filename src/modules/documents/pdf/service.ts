import type { Database } from "../../../db/client";
import type { Scope } from "../../intake/contracts";
import type { PlatformAssetStorage } from "../../../infrastructure/object-storage";
import { prepareDocumentRendering } from "../resources/service";
import { renderDocumentPdf } from "./renderer";

/** Owned immutable ID only; platform ports are server-injected, never client resource overrides. */
export async function renderDocumentPdfForReading(db:Database,scope:Scope,mediaSnapshotId:string,storage:PlatformAssetStorage){
 const {layout,resources}=await prepareDocumentRendering(db,scope,mediaSnapshotId,storage);
 return renderDocumentPdf({layout,resources});
}
