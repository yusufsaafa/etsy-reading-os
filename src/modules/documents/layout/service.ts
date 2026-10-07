import type { Database } from "../../../db/client";
import type { Scope } from "../../intake/contracts";
import { getDocumentRenderInput } from "../media-service";
import { composeDocumentLayout } from "./engine";
/** Owned identifier only; client never supplies a render input or ownership payload. No writes. */
export async function getDocumentLayout(db:Database,scope:Scope,mediaSnapshotId:string) {
 return composeDocumentLayout(await getDocumentRenderInput(db,scope,mediaSnapshotId));
}
