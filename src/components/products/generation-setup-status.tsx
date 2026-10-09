import { InformationPopover } from "@/components/information-popover";
import Link from "next/link";
import type {ProductGenerationSetup} from "@/modules/products/generation-setup";
export function GenerationSetupStatus({productId,status,local=false}:{productId:string;status:ProductGenerationSetup;local?:boolean}){
 return <InformationPopover label="Generation test setup" dialog><ul>
 <li>{status.title==="TITLE_READY"?"Approved product title ready":"Product title needs republication — Edit product, review the unchanged Etsy configuration, then explicitly activate."}</li>
 <li>{status.design==="DESIGN_READY"?"Document design assigned":status.design==="SETUP_REQUIRED"?"Document design missing":"Document design needs attention"} · <Link href={`/products/${productId}/document-design`} target="_blank" rel="noopener noreferrer">Manage PDF appearance</Link></li>
 <li>{status.storage==="LOCAL_READY"?"Private local storage ready (development only)":status.storage==="NOT_CONFIGURED"?"Local artifact storage not configured":status.storage==="PRODUCTION_CONFIGURATION_REQUIRED"?"Production artifact storage requires external configuration":"Local artifact storage configuration needs attention"}</li>
 <li>{status.internal==="ENABLED"?"Internal review access enabled":status.internal==="DISABLED"?"Internal review access disabled":"Internal review access not authorized for this session"}{local&&<> · <Link href="/settings/local-access" target="_blank" rel="noopener noreferrer">Local access instructions</Link></>}</li>
 </ul><p className="small muted">{status.configurationPrerequisitesComplete?"Configuration prerequisites complete.":"Generation test prerequisites incomplete."} An eligible Reading, private source review and separate generation/PDF authorization are still required. Nothing runs from this page.</p></InformationPopover>;
}
