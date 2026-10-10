"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {Icon} from "../icon";
export function syncFeedback(value:{status?:string;hasMore?:boolean;issues?:string[];retryAfterSeconds?:number;error?:string}) {
 if(value.error==="BUSY")return "A catalog sync is already running. Reload to check its recorded status.";
 if(value.error)return "Catalog sync could not complete. Saved catalog data is unchanged. Check your connection before trying again.";
 if(value.issues?.includes("RATE_LIMIT"))return `Etsy has limited requests. Wait ${value.retryAfterSeconds??60} seconds before explicitly continuing. Saved data is retained.`;
 if(value.issues?.includes("AUTHORIZATION"))return "Check your Etsy connection in Settings before trying again. Saved data is retained.";
 if(value.status==="SUCCEEDED")return "Catalog sync completed. Saved listings and purchase options have been updated.";
 if(value.status==="PARTIAL")return value.hasMore?"This batch completed with more catalog data to process. Choose Continue Sync when you are ready.":"Catalog sync is partial. Some data could not be verified; saved data is retained. Review catalog status before trying again.";
 return "Catalog sync failed. Saved data is retained. Review your connection and catalog status.";
}
export function CatalogSync({state,hasMore,isRunning=false}:{state:string;hasMore:boolean;isRunning?:boolean}) {
 const router=useRouter(),[pending,setPending]=useState(false),[message,setMessage]=useState(""),[continuation,setContinuation]=useState<boolean|null>(null),[blockedUntil,setBlockedUntil]=useState(0);
 async function sync(){
  if(pending)return;
  if(Date.now()<blockedUntil){setMessage(`Etsy has limited requests. Wait ${Math.ceil((blockedUntil-Date.now())/1000)} seconds before explicitly continuing.`);return;}
  setPending(true);setMessage("");
  try {
   const response=await fetch("/api/catalog",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
   const result=await response.json();setMessage(syncFeedback(result));
   if(response.ok){setContinuation(Boolean(result.hasMore));if(result.issues?.includes("RATE_LIMIT"))setBlockedUntil(Date.now()+(result.retryAfterSeconds??60)*1000);router.refresh();}
  }catch{setMessage("The sync result could not be confirmed. Reload to check its recorded status before trying again.");}
  finally{setPending(false);}
 }
 return <div><button type="button" className="button secondary" onClick={sync} disabled={pending||isRunning} aria-busy={pending}><Icon name="history"/>{pending?"Synchronizing...":isRunning?"Sync in progress":(continuation??hasMore)?"Continue Sync":"Sync Etsy Catalog"}</button>{message&&<p role="status" className="small muted">{message}</p>}</div>;
}
