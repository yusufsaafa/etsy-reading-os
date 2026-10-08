import {it,expect,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
vi.mock("@/components/products/actions",()=>({startProductSetupState:vi.fn()}));
import {CatalogChoice} from "../src/components/products/catalog-choice";
import {deriveSetupCatalog} from "../src/modules/etsy/setup-catalog";
import {setupListing,setupInventory,setupQuestions} from "./fixtures/etsy-setup";
const catalog=()=>deriveSetupCatalog(setupListing,setupInventory,setupQuestions,{shopId:"123",listingId:"101"});
it("requires an explicit exact configuration choice and displays questions without technical labels",()=>{
 const html=renderToStaticMarkup(createElement(CatalogChoice,{catalog:catalog()}));
 expect(html.match(/name="configurationKey"/g)).toHaveLength(2);expect(html).not.toContain("checked=");expect(html).toContain(">Set up</button>");expect(html).toContain("Nothing is activated");
 const visible=html.replace(/<[^>]*>/g,"");for(const token of ["propertyId","questionId","etsy-selection/1:","901"])expect(visible).not.toContain(token);
 expect(visible).toContain("Required");expect(visible).toContain("explicit customer-field mapping");
});
it("blocked catalog offers no draft submission or misleading selectable configuration",()=>{
 const blocked={...catalog(),state:"BLOCKED" as const,configurations:[]};
 const html=renderToStaticMarkup(createElement(CatalogChoice,{catalog:blocked}));expect(html).toContain('role="alert"');expect(html).not.toContain("<form");expect(html).not.toContain('type="radio"');
});
