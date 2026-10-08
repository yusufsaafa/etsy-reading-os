import type {Database} from "../../db/client";
import type {Scope} from "../intake/contracts";
import {verifyScope} from "../intake/service";
import {productData} from "./service";
import {documentDesignSetup} from "../documents/service";
import {localDocumentStorageReadiness} from "../../infrastructure/document-runtime";
import {internalOperatorAllowed} from "../identity/internal-access";
/** Read-only owner projection. Presence does not admit generation or override source gates. */
export async function productGenerationSetup(db:Database,scope:Scope,productId:string){
 await verifyScope(db,scope,true);
 const data=await productData(db,scope,productId),design=await documentDesignSetup(db,scope,productId);
 const title=data.active?.status==="ACTIVE"&&data.active.configuration.productMetadata?.title?"TITLE_READY" as const:"REPUBLICATION_REQUIRED" as const;
 const storage=await localDocumentStorageReadiness();
 const internal=internalOperatorAllowed(scope.userId)?"ENABLED" as const:process.env.INTERNAL_TOOLS_ENABLED==="true"?"NOT_AUTHORIZED" as const:"DISABLED" as const;
 return {title,design:design.status,storage,internal,configurationPrerequisitesComplete:title==="TITLE_READY"&&design.status==="DESIGN_READY"&&storage==="LOCAL_READY"};
}
export type ProductGenerationSetup=Awaited<ReturnType<typeof productGenerationSetup>>;
