import {it,expect,vi,afterEach} from "vitest";
import type {ReactElement} from "react";
vi.mock("react",async original=>({...await original<typeof import("react")>(),useId:()=>"info-test",useRef:(value:unknown)=>({current:value}),useState:()=>[false,vi.fn()],useEffect:()=>{}}));
import {InformationPopover} from "../src/components/information-popover";
type Node=ReactElement<Record<string,any>>;
function nodes(tree:unknown):Node[]{if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=="object"||!("props" in tree))return [];const n=tree as Node;return[n,...nodes(n.props.children)];}
afterEach(()=>vi.unstubAllGlobals());
it("opening focuses the measured floating panel; Escape dismisses and restores the trigger",()=>{
 const tree=nodes(InformationPopover({label:"Orders",children:"Definition"})),trigger=tree.find(n=>n.type==="button")!,panel=tree.find(n=>n.props.popover==="auto")!;
 const invoker={focus:vi.fn(),getBoundingClientRect:()=>({left:350,top:200,bottom:244})};
 const surface={style:{} as Record<string,string>,focus:vi.fn(),hidePopover:vi.fn(),getBoundingClientRect:()=>({width:320,height:160})};
 trigger.props.ref.current=invoker;panel.props.ref.current=surface;vi.stubGlobal("window",{innerWidth:390,innerHeight:844});
 panel.props.onToggle({newState:"open"});expect(surface.focus).toHaveBeenCalledWith({preventScroll:true});expect(surface.style.left).toBe("58px");
 const preventDefault=vi.fn();panel.props.onKeyDown({key:"Escape",preventDefault});expect(preventDefault).toHaveBeenCalledOnce();expect(surface.hidePopover).toHaveBeenCalledOnce();expect(invoker.focus).toHaveBeenCalledOnce();
});
it("outside dismissal restores stranded panel focus without stealing focus from an outside control",()=>{
 const tree=nodes(InformationPopover({label:"Orders",children:"Definition"})),trigger=tree.find(n=>n.type==="button")!,panel=tree.find(n=>n.props.popover==="auto")!;
 const invoker={focus:vi.fn()},surface={contains:vi.fn(()=>false)};trigger.props.ref.current=invoker;panel.props.ref.current=surface;
 vi.stubGlobal("document",{activeElement:{}});panel.props.onToggle({newState:"closed"});expect(invoker.focus).not.toHaveBeenCalled();
 vi.stubGlobal("document",{activeElement:surface});panel.props.onToggle({newState:"closed"});expect(invoker.focus).toHaveBeenCalledOnce();
});
it("long reference dialog opens through its button and restores focus after closing",()=>{
 const tree=nodes(InformationPopover({label:"Daily values",children:"Table",dialog:true})),trigger=tree.find(n=>n.type==="button")!,dialog=tree.find(n=>n.type==="dialog")!;
 const invoker={focus:vi.fn()},surface={showModal:vi.fn(),close:vi.fn()};trigger.props.ref.current=invoker;dialog.props.ref.current=surface;
 trigger.props.onClick();expect(surface.showModal).toHaveBeenCalledOnce();tree.find(n=>n.props["aria-label"]==="Close Daily values")!.props.onClick();expect(surface.close).toHaveBeenCalledOnce();dialog.props.onClose();expect(invoker.focus).toHaveBeenCalledOnce();
});
