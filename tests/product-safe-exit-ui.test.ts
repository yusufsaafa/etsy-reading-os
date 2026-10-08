import {it,expect,vi,beforeEach} from "vitest";
import type {ReactElement} from "react";
const h=vi.hoisted(()=>({response:{} as Record<string,unknown>,refs:[] as {current:unknown}[],cursor:0,effects:[] as (()=>void)[],bound:undefined as unknown,dispatch:vi.fn()}));
vi.mock("react",async original=>{const actual=await original<typeof import("react")>();return {...actual,useActionState:(action:unknown)=>{h.bound=action;return [h.response,h.dispatch,false];},useRef:()=>h.refs[h.cursor++],useEffect:(f:()=>void)=>h.effects.push(f)};});
vi.mock("@/components/products/actions",()=>({checkProductOnboardingExit:vi.fn(),finishProductOnboarding:vi.fn()}));
import {HomeExit} from "../src/components/products/home-exit";
import {checkProductOnboardingExit,finishProductOnboarding} from "../src/components/products/actions";
type Node=ReactElement<Record<string,unknown>>;
function nodes(tree:unknown):Node[]{if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=="object"||!("props" in tree))return [];const n=tree as Node;return [n,...nodes(n.props.children)];}
const modal={open:false,showModal:vi.fn(),close:vi.fn()},button={focus:vi.fn()};
beforeEach(()=>{vi.clearAllMocks();h.response={remaining:5,active:1,draft:2,unconfigured:3,setupHref:"/onboarding/products/setup?listing=101"};h.refs=[{current:modal},{current:button}];h.cursor=0;h.effects=[];});
it("opens native modal only from authoritative action response with correct title and description",()=>{const tree=nodes(HomeExit({productId:"p"}));h.effects.forEach(f=>f());expect(modal.showModal).toHaveBeenCalledOnce();const dialog=tree.find(n=>n.type==="dialog")!;expect(dialog.props['aria-labelledby']).toBe("exit-title");expect(dialog.props['aria-describedby']).toBe("exit-description");expect(tree.some(n=>n.props.id==="exit-title")).toBe(true);expect(h.bound).toBe(checkProductOnboardingExit);expect(tree.find(n=>n.type==="form")?.props.action).toBe(h.dispatch);});
it("remaining setup link preserves exact listing and confirmed Home uses existing onboarding command",()=>{const tree=nodes(HomeExit({productId:"p"}));expect(tree.find(n=>n.props.children==="Set up remaining options")?.props.href).toBe("/onboarding/products/setup?listing=101");expect(tree.filter(n=>n.type==="form")[1].props.action).toBe(finishProductOnboarding);});
it("Escape/native close restores focus and explicit Cancel closes modal",()=>{const tree=nodes(HomeExit({productId:"p"}));(tree.find(n=>n.props.children==="Cancel")!.props.onClick as ()=>void)();expect(modal.close).toHaveBeenCalledOnce();(tree.find(n=>n.type==="dialog")!.props.onClose as ()=>void)();expect(button.focus).toHaveBeenCalledOnce();});
it("zero remaining or failed coverage does not open dialog",()=>{h.response={remaining:0};HomeExit({productId:"p"});h.effects.forEach(f=>f());expect(modal.showModal).not.toHaveBeenCalled();});
