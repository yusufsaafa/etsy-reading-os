import Link from "next/link";
import type {ReactNode} from "react";
import type {Answer} from "@/modules/intake/contracts";
import type {ReadingOperations} from "@/modules/orders/operations";
import {CustomerInformation} from "./customer-information";
import {Badge} from "./ui";
import {InformationPopover} from "./information-popover";
import {displayDate} from "./seller-status";
import {customerIdentity} from "@/modules/orders/customer";
import styles from "./order-detail.module.css";
export type DetailReading={id:string;index:number;status:string;revision:number;answers:Answer[];queue?:string;generation?:{status:string;revision:number;date:string};operations?:ReadingOperations;workflow?:ReactNode};
export type DetailView={reference:string;customer:string;date:string;status:string;payment:string;sample?:boolean;items:{id:string;title:string;quantity:number;variations:string[];answers:Answer[];readings:DetailReading[]}[]};
export function OrderDetailView({data,backHref}:{data:DetailView;backHref:string}){
 const readings=data.items.flatMap(i=>i.readings);
 const generationLabel=(state:string)=>({SUCCEEDED:"Generated",FAILED:"Failed",PROCESSING:"Preparing"}[state]??"Recorded");
 const productFor=(id:string)=>data.items.find(item=>item.readings.some(r=>r.id===id));
 const context=(reading:DetailReading)=>`Reading ${reading.index} · ${productFor(reading.id)?.title||"Product context unavailable"}`;
 const actionable=readings.filter(r=>r.operations).sort((a,b)=>a.operations!.next.priority-b.operations!.next.priority);
 return <div className={styles.page}>
  <Link className="back-link" href={backHref}>← {data.sample?"Back to Sample Orders":"Back to Orders"}</Link>
  <header className={styles.header}><div><h1>Order #{data.reference}</h1><p>{customerIdentity(data.customer)} <span>· Purchased {displayDate(new Date(data.date))} UTC</span></p></div><Badge tone={data.status==="Generated"?"good":/needed|attention|updated|refund/i.test(data.status)?"warning":"neutral"}>{data.status}</Badge></header>
  {data.sample&&<div className={styles.preview} role="status"><Badge>SAMPLE DATA</Badge><span>Read-only development preview. Workflow actions are disabled.</span><Link href="/orders">Exit Preview</Link></div>}
  <div className={styles.grid}>
   <section className={`${styles.panel} ${styles.actionCenter}`} aria-labelledby="order-action-center">
    <h2 id="order-action-center">Action Center</h2>
    {actionable.map((reading,i)=>{const next=reading.operations!.next;return <div key={reading.id} className={styles.action}>
     <Link href={`#reading-${reading.id}`} className={styles.muted}>{context(reading)}</Link>
     <h3>{i===0?"Next step: ":""}{next.title}</h3>
     {data.sample&&<p className={styles.muted}>Sample only · {next.reason}</p>}
     {next.action&&(data.sample?<button type="button" className="button secondary" disabled aria-label={`${next.action.label} — ${context(reading)} — sample only`}>{next.action.label}</button>:<Link className="button secondary" href={next.action.href} prefetch={false} aria-label={`${next.action.label} — ${context(reading)}`}>{next.action.label}</Link>)}
     {!next.action&&!data.sample&&<p className={styles.muted}>{next.reason}</p>}
    </div>;})}
    {!actionable.length&&<p className={styles.muted}>No reading action is available.</p>}
   </section>
   <div className={styles.main}>
    <section className={styles.panel}><h2>Purchased Items</h2>{data.items.map(item=><article key={item.id} className={styles.item}><h3 dir="auto">{item.title||"No retained product information"}</h3><p className={styles.muted}>Quantity {item.quantity} · {item.readings.length} reading units</p>{item.variations.map((v,i)=><p key={i} dir="auto">{v}</p>)}{item.answers.length>0&&<><h4>Original purchase information</h4><CustomerInformation answers={item.answers}/></>}</article>)}{!data.items.length&&<p>No retained purchased items.</p>}</section>
    <section className={styles.panel}><h2>Reading Information</h2>{readings.map(reading=><article key={reading.id} id={`reading-${reading.id}`} className={styles.item}>
     <div className={styles.readingHeader}><h3>Reading {reading.index}{(productFor(reading.id)?.quantity??0)>1?` of ${productFor(reading.id)?.quantity}`:""}</h3><Badge>{reading.operations?.output??reading.status}</Badge></div>
     <p className={styles.muted} dir="auto">{productFor(reading.id)?.title||"Product context unavailable"}</p>
     <p className={styles.muted}>Customer information revision {reading.revision}</p>
     {reading.operations&&<>
      {reading.operations.issues.length>0&&<ul className={styles.issues} aria-label={`Issues — ${context(reading)}`}>{reading.operations.issues.map(issue=><li key={issue.key}><strong>{issue.title}</strong><p>{issue.reason}</p>{issue.action&&(data.sample?<button className="button secondary" disabled type="button">{issue.action.label} · sample only</button>:<Link className="button secondary" href={issue.action.href} aria-label={`${issue.action.label} — ${context(reading)}`}>{issue.action.label}</Link>)}</li>)}</ul>}
      <div className={styles.outputs}>
       {reading.operations.pdf&&(data.sample?<button className="button secondary" disabled type="button">View PDF · sample only</button>:<a className="button secondary" href={reading.operations.pdf.href} target="_blank" rel="noopener noreferrer" aria-label={`View ${reading.operations.pdf.historical?"historical ":""}PDF — ${context(reading)} — opens a new tab`}>View PDF</a>)}
       <span className={styles.muted}>{reading.operations.pdfNote}</span>
      </div>
     </>}
     <h4>Customer Information</h4>{reading.answers.length?<CustomerInformation answers={reading.answers}/>:<p className={styles.muted}>No customer information provided.</p>}
     {reading.generation&&reading.generation.revision!==reading.revision&&<p className={styles.muted}>Earlier information — result is stale</p>}
     {reading.workflow}
     {data.sample&&reading.operations?.next.action&&!reading.operations.issues.some(issue=>issue.action?.href===reading.operations?.next.action?.href)&&<button type="button" className="button secondary" disabled>{reading.operations.next.action.label} · sample only</button>}
    </article>)}{!readings.length&&<p>No reading units recorded.</p>}</section>
   </div>
   <aside className={styles.context} aria-label="Order operational context">
    <section className={styles.panel}><h2>Order Status</h2><p>{data.payment}</p><InformationPopover label="Output status"><p>Generated results do not indicate approval, PDF completion or delivery. Available PDFs are retained output; opening them does not deliver an order.</p></InformationPopover></section>
    <section className={styles.panel}><h2>Production Overview</h2>{readings.filter(r=>r.queue).map(r=><p key={r.id}>Reading {r.index} · {r.queue}</p>)}{!readings.some(r=>r.queue)&&<p className={styles.muted}>No current queue evidence.</p>}</section>
    <section className={styles.panel}><h2>Recorded Activity</h2><p>Purchase · {displayDate(new Date(data.date))}</p>{readings.filter(r=>r.generation).map(r=><p key={r.id}>Reading {r.index} · {generationLabel(r.generation!.status)} · Recorded {displayDate(new Date(r.generation!.date))}</p>)}<p className={styles.muted}>Purchase and latest generation evidence only.</p></section>
   </aside>
  </div>
 </div>;
}
