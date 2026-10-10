import {it,expect,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
vi.mock("@/app/onboarding/actions",()=>({createStoreAction:vi.fn(),selectProductsAction:vi.fn()}));
import {ProductPicker} from "../src/components/onboarding/forms";
it("picker presents configured and selected setup states without visible internal identities",()=>{
 const html=renderToStaticMarkup(createElement(ProductPicker,{products:[{externalId:"101",title:"Synthetic product",state:"active",configured:true},{externalId:"102",title:"Another product",state:"active"}],initialSelection:["102"]}));
 expect(html).toContain("Ready");expect(html).toContain("Setup required");expect(html).toContain("1 selected");expect(html).toContain("Continue to product setup");expect(html).not.toContain("property_id");expect(html).not.toContain("ProductVersion");expect(html.replace(/<[^>]*>/g,"")).not.toContain("101");
});
it("empty selection disables continue and unavailable listings cannot be newly selected",()=>{
 const html=renderToStaticMarkup(createElement(ProductPicker,{products:[{externalId:"101",title:"Inactive product",state:"inactive"}],initialSelection:[]}));expect(html).toContain("disabled");expect(html).toContain("Not selected");expect(html).toContain("Listing status");
});
it("Step 2 and selection actions retain navigation to discovery and existing setup surface",()=>{
 const actions=readFileSync("src/app/onboarding/actions.ts","utf8");expect(actions).toContain('redirect("/onboarding/products")');expect(actions).toContain('redirect("/onboarding/products/setup")');expect(actions).toContain('saveProductSelection(database(), scope, form.getAll("listing"))');const page=readFileSync("src/app/onboarding/products/page.tsx","utf8");expect(page).toContain("readSavedProducts(database(),scope)");expect(page).not.toContain("discoverProducts(");expect(page).not.toContain("vault()");expect(page).not.toContain("ImportRefresh");
});

import {productPage,selectProductPage} from "../src/components/onboarding/product-picker-model";
const catalog=Array.from({length:28},(_,i)=>({externalId:String(i+1),title:i<5?`Career ${i}`:`Product ${i}`,state:i<26?"active":"inactive"}));
it("derives filter counts and renders eight rows with page-only controls",()=>{
 const html=renderToStaticMarkup(createElement(ProductPicker,{products:catalog,initialSelection:[]}));
 expect(html).toContain("28 Etsy listings");for(const text of ["All (28)","Active (26)","Inactive (2)","Showing 1–8 of 28","Select page","Deselect page"])expect(html).toContain(text);
 expect(html.match(/aria-label="Select /g)).toHaveLength(8);expect(html).not.toContain("<select");
});
it("paginates without duplicates and clamps the final page",()=>{
 const pages=[1,2,3,4].map(n=>productPage(catalog,"","all",n));expect(pages.map(p=>p.visible.length)).toEqual([8,8,8,4]);expect(new Set(pages.flatMap(p=>p.visible.map(x=>x.externalId))).size).toBe(28);expect(productPage(catalog,"","all",99).current).toBe(4);
});
it("search and status filtering precede pagination across the whole catalog",()=>{
 expect(productPage(catalog,"Career","active",4)).toMatchObject({total:5,current:1,pages:1});expect(productPage(catalog,"","inactive",1).visible).toHaveLength(2);expect(productPage(catalog,"Product 27","all",1).visible[0].externalId).toBe("28");
});
it("page selection preserves hidden selections and excludes unavailable rows",()=>{
 let selected=selectProductPage(new Set<string>(),productPage(catalog,"","all",1).visible,true);
 selected=selectProductPage(selected,productPage(catalog,"","all",4).visible,true);expect(selected.size).toBe(10);expect(selected.has("27")).toBe(false);
 productPage(catalog,"Career","active",1);expect(selected.size).toBe(10);
 selected=selectProductPage(selected,productPage(catalog,"","all",1).visible,false);expect([...selected]).toEqual(["25","26"]);
});
it("renders safe public listing thumbnails and falls back for missing or unsafe images",()=>{
 const html=renderToStaticMarkup(createElement(ProductPicker,{products:[{...catalog[0],thumbnailUrl:"https://i.etsystatic.com/123/il_75x75.test.jpg"},catalog[1],{...catalog[2],thumbnailUrl:"https://evil.test/file"}],initialSelection:[]}));expect(html.match(/<img /g)).toHaveLength(1);expect(html).toContain('referrerPolicy="no-referrer"');expect(html).not.toContain("evil.test");
});

it("setup explanation is an independent keyboard/touch popover and Etsy status is labeled",()=>{const html=renderToStaticMarkup(createElement(ProductPicker,{products:[catalog[0]],initialSelection:["1"]}));expect(html).toContain('popover="auto"');expect(html).toContain('aria-label="Setup required"');expect(html).not.toContain("<details");expect(html).toContain("product setup must be completed");expect(html).toContain("Active");expect(html).toContain("on Etsy");expect(html).not.toContain("<label class=\"productRow");const css=readFileSync("src/components/onboarding/onboarding.module.css","utf8");expect(css).toContain(".setupHelp:focus-within p");expect(css).toContain(".setupHelp[open] p");expect(css).toContain(".pagination { display:grid; grid-template-columns:1fr; justify-items:center;");});
