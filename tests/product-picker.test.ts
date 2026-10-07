import {it,expect,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
vi.mock("@/app/onboarding/actions",()=>({createStoreAction:vi.fn(),selectProductsAction:vi.fn()}));
import {ProductPicker} from "../src/components/onboarding/forms";
it("picker presents configured and selected setup states without visible internal identities",()=>{
 const html=renderToStaticMarkup(createElement(ProductPicker,{products:[{externalId:"101",title:"Synthetic product",state:"active",configured:true},{externalId:"102",title:"Another product",state:"active"}],initialSelection:["102"]}));
 expect(html).toContain("Configured");expect(html).toContain("Needs setup");expect(html).toContain("1 selected");expect(html).toContain("Continue to product setup");expect(html).not.toContain("property_id");expect(html).not.toContain("ProductVersion");expect(html.replace(/<[^>]*>/g,"")).not.toContain("101");
});
it("empty selection disables continue and unavailable listings cannot be newly selected",()=>{
 const html=renderToStaticMarkup(createElement(ProductPicker,{products:[{externalId:"101",title:"Inactive product",state:"inactive"}],initialSelection:[]}));expect(html).toContain("disabled");expect(html).toContain("Not selected");expect(html).toContain("Listing status");
});
it("Step 2 and selection actions retain navigation to discovery and existing setup surface",()=>{
 const actions=readFileSync("src/app/onboarding/actions.ts","utf8");expect(actions).toContain('redirect("/onboarding/products")');expect(actions).toContain('redirect("/onboarding/products/setup")');expect(actions).toContain('saveProductSelection(database(), scope, form.getAll("listing"))');const page=readFileSync("src/app/onboarding/products/page.tsx","utf8");expect(page).toContain("discoverProducts(database(),scope,vault())");expect(page).not.toContain("ImportRefresh");
});
