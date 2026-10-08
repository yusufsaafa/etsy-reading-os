import {it,expect,vi,beforeEach} from "vitest";
import type {ReactElement} from "react";
const hooks=vi.hoisted(()=>({values:[] as unknown[],cursor:0}));
vi.mock("react",async original=>{const actual=await original<typeof import("react")>();return {...actual,useState:(initial:unknown)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=initial;return [hooks.values[i],(next:unknown)=>{hooks.values[i]=typeof next==="function"?(next as (x:unknown)=>unknown)(hooks.values[i]):next;}];},useEffect:()=>{},useRef:(value:unknown)=>({current:value}),useActionState:()=>[{},vi.fn(),false]};});
vi.mock("@/components/products/actions",()=>({saveConfiguration:vi.fn()}));
import {ProductEditor} from "../src/components/products/editor";
import type {Configuration} from "../src/modules/products/contracts";
const initial:Configuration={inputs:[{id:"one",key:"context",label:"Customer context",type:"LONG_TEXT",required:true,helpText:"Keep it together",sortOrder:0}],sections:[],output:null,workflow:"ASSISTED"};
type Node=ReactElement<Record<string,unknown>>;
function nodes(tree:unknown):Node[]{if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=="object"||!("props" in tree))return [];const node=tree as Node;return [node,...nodes(node.props.children)];}
function render(){hooks.cursor=0;return nodes(ProductEditor({productId:"p",versionId:"v",revision:0,initialName:"Reading",initial}));}
function click(node:Node){(node.props.onClick as ()=>void)();}
function change(node:Node,value:string){(node.props.onChange as (e:unknown)=>void)({target:{value}});}
function config(tree:Node[]){return JSON.parse(tree.find(n=>n.props.name==="configuration")!.props.value as string) as Configuration;}
beforeEach(()=>{hooks.values=[];hooks.cursor=0;});
it("expand, edit and collapse keeps values in the saved draft payload",()=>{let tree=render();click(tree.find(n=>n.props.children==="Edit")!);tree=render();expect(tree.some(n=>n.props.value==="Keep it together")).toBe(true);change(tree.find(n=>n.type==="input"&&n.props.value==="Customer context")!,"Buyer context");tree=render();click(tree.find(n=>n.props.children==="Done")!);tree=render();expect(config(tree).inputs[0]).toMatchObject({key:"context",type:"LONG_TEXT",required:true,label:"Buyer context",helpText:"Keep it together"});expect(tree.some(n=>n.props.value==="Buyer context")).toBe(false);});
it("adding a combined-context field explicitly chooses long text without mapping any source automatically",()=>{let tree=render();click(tree.find(n=>n.props.children==="+ Customer context (long answer)")!);tree=render();expect(config(tree).inputs[1]).toMatchObject({label:"Customer context",type:"LONG_TEXT",required:false});expect(tree.some(n=>n.props['aria-expanded']===true)).toBe(true);});
it("reorder and remove retain stable field identity and canonical ordering",()=>{let tree=render();click(tree.find(n=>n.props.children==="+ Add customer field")!);tree=render();const added=config(tree).inputs[1].id;click(tree.find(n=>n.props['aria-label']==="Move field 2 up")!);tree=render();expect(config(tree).inputs.map(f=>f.id)).toEqual([added,"one"]);expect(config(tree).inputs.map(f=>f.sortOrder)).toEqual([0,1]);click(tree.filter(n=>n.props.children==="Remove")[0]);tree=render();expect(config(tree).inputs).toEqual(initial.inputs);});

it("incomplete activation stays blocked and shows the actionable checklist",()=>{let tree=render();const preventDefault=vi.fn();(tree.find(n=>n.type==="form")!.props.onSubmit as (e:unknown)=>void)({preventDefault,nativeEvent:{submitter:{getAttribute:()=>"activate"}}});expect(preventDefault).toHaveBeenCalledOnce();tree=render();expect(tree.some(n=>n.props.children==="Complete the items below before activating this product.")).toBe(true);});
it("checklist navigation focuses the relevant section without discarding edits",()=>{const target={setAttribute:vi.fn(),focus:vi.fn()};vi.stubGlobal("document",{getElementById:vi.fn(()=>target)});const tree=render();click(tree.find(n=>n.props.href==="#customer-information")!);expect(target.focus).toHaveBeenCalledOnce();expect(target.setAttribute).toHaveBeenCalledWith("tabindex","-1");vi.unstubAllGlobals();});
