"use client";
import {useEffect,useRef,useState,type ReactNode} from "react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {Navigation} from "./navigation";

function initials(value:string){return Array.from(value.trim().split(/\s+/).map(word=>Array.from(word)[0]??"").slice(0,2).join("")).join("").toLocaleUpperCase();}
function Brand(){return <Link href="/" className="shell-brand"><span className="shell-brand-mark" aria-hidden="true"><i/><i/></span><strong>Reading OS</strong></Link>;}
export function ApplicationFrame({storeName,accountName,demo,children}:{storeName:string;accountName:string;demo:boolean;children:ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),mobile=useRef(false);
 const [expanded,setExpanded]=useState(false);const path=usePathname();
 function close(){if(mobile.current&&dialog.current?.open){dialog.current.close();setExpanded(false);trigger.current?.focus();}}
 useEffect(()=>{
  const media=window.matchMedia("(max-width: 980px)");
  function sync(){const element=dialog.current;if(!element)return;mobile.current=media.matches;if(element.open)element.close();setExpanded(false);if(!media.matches)element.show();}
  sync();media.addEventListener("change",sync);return()=>media.removeEventListener("change",sync);
 },[]);
 useEffect(()=>{close();},[path]); // navigation dismisses the modal, without changing routing
 useEffect(()=>{if(!expanded)return;const previous=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{document.body.style.overflow=previous;};},[expanded]);
 function open(){if(mobile.current&&dialog.current&&!dialog.current.open){dialog.current.showModal();setExpanded(true);}}
 return <div className="app-shell shell-frame">
  <a href="#main-content" className="skip-link">Skip to content</a>
  <header className="shell-mobile-header"><button ref={trigger} type="button" aria-label="Open navigation" aria-controls="application-navigation" aria-expanded={expanded} onClick={open}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><Brand/><span className="shell-header-store" dir="auto">{storeName}</span></header>
  <dialog ref={dialog} open id="application-navigation" className="shell-sidebar" aria-label="Workspace navigation" onCancel={event=>{event.preventDefault();close();}} onClose={()=>setExpanded(false)} onClick={event=>{if(event.target===event.currentTarget){const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();}}}>
   <div className="shell-sidebar-top"><Brand/><button className="shell-close" type="button" aria-label="Close navigation" onClick={close}>×</button></div>
   <Link href="/settings" className="shell-store" onClick={close}><span className="shell-avatar" aria-hidden="true">{initials(storeName)}</span><span><strong dir="auto">{storeName}</strong><small>{demo?"Demo store · sample orders":"Store settings"}</small></span></Link>
   <div onClick={event=>{if((event.target as HTMLElement).closest("a"))close();}} className="shell-navigation"><Navigation/></div>
   <Link href="/settings#account" className="shell-account" onClick={close}><span className="shell-avatar account" aria-hidden="true">{initials(accountName)}</span><span><strong dir="auto">{accountName}</strong><small>Account settings</small></span></Link>
  </dialog>
  <main id="main-content" tabIndex={-1} className="main-content">{children}</main>
 </div>;
}
