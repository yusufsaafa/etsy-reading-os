import Link from "next/link";
import { database } from "@/db/client";
import type { Scope } from "@/modules/intake/contracts";
import { generationHistory, generationAccounting } from "@/modules/generation/service";
import { sellerStyleData } from "@/modules/seller-style/service";
import { publishErrors, styleConfiguration } from "@/modules/seller-style/contracts";
import { PrepareForm } from "./prepare-form";
export async function ReadingPreparation({scope,unitId,eligible,currentRevision}:{scope:Scope;unitId:string;eligible:boolean;currentRevision:number}) {
 const [latest]=await generationHistory(database(),scope,unitId);
 if(latest){
  const {attempts}=await generationAccounting(database(),scope,latest.id);
  return <div className="reading-preparation">
   {latest.customerRevision!==currentRevision&&<p className="small muted">This saved reading uses the earlier customer information. Review the updated information before continuing.</p>}
   {latest.status==="PROCESSING"&&<p role="status" className="small muted">Preparing. Refresh to check progress.</p>}
   {latest.status==="FAILED"&&<><p className="small muted">We couldn’t prepare this reading.</p>{attempts.at(-1)?.ambiguous?<p className="small muted">Contact support before another attempt.</p>:eligible&&<PrepareForm unitId={unitId} retryGenerationId={latest.id}/>}</>}
   {latest.result&&<details open><summary>Prepared reading</summary>{latest.result.sections.map(s=><section key={s.sectionId}><h4>{s.title}</h4><p dir="auto" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{s.content}</p></section>)}</details>}
  </div>;
 }
 if(!eligible)return null;
 if(process.env.AI_PROVIDER!=="fake"&&process.env.AI_PROVIDER!=="google")return <p className="small muted">Preparation is not enabled for this store yet.</p>;
 const profile=await sellerStyleData(database(),scope),style=styleConfiguration.safeParse(profile.active?.configuration);
 if(!profile.seller||!style.success||publishErrors(style.data).length)return <p className="small muted"><Link href="/settings/profile">Complete your profile and apply a style</Link> before preparing this reading.</p>;
 return <PrepareForm unitId={unitId}/>;
}
