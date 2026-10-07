import {it,expect,vi} from "vitest";
import {fetchShopListings} from "../src/modules/etsy/listing-discovery";
const row=(id:number,state="active")=>({listing_id:id,shop_id:123,title:"Synthetic product",state,updated_timestamp:100});
const response=(results:unknown[],count=results.length)=>new Response(JSON.stringify({count,results}),{headers:{"content-type":"application/json"}});
it("paginates all owned listing states using listing-only GETs",async()=>{
 const seen:string[]=[];const fetcher=vi.fn(async(url:unknown,init?:RequestInit)=>{const u=new URL(String(url));seen.push(u.href);expect(init?.method).toBe("GET");return u.searchParams.get("state")==="active"?u.searchParams.get("offset")==="0"?response([row(1)],2):response([row(2)],2):response([]);});
 expect(await fetchShopListings("123","synthetic",{clientId:"fake",secret:"fake"},fetcher as typeof fetch)).toHaveLength(2);expect(seen).toHaveLength(6);expect(seen.every(u=>u.includes("/shops/123/listings?")&&!u.includes("receipts"))).toBe(true);
});
it.each([401,403,429,500])("safe request failure (%s) never falls back to fixtures",async status=>{await expect(fetchShopListings("123","synthetic",{clientId:"fake",secret:"fake"},vi.fn(async()=>new Response("private API details",{status})) as typeof fetch)).rejects.toThrow("LISTING_DISCOVERY_FAILED");});
it("rejects foreign shop evidence and incomplete pagination",async()=>{
 for(const result of [response([{...row(1),shop_id:456}]),response([],2)])await expect(fetchShopListings("123","synthetic",{clientId:"fake",secret:"fake"},vi.fn(async()=>result) as typeof fetch)).rejects.toThrow("LISTING_DISCOVERY_FAILED");
});
it("preserves int64 identifiers without numeric rounding",async()=>{const fetcher=vi.fn(async(url:unknown)=>new URL(String(url)).searchParams.get("state")==="active"?new Response('{"count":1,"results":[{"listing_id":9223372036854775807,"shop_id":123,"title":"Synthetic","state":"active","updated_timestamp":100}]}',{headers:{"content-type":"application/json"}}):response([]));expect((await fetchShopListings("123","synthetic",{clientId:"fake",secret:"fake"},fetcher as typeof fetch))[0].listing_id).toBe("9223372036854775807");});
it("rejects duplicate identities, invalid schema and oversized responses",async()=>{
 for(const result of [response([row(1),row(1)]),response([{...row(1),title:""}]),new Response("x".repeat(1048577),{headers:{"content-type":"application/json"}})])await expect(fetchShopListings("123","synthetic",{clientId:"fake",secret:"fake"},vi.fn(async()=>result) as typeof fetch)).rejects.toThrow("LISTING_DISCOVERY_FAILED");
});

it("requests Images efficiently and chooses primary rank without trusting arbitrary URLs",async()=>{
 const fetcher=vi.fn(async(url:unknown)=>{const u=new URL(String(url));expect(u.searchParams.get("includes")).toBe("Images");return u.searchParams.get("state")==="active"?response([{...row(1),images:[{rank:2,url_75x75:"https://i.etsystatic.com/123/second.jpg"},{rank:1,url_75x75:"https://i.etsystatic.com/123/first.jpg"}]},{...row(2),images:[]},{...row(3),images:[{rank:1,url_75x75:"https://evil.test/upload?token=private"}]}]):response([]);});
 const rows=await fetchShopListings("123","synthetic",{clientId:"fake",secret:"fake"},fetcher as typeof fetch);expect(rows.map(r=>r.thumbnailUrl)).toEqual(["https://i.etsystatic.com/123/first.jpg",null,null]);expect(fetcher).toHaveBeenCalledTimes(5);
});
import {safeListingThumbnail} from "../src/modules/etsy/listing-thumbnail";
it("rejects credentials, signed query strings and non-CDN image sources",()=>{for(const url of ["http://i.etsystatic.com/a","https://user:password@i.etsystatic.com/a","https://i.etsystatic.com/a?token=x","https://i.etsystatic.com.evil.test/a","https://localhost/a"])expect(safeListingThumbnail(url)).toBeNull();});
