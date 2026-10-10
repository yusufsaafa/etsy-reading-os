import {it,expect,vi,afterEach} from "vitest";
import type {ReactElement} from "react";
import {ProductWorkspace,type WorkspaceProps} from "../src/components/products/configuration-workspace";
const state=vi.hoisted(()=>({dirty:true}));
vi.mock("react",async importOriginal=>({...await importOriginal<typeof import("react")>(),useEffect:vi.fn(),useState:(initial:unknown)=>[typeof initial==='object'&&initial!==null&&'dirty' in initial?{...initial,dirty:state.dirty}:initial,vi.fn()]}));
vi.mock("@/components/products/actions",()=>({saveConfiguration:vi.fn(),createProductEdit:vi.fn(),startProductSetupState:vi.fn()}));
const props:WorkspaceProps={productId:'owned-product',name:'Reading',initial:{inputs:[],sections:[],output:'TEXT',workflow:'MANUAL'},draft:{id:'draft',revision:2,versionNumber:2},active:null,canEdit:true,initialTab:'pdf',baseHref:'/products/owned-product/configuration',returnHref:'/products',listingHref:null,listingTitle:'Unavailable',associations:0,associationsLimited:false,pdfLabel:'Not assigned',pdfContent:null};
function guard(){const tree=ProductWorkspace(props);return (tree.props.children as ReactElement<{onSubmitCapture?:(e:{preventDefault:()=>void})=>void}>[]).find(child=>child?.props?.onSubmitCapture)!.props.onSubmitCapture!;}
afterEach(()=>{vi.unstubAllGlobals();state.dirty=true;});
it('canceling PDF assignment preserves the unsaved shared Product draft',()=>{const confirm=vi.fn(()=>false),preventDefault=vi.fn();vi.stubGlobal('window',{confirm});guard()({preventDefault});expect(confirm).toHaveBeenCalledOnce();expect(preventDefault).toHaveBeenCalledOnce();});
it('explicit continuation or a saved draft permits the separate PDF assignment',()=>{const confirm=vi.fn(()=>true),preventDefault=vi.fn();vi.stubGlobal('window',{confirm});guard()({preventDefault});expect(preventDefault).not.toHaveBeenCalled();state.dirty=false;confirm.mockClear();guard()({preventDefault});expect(confirm).not.toHaveBeenCalled();});
