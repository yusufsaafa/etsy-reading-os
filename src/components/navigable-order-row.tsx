"use client";
import type {ReactNode,MouseEvent,KeyboardEvent} from "react";
const interactive="a,button,input,select,textarea,label,summary,[role='button'],[role='link'],[role='checkbox'],[role='switch'],[role='textbox'],[contenteditable]:not([contenteditable='false'])";
/** Keep native table semantics and the real anchor as navigation authority. */
export function NavigableOrderRow({children,label}:{children:ReactNode;label:string}){
 function activate(row:HTMLTableRowElement){row.querySelector<HTMLAnchorElement>("a[data-order-destination]")?.click();}
 function click(event:MouseEvent<HTMLTableRowElement>){
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;
  if((event.target as Element).closest(interactive)||window.getSelection()?.toString())return;
  activate(event.currentTarget);
 }
 function key(event:KeyboardEvent<HTMLTableRowElement>){
  if(event.target!==event.currentTarget||event.defaultPrevented||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;
  if(event.key==="Enter"||event.key===" "){event.preventDefault();activate(event.currentTarget);}
 }
 return <tr tabIndex={0} aria-label={label} onClick={click} onKeyDown={key}>{children}</tr>;
}
