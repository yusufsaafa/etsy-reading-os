"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {Icon} from "./icon";
import styles from "./information-popover.module.css";

export function informationPosition(trigger: {left:number;top:number;bottom:number}, panel: {width:number;height:number}, viewport: {width:number;height:number}) {
  const gutter=12, below=trigger.bottom+8;
  return {
    left:Math.max(gutter,Math.min(trigger.left,viewport.width-panel.width-gutter)),
    top:Math.max(gutter,Math.min(below+panel.height<=viewport.height-gutter?below:trigger.top-panel.height-8,viewport.height-panel.height-gutter)),
  };
}

/** Native top-layer popover: light-dismiss, Escape and keyboard activation.
 * Long reference content uses a modal dialog instead of a cramped popover. */
export function InformationPopover({label,children,dialog=false,iconOnly=false,triggerContent,hover=false,title,onOpen}:{label:string;children:ReactNode;dialog?:boolean;iconOnly?:boolean;triggerContent?:ReactNode;hover?:boolean;title?:string;onOpen?:()=>void}) {
  const id=useId(),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),modal=useRef<HTMLDialogElement>(null);
  const [open,setOpen]=useState(false),hoverOpened=useRef(false),dismissTimer=useRef<ReturnType<typeof setTimeout>|null>(null),suppressFocus=useRef(false);
  function focusTrigger(){suppressFocus.current=true;trigger.current?.focus();suppressFocus.current=false;}
  function cancelDismiss(){if(dismissTimer.current)clearTimeout(dismissTimer.current);}
  function reveal(){if(!hover||dialog||suppressFocus.current)return;cancelDismiss();if(!panel.current?.matches(":popover-open")){hoverOpened.current=true;panel.current?.showPopover();}}
  function deferDismiss(){if(!hover||!hoverOpened.current)return;cancelDismiss();dismissTimer.current=setTimeout(()=>{if(!panel.current?.contains(document.activeElement)&&document.activeElement!==trigger.current)panel.current?.hidePopover();},200);}
  useEffect(()=>()=>cancelDismiss(),[]);
  function position(){
    if(!panel.current||!trigger.current)return;
    const bounds=window.visualViewport;
    const width=bounds?.width??window.innerWidth,height=bounds?.height??window.innerHeight;
    panel.current.style.maxWidth=`${Math.max(0,width-24)}px`;
    panel.current.style.maxHeight=`${Math.max(0,height-24)}px`;
    const rect=trigger.current.getBoundingClientRect();
    const point=informationPosition({left:rect.left-(bounds?.offsetLeft??0),top:rect.top-(bounds?.offsetTop??0),bottom:rect.bottom-(bounds?.offsetTop??0)},panel.current.getBoundingClientRect(),{width,height});
    panel.current.style.left=`${point.left+(bounds?.offsetLeft??0)}px`;
    panel.current.style.top=`${point.top+(bounds?.offsetTop??0)}px`;
  }
  function restore(event?:{stopPropagation:()=>void}){event?.stopPropagation();if(dialog&&modal.current?.open)return;setOpen(false);focusTrigger();}
  useEffect(()=>{
    if(!open||dialog)return;
    window.addEventListener("resize",position);window.addEventListener("scroll",position,true);
    window.visualViewport?.addEventListener("resize",position);window.visualViewport?.addEventListener("scroll",position);
    return ()=>{window.removeEventListener("resize",position);window.removeEventListener("scroll",position,true);window.visualViewport?.removeEventListener("resize",position);window.visualViewport?.removeEventListener("scroll",position);};
  },[open,dialog]);
  return <>
    <button ref={trigger} type="button" className={iconOnly?styles.iconTrigger:styles.trigger} aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onMouseEnter={reveal} onMouseLeave={deferDismiss} onFocus={reveal} onBlur={deferDismiss}
      {...(dialog?{onClick:()=>{modal.current?.showModal();setOpen(true);onOpen?.();}}:hover?{popoverTarget:id,onClick:(event)=>{event.preventDefault();cancelDismiss();if(panel.current?.matches(":popover-open")&&!hoverOpened.current){panel.current.hidePopover();}else{hoverOpened.current=false;panel.current?.showPopover();position();panel.current?.focus({preventScroll:true});}}}:{popoverTarget:id})}>
      {triggerContent??(iconOnly?<Icon name="attention"/>:label)}
    </button>
    {dialog?<dialog ref={modal} id={id} className={styles.modal} aria-label={label} onClose={restore} onClick={event=>{if(event.target===event.currentTarget){const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.currentTarget.close();}}}>
      <div className={styles.heading}><strong>{title??label}</strong><button type="button" autoFocus onClick={()=>modal.current?.close()} aria-label={`Close ${label}`}><Icon name="close"/></button></div>{children}
    </dialog>:<div ref={panel} id={id} popover="auto" role="dialog" aria-label={label} tabIndex={-1} className={styles.panel} onMouseEnter={cancelDismiss} onMouseLeave={deferDismiss} onFocus={()=>{hoverOpened.current=false;cancelDismiss();}} onBlur={deferDismiss} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();panel.current?.hidePopover();focusTrigger();}}}
      onBeforeToggle={event=>{suppressFocus.current=event.newState==="closed";}} onToggle={event=>{const opened=event.newState==="open";setOpen(opened);if(opened){position();if(!hoverOpened.current)panel.current?.focus({preventScroll:true});}else {hoverOpened.current=false;if(document.activeElement===panel.current||panel.current?.contains(document.activeElement))focusTrigger();suppressFocus.current=false;}}}>
      <div className={styles.heading}><strong>{title??label}</strong><button type="button" popoverTarget={id} popoverTargetAction="hide" onClick={focusTrigger} aria-label={`Close ${label}`}><Icon name="close"/></button></div>{children}
    </div>}
  </>;
}
