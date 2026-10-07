"use client";
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
export function ProductPicker({ products, initialSelection }: { products: { externalId: string; title: string; state: string; configured?: boolean }[]; initialSelection: string[] }) {
  const [query, setQuery] = useState("");
  const [filter,setFilter]=useState("all");
  const [selected, setSelected] = useState(() => new Set(initialSelection.filter(id => products.some(p => p.externalId === id))));
  const [state, action] = useActionState(selectProductsAction, {});
  const visible = products.filter(p => p.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (filter === "all" || p.state === filter));
  const active = products.filter(p => p.state === "active");
  const toggle = (id: string) => setSelected(old => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  return <form action={action} className={styles.picker}>
    <label className={`search-field ${styles.search}`} htmlFor="product-search"><span className="sr-only">Search products</span><Icon name="search"/><input id="product-search" type="search" placeholder="Search products" value={query} onChange={e => setQuery(e.target.value)}/></label>
    <label className={styles.statusFilter}>Listing status<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All listings</option>{[...new Set(products.map(p=>p.state))].map(status=><option key={status} value={status}>{status.replaceAll("_"," ")}</option>)}</select></label>
    <div className={styles.selectionToolbar}><span>{selected.size} selected</span><div><button type="button" className="button ghost" onClick={() => setSelected(new Set(active.slice(0,1000).map(p => p.externalId)))}>Select all</button><button type="button" className="button ghost" onClick={() => setSelected(new Set())} disabled={!selected.size}>Deselect all</button></div></div>
    <div className={styles.list}>
      {visible.map(product => <label className={styles.productRow} key={product.externalId}><span className={styles.thumbnail}><Icon name="image"/></span><span className={styles.productInfo}><strong>{product.title}</strong><span>{`${product.state.replaceAll("_"," ")} on Etsy`}</span></span><Badge>{product.configured ? "Configured" : selected.has(product.externalId) ? "Needs setup" : "Not selected"}</Badge><input type="checkbox" checked={selected.has(product.externalId)} disabled={!selected.has(product.externalId) && (product.state !== "active" || selected.size >= 1000)} onChange={() => toggle(product.externalId)} aria-label={`Select ${product.title}`}/></label>)}
      {!visible.length && <div className={styles.empty}><h2>No matching products</h2><p>Try another product name.</p></div>}
    </div>
    {[...selected].map(id => <input key={id} type="hidden" name="listing" value={id}/>)}
    <ErrorMessage {...state}/><div className={styles.selectionFooter}><p>Selection only saves the products you want to configure. Choose up to 1,000 active listings. Products still need configuration before fulfillment can begin.</p><Submit disabled={!selected.size || [...selected].some(id=>!active.some(p=>p.externalId===id))} pendingText="Saving your products…">Continue to product setup<Icon name="arrow"/></Submit></div>
  </form>;
}
