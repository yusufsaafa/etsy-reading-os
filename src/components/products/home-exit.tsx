"use client";
import {useActionState,useEffect,useRef} from "react";
import Link from "next/link";
import {checkProductOnboardingExit,finishProductOnboarding} from "./actions";
import styles from "./setup.module.css";
export function HomeExit({productId}:{productId:string}){
 const [state,action,pending]=useActionState(checkProductOnboardingExit,{});
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(state.remaining&&dialog.current&&!dialog.current.open)dialog.current.showModal();},[state]);
 return <div><form action={action}><input type="hidden" name="productId" value={productId}/><button ref={trigger} disabled={pending} className="button">{pending?"Checking purchase options…":"Continue to Home"}</button></form>{state.error&&<p role="alert">{state.error}</p>}
 <dialog ref={dialog} className={styles.exitDialog} aria-labelledby="exit-title" aria-describedby="exit-description" onClose={()=>trigger.current?.focus()}>
 <h2 id="exit-title">You still have {state.remaining} purchase {state.remaining===1?"option":"options"} to set up</h2>
 <p id="exit-description">Orders for these options cannot be automatically prepared until you configure them.</p>
 <p className={styles.caption}>{state.active} active · {state.draft} draft · {state.unconfigured} not configured</p>
 <div className={styles.controls}><Link className="button" href={state.setupHref??"/onboarding/products/setup"}>Set up remaining options</Link><form action={finishProductOnboarding}><button className="button secondary">Continue to Home</button></form><button type="button" className="button ghost" onClick={()=>dialog.current?.close()}>Cancel</button></div>
 </dialog></div>;
}
