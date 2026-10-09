import Link from "next/link";
import type {ReactNode} from "react";
import type {Answer} from "@/modules/intake/contracts";
import type {ReadingOperations} from "@/modules/orders/operations";
import {CustomerInformation} from "./customer-information";
import {Badge} from "./ui";
import {Icon} from "./icon";
import {InformationPopover} from "./information-popover";
import {displayDate} from "./seller-status";
import {customerIdentity} from "@/modules/orders/customer";
import {shortOrderStatus} from "./order-list";
import styles from "./order-detail.module.css";
export type DetailReading={id:string;index:number;status:string;revision:number;answers:Answer[];queue?:string;generation?:{status:string;revision:number;date:string};operations?:ReadingOperations;workflow?:ReactNode};
export type DetailView={reference:string;customer:string;date:string;status:string;payment:string;sample?:boolean;items:{id:string;title:string;quantity:number;variations:string[];answers:Answer[];readings:DetailReading[]}[]};
export function compactReadingStatus(reading:DetailReading){
 const operations=reading.operations;
 if(operations?.issues.some(i=>i.key==="canceled"))return "Canceled";
 if(operations?.output==="Stale generation"||reading.generation&&reading.generation.revision!==reading.revision)return "Stale";
 if(operations?.output==="Processing"||operations?.output==="Retry wait")return "Processing";
 if(operations?.output==="Generation failed")return "Failed";
 if(operations?.issues.some(i=>i.key==="missing_input"||i.key==="unusable_input"||i.key==="quantity_context"))return "Needs Information";
 if(operations?.issues.some(i=>/configuration|setup|unmapped|paused/.test(i.key)))return "Needs Setup";
 if(operations?.issues.length)return "Needs Attention";
 if(operations?.output==="Approved reading")return "Approved";
 if(operations?.output==="Current generated reading")return "Generated";
 return shortOrderStatus(reading.status)==="Generated"?"Generated":reading.status==="Canceled"?"Canceled":"Pending";
}
export function orderSummary(data:DetailView){
 const readings=data.items.flatMap(item=>item.readings);
 return {readings:readings.length,generated:readings.filter(r=>r.operations?.output==="Current generated reading"||r.operations?.output==="Approved reading").length,attention:readings.filter(r=>r.operations?.issues.length).length};
}
export function OrderDetailView({data,backHref}:{data:DetailView;backHref:string}){
 const readings=data.items.flatMap(i=>i.readings),summary=orderSummary(data);
 const exceptions=readings.filter(r=>r.operations?.issues.length).sort((a,b)=>a.operations!.next.priority-b.operations!.next.priority);
 const issueGroups=new Map<string,{issue:ReadingOperations["next"];readings:DetailReading[]}>();
 for(const reading of exceptions)for(const issue of reading.operations!.issues){const group=issueGroups.get(issue.key);if(group)group.readings.push(reading);else issueGroups.set(issue.key,{issue,readings:[reading]});}
 const generationLabel=(state:string)=>({SUCCEEDED:"Generated",FAILED:"Failed",PROCESSING:"Processing"}[state]??"Recorded");
 const sampleLabel=data.sample?<p className={styles.muted}>SAMPLE DATA · Read-only fictional information. Workflow actions are disabled.</p>:null;
 const details=(reading:DetailReading,title:string)=><>
  {sampleLabel}<h3>{title} · Reading {reading.index}</h3>
  <p>{reading.operations?.output??reading.status}</p>
  <p className={styles.muted}>Customer information revision {reading.revision}</p>
  <h4>Current Customer Information</h4>{reading.answers.length?<CustomerInformation answers={reading.answers}/>:<p>No customer information provided.</p>}
  {reading.generation&&<p>Latest generation: {generationLabel(reading.generation.status)} · revision {reading.generation.revision} · {displayDate(new Date(reading.generation.date))}</p>}
  {reading.generation&&reading.generation.revision!==reading.revision&&<p>Earlier information — result is stale</p>}
  {reading.queue&&<p>Production: {reading.queue}</p>}
  {reading.operations?.issues.map(issue=><div key={issue.key}><h4>{issue.title}</h4><p>{issue.reason}</p>{issue.action&&!issue.action.href.startsWith("#")&&(data.sample?<button type="button" disabled>{issue.action.label} · sample only</button>:<Link href={issue.action.href} className="button secondary">{issue.action.label}</Link>)}</div>)}
  {!reading.operations?.issues.length&&<p>{reading.operations?.next.reason}</p>}<p>{reading.operations?.pdfNote}</p>
  <h4>Output status</h4><p>Generated results do not indicate approval, PDF completion or delivery.</p>
  {!data.sample&&reading.workflow}
 </>;
 return <div className={styles.page}>
  <Link className="back-link" href={backHref}>Back to {data.sample?"Sample Orders":"Orders"}</Link>
  <header className={styles.header}><div><h1>Order #{data.reference}</h1><p>{customerIdentity(data.customer)} <span>· Purchased {displayDate(new Date(data.date))} UTC</span></p></div><Badge tone={data.status==="Generated"?"good":summary.attention?"warning":"neutral"}>{shortOrderStatus(data.status)}</Badge></header>
  {data.sample&&<div className={styles.preview} role="status"><Badge>SAMPLE DATA</Badge><span>Read-only development preview. Workflow actions are disabled.</span><Link href="/orders">Exit Preview</Link></div>}
  <section className={styles.panel} aria-labelledby="order-summary"><h2 id="order-summary">Order Summary</h2>
   <div className={styles.metrics}>
    <div><Icon name="layers"/><strong>{summary.readings}</strong><span>Readings</span></div>
    <div><Icon name="check"/><strong>{summary.generated}</strong><span>Generated</span></div>
    <div className={summary.attention?styles.attentionMetric:undefined}><Icon name="attention"/><strong>{summary.attention}</strong><span>Needs Attention</span></div>
    <div><Icon name="payment"/><span>Payment</span><strong>{data.payment}</strong></div>
   </div>
   <div className={styles.summaryActions}>
    <InformationPopover dialog label="View Purchase Information" triggerContent={<><Icon name="document"/>View Purchase Information</>}>
     {sampleLabel}<p>Original purchase · {displayDate(new Date(data.date))} UTC</p>
     <p className={styles.muted}>Original purchase answers are read-only. Later customer-information edits appear in Reading Details.</p>
     {data.items.map(item=><article key={item.id} className={styles.purchase}><h3 dir="auto">{item.title||"No retained product information"}</h3><p>Quantity {item.quantity} · {item.readings.length} reading units</p>{item.variations.map((v,i)=><p key={i} dir="auto">{v}</p>)}{item.answers.length?<CustomerInformation answers={item.answers}/>:<p>No original personalization retained.</p>}</article>)}
    </InformationPopover>
    <InformationPopover dialog label="View Activity" triggerContent={<><Icon name="history"/>View Activity</>}>
     {sampleLabel}<p className={styles.muted}>Partial activity: purchase and latest generation evidence only. Only recorded events are shown.</p>
     <p>Purchase · {displayDate(new Date(data.date))} UTC</p>{readings.filter(r=>r.generation).map(r=><p key={r.id}>{data.items.find(i=>i.readings.some(reading=>reading.id===r.id))?.title} · Reading {r.index} · {generationLabel(r.generation!.status)} · Recorded {displayDate(new Date(r.generation!.date))} UTC</p>)}
    </InformationPopover>
   </div>
  </section>
  {exceptions.length>0&&<section className={`${styles.panel} ${styles.attention}`} aria-labelledby="action-required"><h2 id="action-required"><Icon name="attention"/>Action Required</h2>
   {[...issueGroups.values()].sort((a,b)=>a.issue.priority-b.issue.priority).map(({issue,readings:affected})=><div className={styles.exception} key={issue.key}><h3>{issue.title}</h3><p>{issue.reason.split(". ")[0].replace(/\.$/,"")}.</p><div className={styles.affected}>{affected.map(reading=><Link key={reading.id} href={`#reading-${reading.id}`}>Reading {reading.index} · {data.items.find(i=>i.readings.some(r=>r.id===reading.id))?.title}</Link>)}</div></div>)}
  </section>}
  <section className={styles.panel} aria-labelledby="purchased-readings"><h2 id="purchased-readings">Purchased Readings</h2>
   {data.items.map(item=><article key={item.id} className={styles.group} data-purchased-line={item.id}>
    <div className={styles.groupHeader}><h3 dir="auto">{item.title||"No retained product information"}</h3><span className={styles.muted}>Quantity {item.quantity}</span></div>
    {item.variations.length>0&&<p className={styles.muted} dir="auto">{item.variations.join(" · ")}</p>}
    {item.readings.map(reading=>{const next=reading.operations?.next,localAction=next?.action?.href.startsWith("#"),label=next?.action?.label==="Complete customer information"?"Complete Info":next?.action?.label==="Open Reading Preparation"?"Open Preparation":next?.action?.label;
     return <div key={reading.id} id={`reading-${reading.id}`} className={styles.readingRow}>
      <strong>Reading {reading.index}</strong><Badge tone={reading.operations?.issues.length?"warning":/Generated|Approved/.test(compactReadingStatus(reading))?"good":"neutral"}>{compactReadingStatus(reading)}</Badge>
      <div className={styles.readingActions}>
       {next?.action&&(data.sample?<button type="button" className="button secondary" disabled aria-label={`${label} — Reading ${reading.index} — sample only`}>{label}</button>:localAction?<InformationPopover dialog label={`${label} — Reading ${reading.index} — ${item.title}`} triggerContent={label}>{details(reading,item.title)}</InformationPopover>:<Link className="button secondary" href={next.action.href} prefetch={false} aria-label={`${label} — Reading ${reading.index} — ${item.title}`}>{label}</Link>)}
       {reading.operations?.pdf&&(data.sample?<button disabled type="button" className="button secondary">View PDF · sample only</button>:<a className="button secondary" href={reading.operations.pdf.href} target="_blank" rel="noopener noreferrer" aria-label={`View ${reading.operations.pdf.historical?"historical ":""}PDF — Reading ${reading.index} — opens a new tab`}>View PDF</a>)}
       {(!localAction||data.sample)&&<InformationPopover dialog label={`View Details — Reading ${reading.index} — ${item.title}`} triggerContent="View Details">{details(reading,item.title)}</InformationPopover>}
      </div>
     </div>;
    })}
    {!item.readings.length&&<p className={styles.muted}>No reading units recorded.</p>}
   </article>)}
   {!data.items.length&&<p className={styles.muted}>No retained purchased items.</p>}
  </section>
 </div>;
}
