import {it,expect,vi,afterEach} from "vitest";
import {NavigableOrderRow} from "../src/components/navigable-order-row";
import {OrderList} from "../src/components/order-list";
import {renderToStaticMarkup} from "react-dom/server";
import {createElement} from "react";
import {readFileSync} from "node:fs";
afterEach(()=>vi.unstubAllGlobals());
function fixture(){
 const anchor={click:vi.fn()},row={querySelector:vi.fn(()=>anchor)};
 const element=NavigableOrderRow({label:"Open order 1001",children:"cells"});
 vi.stubGlobal("window",{getSelection:()=>({toString:()=>""})});
 const event={target:{closest:vi.fn(()=>null)},currentTarget:row,defaultPrevented:false,button:0,metaKey:false,ctrlKey:false,altKey:false,shiftKey:false,preventDefault:vi.fn()};
 return {anchor,row,element,event};
}
it("retains native table row semantics and activates the real anchor from row space",()=>{const f=fixture();expect(f.element.type).toBe("tr");expect(f.element.props.role).toBeUndefined();expect(f.element.props.tabIndex).toBe(0);f.element.props.onClick(f.event as never);expect(f.anchor.click).toHaveBeenCalledOnce();expect(f.row.querySelector).toHaveBeenCalledWith("a[data-order-destination]");});
it.each(["Enter"," "])("%s activates only when the row itself has keyboard focus",key=>{const f=fixture();f.element.props.onKeyDown({...f.event,key,target:f.row} as never);expect(f.anchor.click).toHaveBeenCalledOnce();expect(f.event.preventDefault).toHaveBeenCalledOnce();f.anchor.click.mockClear();f.element.props.onKeyDown({...f.event,key} as never);expect(f.anchor.click).not.toHaveBeenCalled();});
it.each(["a","button","input","select","textarea","label","summary","contenteditable"])("does not hijack %s interactive children",control=>{const f=fixture();f.event.target.closest.mockReturnValue(control as never);f.element.props.onClick(f.event as never);expect(f.anchor.click).not.toHaveBeenCalled();});
it("preserves selected text without row navigation",()=>{const f=fixture();vi.stubGlobal("window",{getSelection:()=>({toString:()=>"Selected customer name"})});f.element.props.onClick(f.event as never);expect(f.anchor.click).not.toHaveBeenCalled();});
it.each([{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{button:1},{defaultPrevented:true}])("preserves modified/canceled click %j",changes=>{const f=fixture();f.element.props.onClick({...f.event,...changes} as never);expect(f.anchor.click).not.toHaveBeenCalled();});
it.each([true,false])("real/sample %s destinations retain return context and valid table/link semantics",preview=>{
 const row={id:preview?"DEMO-1001":"owned-id",externalId:"1001",customer:"Name",products:"Reading",count:1,status:"Pending",priority:4,date:"2026-10-09T12:00:00Z"};
 const html=renderToStaticMarkup(createElement(OrderList,{rows:[row],preview,returnQuery:"?q=Reading&filter=pending&sort=oldest&page=2"}));
 expect(html).toContain(`href="/orders/${preview?"preview/DEMO-1001":"owned-id"}?q=Reading&amp;filter=pending&amp;sort=oldest&amp;page=2"`);expect(html).toContain('data-order-destination="true"');expect(html).toContain('tabindex="0"');expect(html).toContain('<th scope="col">');expect(html).not.toMatch(/<a[^>]*>[^<]*<a/);
 const css=readFileSync("src/components/orders.module.css","utf8");for(const rule of ["tr:hover","tr:focus-visible","tr:focus-within","@media(max-width:760px)","grid-column:1 / -1"])expect(css).toContain(rule);
});
