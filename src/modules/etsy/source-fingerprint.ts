import {createHash} from "node:crypto";
import {etsySourceSchema,type EtsySourceEvidence} from "./source-contract";
import {stableJson} from "../intake/contracts";
/** Observation time is transport metadata, not purchased evidence. Everything else is bound. */
export function sourceFingerprint(raw:EtsySourceEvidence):string {
 const source=etsySourceSchema.parse(raw);
 const {observedAt,...receipt}=source.receipt;
 void observedAt;
 return createHash("sha256").update(stableJson({...source,receipt})).digest("hex");
}
