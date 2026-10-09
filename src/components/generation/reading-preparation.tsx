import Link from "next/link";
import { database } from "@/db/client";
import type { Scope } from "@/modules/intake/contracts";
import { generationHistory, generationAccounting } from "@/modules/generation/service";
import { sellerStyleData } from "@/modules/seller-style/service";
import { publishErrors, styleConfiguration } from "@/modules/seller-style/contracts";
import { PrepareForm } from "./prepare-form";
export async function ReadingPreparation({scope,unitId,eligible,currentRevision,productionStatus,reviewHref,approved=false}:{scope:Scope;unitId:string;eligible:boolean;currentRevision:number;productionStatus?:string;reviewHref?:string;approved?:boolean}) {
 if(reviewHref)return <div className="reading-preparation"><Link className="button" href={reviewHref} prefetch={false}>{approved?"View reading":"Review reading"}</Link></div>;
 const [latest]=await generationHistory(database(),scope,unitId,1);
 if(latest){
  const {attempts}=await generationAccounting(database(),scope,latest.id);
  return <div className="reading-preparation">
   {latest.customerRevision!==currentRevision&&<p className="small muted">This saved reading uses the earlier customer information. Review the updated information before continuing.</p>}
   {latest.status==="PROCESSING"&&<p role="status" className="small muted">{productionStatus==="FAILED"?"This preparation needs attention. Contact support before another attempt.":"Preparing. Refresh to check progress."}</p>}
   {latest.status==="FAILED"&&(productionStatus==="WAITING"||productionStatus==="PROCESSING")?<p role="status" className="small muted">Preparation is waiting to continue.</p>:latest.status==="FAILED"&&<><p className="small muted">We couldn’t prepare this reading.</p>{attempts.at(-1)?.ambiguous?<p className="small muted">Contact support before another attempt.</p>:eligible&&<PrepareForm unitId={unitId} retryGenerationId={latest.id}/>}</>}
   {latest.result&&<p className="small muted">This reading is not available for review. Check its information and status before continuing.</p>}
  </div>;
 }
 if(!eligible)return null;
 if(process.env.AI_PROVIDER!=="fake"&&process.env.AI_PROVIDER!=="google")return <p className="small muted">Preparation is not enabled for this store yet.</p>;
 const profile=await sellerStyleData(database(),scope),style=styleConfiguration.safeParse(profile.active?.configuration);
 if(!profile.seller||!style.success||publishErrors(style.data).length)return <p className="small muted"><Link href="/settings/profile">Complete your profile and apply a style</Link> before preparing this reading.</p>;
 return <PrepareForm unitId={unitId}/>;
}
