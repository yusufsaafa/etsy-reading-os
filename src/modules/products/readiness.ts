import {configurationSchema,activationErrors} from "./contracts";
import {configurationBindingErrors} from "./validation";
import {setupReadiness} from "./setup-validation";
import {selectionKey} from "../etsy/source-contract";
import type {SetupCatalog} from "../etsy/setup-catalog";
export type CheckStatus="PASS"|"ACTION_REQUIRED"|"UNKNOWN"|"NOT_APPLICABLE";
export type ReadinessStatus="READY"|"ACTION_REQUIRED"|"UNKNOWN";
export type Remediation={tab:"setup"|"generation"|"pdf"}|{listingId:string}|{catalog:true};
export type ReadinessCheck={id:string;group:"setup"|"generation"|"etsy"|"pdf";status:CheckStatus;title:string;explanation:string;remediation?:Remediation};
export type ReadinessVersion={id:string;versionNumber:number;revision:number;configuration:unknown};
export type ChoiceEvidence={listingId:string;key:string;label:string;paused:boolean;mapped:boolean;state:CheckStatus;explanation:string;verifiedAt:string|null;catalog?:SetupCatalog};
export type ReadinessSnapshot={productId:string;storeId:string;name:string;active:ReadinessVersion|null;draft:ReadinessVersion|null;bindings:{listingExternalId:string;variantKey:string}[];choices:ChoiceEvidence[];limited:boolean;pdf:{status:"RESOLVED"|"MISSING"|"INVALID"|"UNKNOWN";name?:string;source?:"PRODUCT"|"STORE_DEFAULT"}};
export function aggregateReadiness(checks:readonly {status:CheckStatus}[]):ReadinessStatus{return checks.some(c=>c.status==="ACTION_REQUIRED")?"ACTION_REQUIRED":checks.some(c=>c.status==="UNKNOWN")?"UNKNOWN":"READY";}
export type TargetAssessment={target:"PUBLISHED"|"DRAFT";version:{id:string;number:number;revision:number}|null;status:ReadinessStatus;checks:ReadinessCheck[];choices:(Omit<ChoiceEvidence,"catalog">&{status:CheckStatus})[]};
function assessTarget(s:ReadinessSnapshot,target:"PUBLISHED"|"DRAFT"):TargetAssessment{
 const version=target==="PUBLISHED"?s.active:s.draft,checks:ReadinessCheck[]=[];
 const add=(id:string,group:ReadinessCheck["group"],status:CheckStatus,title:string,explanation:string,remediation?:Remediation)=>checks.push({id,group,status,title,explanation,remediation});
 add("version", "setup",version?"PASS":target==="DRAFT"?"UNKNOWN":"ACTION_REQUIRED",target==="PUBLISHED"?"Published version":"Saved draft",version?`Version ${version.versionNumber} · ${target==="PUBLISHED"?"Active":"Draft"}`:target==="DRAFT"?"No saved draft. Published configuration is assessed separately.":"No eligible ACTIVE ProductVersion. Save and explicitly publish a valid draft.",{tab:"setup"});
 if(!version)return {target,version:null,status:aggregateReadiness(checks),checks,choices:[]};
 const parsed=configurationSchema.safeParse(version.configuration),c=parsed.success?parsed.data:undefined;
 const structuralGeneration=!parsed.success&&parsed.error.issues.every(e=>["workflow","output","fulfillment"].includes(String(e.path[0])));
 add("structure",structuralGeneration?"generation":"setup",c?"PASS":"ACTION_REQUIRED","Configuration structure",c?"Saved values match the supported configuration contract.":"Saved configuration contains unsupported or malformed values. Review setup and generation settings.",{tab:structuralGeneration?"generation":"setup"});
 if(c){
  const name=target==="PUBLISHED"?c.productMetadata?.title??"Published Product":s.name,errors=activationErrors(name,c);
  const generation=errors.filter(e=>/output|workflow|automatic/i.test(e)),setup=errors.filter(e=>!generation.includes(e));
  add("product-setup","setup",setup.length?"ACTION_REQUIRED":"PASS","Product setup",setup.join(" ")||"Name, customer field definitions and reading sections pass existing publication checks.",{tab:"setup"});
  add("generation","generation",generation.length?"ACTION_REQUIRED":"PASS","Generation settings",generation.join(" ")||"Preparation mode, output and optional target meet existing configuration rules.",{tab:"generation"});
  const bindingErrors=configurationBindingErrors(c,s.bindings);
  add("exact-policy","etsy",bindingErrors.length?"ACTION_REQUIRED":"PASS","Exact purchase policy",bindingErrors.length?"Saved associations do not match this version’s exact Etsy purchase policy. Review the listing and configuration; no association has been changed.":"Owned saved associations match the version’s existing publication binding rules.",{tab:"setup"});
  const catalog=s.choices.find(e=>e.state==="PASS"&&e.catalog?.listing.id===c.etsyFulfillment?.listingId)?.catalog;
  if(c.etsyFulfillment){const sourceErrors=catalog?setupReadiness(name,c,catalog).filter(e=>!errors.includes(e)):[];
   add("etsy-inputs","setup",catalog?sourceErrors.length?"ACTION_REQUIRED":"PASS":"UNKNOWN","Etsy customer information",catalog?sourceErrors.join(" ")||"Current saved buyer questions and required fields match the existing setup validator.":"Buyer-question mappings cannot be verified without current saved catalog evidence.",{tab:"setup"});}
  add("pdf","pdf",c.output==="TEXT"?"NOT_APPLICABLE":!c.output?"UNKNOWN":s.pdf.status==="RESOLVED"?"PASS":s.pdf.status==="UNKNOWN"?"UNKNOWN":"ACTION_REQUIRED","PDF appearance",c.output==="TEXT"?"Written Text does not require a PDF design.":!c.output?"Choose an output format before assessing PDF appearance.":s.pdf.status==="RESOLVED"?`${s.pdf.name} · ${s.pdf.source==="PRODUCT"?"Product override":"Store default"}. Configuration resolved; rendering has not been tested.`:s.pdf.status==="INVALID"?"The selected PDF assignment is invalid or unavailable. An invalid override does not fall back.":"A valid PDF design could not be resolved for this output.",{tab:c.output?"pdf":"generation"});
 }
 const choices=s.choices.filter(e=>e.mapped||c?.etsyFulfillment?.listingId===e.listingId&&selectionKey(c.etsyFulfillment.purchaseSelections)===e.key).map(e=>{let status=e.state,explanation=e.explanation;
  if(!c||checks.some(k=>(k.id==="product-setup"||k.id==="generation"||k.id==="etsy-inputs")&&k.status==="ACTION_REQUIRED")){status="ACTION_REQUIRED";explanation="This version does not pass the existing configuration checks.";}
  if(c?.etsyFulfillment&&(c.etsyFulfillment.listingId!==e.listingId||selectionKey(c.etsyFulfillment.purchaseSelections)!==e.key)){status="ACTION_REQUIRED";explanation="This version’s exact policy does not match the saved choice.";}
  const {catalog:_,...safe}=e;return {...safe,status,explanation};});
 add("inventory","etsy",aggregateReadiness(choices.map(e=>({status:e.status})))==="READY"&&choices.length?"PASS":choices.some(e=>e.status==="ACTION_REQUIRED")?"ACTION_REQUIRED":"UNKNOWN","Purchase-choice configuration",choices.length?"Per-choice configuration and inventory evidence is shown below. This is not whole-listing coverage.":"No verified current exact choice evidence is available.",choices.some(e=>e.status==="ACTION_REQUIRED")?{tab:"setup"}:{catalog:true});
 if(s.limited)add("evidence-limit","etsy","UNKNOWN","Association evidence limit","More than 100 saved associations exist. This bounded assessment cannot claim complete readiness.",{catalog:true});
 return {target,version:{id:version.id,number:version.versionNumber,revision:version.revision},status:aggregateReadiness(checks),checks,choices};
}
export function assessProductReadiness(s:ReadinessSnapshot){const published=assessTarget(s,"PUBLISHED");return {contractVersion:"product-readiness/v1" as const,productId:s.productId,storeId:s.storeId,published,associations:{status:published.version?aggregateReadiness(published.checks.filter(c=>c.group==="etsy")):"ACTION_REQUIRED" as ReadinessStatus},draft:assessTarget(s,"DRAFT"),evidence:{limited:s.limited,scope:"Saved revision-matched catalog evidence; not live Etsy availability"},runtime:{status:"NOT_VERIFIED" as const,explanation:"AI provider, object storage, Etsy availability, future customer answers, generation, PDF rendering and delivery were not executed or checked."}};}
export type ProductReadiness=ReturnType<typeof assessProductReadiness>;
