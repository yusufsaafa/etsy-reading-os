import {it,expect,vi} from "vitest";
import {catalogReader,CatalogError,safeListingUrl,primaryThumbnail} from "../src/modules/catalog/transport";
import {catalogQuery,currentCoverage} from "../src/modules/catalog/read";
import {deriveSetupCatalog} from "../src/modules/etsy/setup-catalog";
import {setupListing,setupInventory,setupQuestions} from "./fixtures/etsy-setup";
const response=(body:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json",...headers}});
it("uses owned authenticated GET for complete sections; accepts an empty catalog and rejects duplicates/truncated data",async()=>{
 const fetcher=vi.fn().mockResolvedValue(response({count:0,results:[]})),reader=catalogReader("123",1,"synthetic-token",{clientId:"test",secret:"test"},fetcher);
 expect(await reader.sections()).toEqual([]);expect(fetcher.mock.calls[0][0]).toBe("https://api.etsy.com/v3/application/shops/123/sections");expect(fetcher.mock.calls[0][1]).toMatchObject({method:"GET",cache:"no-store",redirect:"error"});
 const row={shop_section_id:4,title:"Fictional",rank:1,active_listing_count:2};
 for(const data of [{count:2,results:[row,row]},{count:2,results:[row]}]){fetcher.mockResolvedValueOnce(response(data));await expect(reader.sections()).rejects.toThrow("INVALID_RESPONSE");}
});
it("validates listing ownership, state, pagination, ID precision and malformed/oversized JSON",async()=>{
 const fetcher=vi.fn(),reader=catalogReader("123",1,"test",{clientId:"test",secret:"test"},fetcher);
 const row={listing_id:"9223372036854775807",shop_id:"123",title:"Draft",state:"draft",updated_timestamp:10,shop_section_id:null};
 fetcher.mockResolvedValueOnce(response({count:1,results:[row]}));expect((await reader.listings("draft",0)).results[0].listing_id).toBe(row.listing_id);
 expect(String(fetcher.mock.calls[0][0])).toContain("state=draft");
 for(const data of [{count:1,results:[{...row,shop_id:"999"}]},{count:1,results:[]},{count:2,results:[row,row]},{count:1,results:[{...row,listing_id:9223372036854776000}]}]){fetcher.mockResolvedValueOnce(response(data));await expect(reader.listings("draft",0)).rejects.toThrow("INVALID_RESPONSE");}
 fetcher.mockResolvedValueOnce(new Response("x".repeat(1048577),{headers:{"content-type":"application/json"}}));await expect(reader.sections()).rejects.toThrow();
});
it("surfaces bounded rate-limit retry guidance without automatic HTTP retry",async()=>{
 const fetcher=vi.fn().mockResolvedValue(response({},429,{"retry-after":"30"}));await expect(catalogReader("123",1,"test",{clientId:"test",secret:"test"},fetcher).sections()).rejects.toMatchObject({code:"RATE_LIMIT",retryAfterSeconds:30});expect(fetcher).toHaveBeenCalledOnce();
});
it("validates source URLs/thumbnails without fetching binaries",()=>{
 expect(safeListingUrl("https://www.etsy.com/listing/101/a?tracking=x","101")).toBe("https://www.etsy.com/listing/101/a");for(const u of ["http://www.etsy.com/listing/101","https://evil.test/listing/101","https://www.etsy.com/listing/102"])expect(safeListingUrl(u,"101")).toBeNull();
 expect(primaryThumbnail({listing_id:"101",shop_id:"123",title:"A",state:"active",updated_timestamp:1,images:[]})).toBeNull();
});
it("defaults to all products and bounds paging; never invents unknown inventory counts",()=>{
 expect(catalogQuery.parse({})).toMatchObject({state:"all",section:"all",pageSize:25});expect(()=>catalogQuery.parse({pageSize:1000})).toThrow();expect(()=>catalogQuery.parse({storeId:"foreign"})).toThrow();
 expect(currentCoverage(null,1,null,null)).toMatchObject({state:"UNKNOWN",total:null});const c=deriveSetupCatalog(setupListing,setupInventory,setupQuestions,{shopId:"123",listingId:"101"});
 expect(currentCoverage(c,1,1,null)).toMatchObject({state:"VERIFIED",total:2});expect(currentCoverage(c,2,1,null).total).toBeNull();expect(currentCoverage(c,1,1,"failure").state).toBe("UNKNOWN");expect(currentCoverage({...c,state:"BLOCKED",configurations:[],reasons:["UNSUPPORTED_SCALE"]},1,1,null)).toMatchObject({state:"PARTIAL",total:null});
});
