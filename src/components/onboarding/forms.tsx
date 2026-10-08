"use client";
import Image from "next/image";
import {safeListingThumbnail} from "@/modules/etsy/listing-thumbnail";
import {productPage,selectProductPage,PRODUCTS_PER_PAGE,type PickerProduct} from "./product-picker-model";
import { useActionState, useState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Badge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { createStoreAction, selectProductsAction, type FormState } from "@/app/onboarding/actions";
import styles from "./onboarding.module.css";
function Submit({ children, pendingText, disabled = false }: { children: React.ReactNode; pendingText: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <Button disabled={disabled || pending} aria-busy={pending}>{pending ? pendingText : children}</Button>;
}
function ErrorMessage({ error }: FormState) { return error ? <p className="error-message" role="alert">{error}</p> : null; }
export function StoreForm() {
  const [state, action] = useActionState(createStoreAction, {});
  return <form action={action} className={styles.form}><label htmlFor="store-name">Store name<input id="store-name" name="name" autoComplete="organization" placeholder="Reading Studio" required maxLength={100} aria-describedby="store-name-help" /></label><p className={styles.helper} id="store-name-help">This is how your store will appear inside Reading OS. You can change it later.</p><ErrorMessage {...state}/><Submit pendingText="Creating your store…">Continue<Icon name="arrow"/></Submit></form>;
}
export function ActionForm({ action: serverAction, label, pendingText, secondary = false }: { action: (state: FormState, form: FormData) => Promise<FormState>; label: string; pendingText: string; secondary?: boolean }) {
  const [state, action] = useActionState(serverAction, {});
  return <form action={action} className={styles.actionForm}><ErrorMessage {...state}/>{secondary ? <SecondarySubmit label={label} pendingText={pendingText}/> : <Submit pendingText={pendingText}>{label}<Icon name="arrow"/></Submit>}</form>;
}
function SecondarySubmit({label, pendingText}: {label:string;pendingText:string}) { const {pending}=useFormStatus();return <Button className="secondary" disabled={pending} aria-busy={pending}>{pending?pendingText:label}</Button>; }
export function ImportRefresh() {
  const router = useRouter();
  useEffect(() => { const timer = setInterval(() => router.refresh(), 4000); return () => clearInterval(timer); }, [router]);
  return <p className={styles.importing} role="status"><span className={styles.spinner} aria-hidden="true"/>Importing your Etsy products…</p>;
}
function ListingThumbnail({url}:{url?:string|null}) {
  const [failed,setFailed]=useState(false);const safe=safeListingThumbnail(url);
  return <span className={styles.thumbnail}>{safe&&!failed?<Image src={safe} alt="" width={44} height={44} unoptimized referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<Icon name="image"/>}</span>;
}
export function ProductPicker({ products, initialSelection }: { products: PickerProduct[]; initialSelection: string[] }) {
  const [query, setQuery] = useState("");
  const [filter,setFilter]=useState("all");
  const [page,setPage]=useState(1);
  const [selected, setSelected] = useState(() => new Set(initialSelection.filter(id => products.some(p => p.externalId === id))));
  const [state, action] = useActionState(selectProductsAction, {});
  const {visible,total,pages,current}=productPage(products,query,filter,page);
  const statuses=["active","inactive","sold_out","draft","expired"].filter(status=>products.some(p=>p.state===status));
  const active = products.filter(p => p.state === "active");
  const toggle = (id: string) => setSelected(old => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  return <form action={action} className={styles.picker}>
    <p className={styles.listingCount}>{products.length} Etsy listings</p>
    <div className={styles.discoveryToolbar}><label className={`search-field ${styles.search}`} htmlFor="product-search"><span className="sr-only">Search products</span><Icon name="search"/><input id="product-search" type="search" placeholder="Search Etsy listings…" value={query} onChange={e => {setQuery(e.target.value);setPage(1);}}/></label>
    <div className={styles.statusFilters} role="group" aria-label="Listing status">
      {["all",...statuses].map(status=><button key={status} type="button" className="button ghost" aria-pressed={filter===status} onClick={()=>{setFilter(status);setPage(1);}}>{status==="all"?"All":status.replaceAll("_"," ").replace(/^./,c=>c.toUpperCase())} ({status==="all"?products.length:products.filter(p=>p.state===status).length})</button>)}
    </div></div>
    <div className={styles.selectionToolbar}><span aria-live="polite">{selected.size} selected</span><div><button type="button" className="button ghost" onClick={()=>setSelected(old=>selectProductPage(old,visible,true))}>Select page</button><button type="button" className="button ghost" onClick={()=>setSelected(old=>selectProductPage(old,visible,false))} disabled={!visible.some(p=>selected.has(p.externalId))}>Deselect page</button></div></div>
    <div className={styles.list}>
      {visible.map(product => <article className={styles.productRow} key={product.externalId}><ListingThumbnail key={product.thumbnailUrl??"placeholder"} url={product.thumbnailUrl}/><span className={styles.productInfo}><label htmlFor={"choose-"+product.externalId}><strong>{product.title}</strong></label><span className={styles.etsyStatus}><span aria-hidden="true" className={product.state==="active"?styles.activeDot:styles.inactiveDot}/>{product.state.replaceAll("_"," ").replace(/^./,c=>c.toUpperCase())} on Etsy</span></span>
      {product.configured?<span className={styles.setupReady}>Ready</span>:selected.has(product.externalId)?<details className={styles.setupHelp}><summary aria-label="Setup required. This listing is selected for Reading OS, but its product setup must be completed before orders can be prepared.">Setup required <span aria-hidden="true">ⓘ</span></summary><p>This listing is selected for Reading OS, but its product setup must be completed before orders can be prepared.</p></details>:<span className={styles.notSelected}>Not selected</span>}
      <input id={"choose-"+product.externalId} type="checkbox" checked={selected.has(product.externalId)} disabled={!selected.has(product.externalId) && (product.state !== "active" || selected.size >= 1000)} onChange={() => toggle(product.externalId)} aria-label={`Select ${product.title}`}/></article>)}
      {!visible.length && <div className={styles.empty}><h2>No matching products</h2><p>Try another product name.</p></div>}
    </div>
    <div className={styles.pagination}><span>{total?`Showing ${(current-1)*PRODUCTS_PER_PAGE+1}–${Math.min(current*PRODUCTS_PER_PAGE,total)} of ${total}`:"Showing 0 listings"}</span><nav aria-label="Product pages"><button type="button" className="button ghost" aria-label="Previous page" disabled={current===1} onClick={()=>setPage(current-1)}>←</button>{(pages<=7?Array.from({length:pages},(_,i)=>i+1):Array.from(new Set([1,current-1,current,current+1,pages].filter(n=>n>=1&&n<=pages)))).sort((a,b)=>a-b).map((n,i,all)=><span key={n}>{i>0&&n>all[i-1]+1&&<span aria-hidden="true">…</span>}<button type="button" className="button ghost" aria-label={`Page ${n}`} aria-current={n===current?"page":undefined} onClick={()=>setPage(n)}>{n}</button></span>)}<button type="button" className="button ghost" aria-label="Next page" disabled={current===pages} onClick={()=>setPage(current+1)}>→</button></nav></div>
    {[...selected].map(id => <input key={id} type="hidden" name="listing" value={id}/>)}
    <ErrorMessage {...state}/><div className={styles.selectionFooter}><p>Selection only saves the products you want to configure. Choose up to 1,000 active listings. Products still need configuration before fulfillment can begin.</p><Submit disabled={!selected.size || [...selected].some(id=>!active.some(p=>p.externalId===id))} pendingText="Saving your products…">Continue to product setup<Icon name="arrow"/></Submit></div>
  </form>;
}
