"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
export function InformationPopover({label,children,dialog=false,iconOnly=false}:{label:string;children:ReactNode;dialog?:boolean;iconOnly?:boolean}) {
  const id=useId(),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),modal=useRef<HTMLDialogElement>(null);
  const [open,setOpen]=useState(false);
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
  function restore(){setOpen(false);trigger.current?.focus();}
  useEffect(()=>{
    if(!open||dialog)return;
    window.addEventListener("resize",position);window.addEventListener("scroll",position,true);
    window.visualViewport?.addEventListener("resize",position);window.visualViewport?.addEventListener("scroll",position);
    return ()=>{window.removeEventListener("resize",position);window.removeEventListener("scroll",position,true);window.visualViewport?.removeEventListener("resize",position);window.visualViewport?.removeEventListener("scroll",position);};
  },[open,dialog]);
  return <>
    <button ref={trigger} type="button" className={iconOnly?styles.iconTrigger:styles.trigger} aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      {...(dialog?{onClick:()=>{modal.current?.showModal();setOpen(true);}}:{popoverTarget:id})}>
      {iconOnly?<span aria-hidden="true">ⓘ</span>:label}
    </button>
    {dialog?<dialog ref={modal} id={id} className={styles.modal} aria-label={label} onClose={restore} onClick={event=>{if(event.target===event.currentTarget){const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.currentTarget.close();}}}>
      <div className={styles.heading}><strong>{label}</strong><button type="button" autoFocus onClick={()=>modal.current?.close()} aria-label={`Close ${label}`}>×</button></div>{children}
    </dialog>:<div ref={panel} id={id} popover="auto" role="dialog" aria-label={label} tabIndex={-1} className={styles.panel} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();panel.current?.hidePopover();trigger.current?.focus();}}}
      onToggle={event=>{const opened=event.newState==="open";setOpen(opened);if(opened){position();panel.current?.focus({preventScroll:true});}else if(document.activeElement===panel.current||panel.current?.contains(document.activeElement))trigger.current?.focus();}}>
      <div className={styles.heading}><strong>{label}</strong><button type="button" popoverTarget={id} popoverTargetAction="hide" onClick={()=>trigger.current?.focus()} aria-label={`Close ${label}`}>×</button></div>{children}
    </div>}
  </>;
}
