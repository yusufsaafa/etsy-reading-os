import {z} from "zod";
export const catalogQuery=z.object({listingId:z.string().regex(/^[1-9]\d{0,19}$/).optional(),page:z.number().int().min(1).max(10000).default(1),pageSize:z.number().int().min(1).max(50).default(25),search:z.string().trim().max(200).default(""),state:z.enum(["all","active","inactive","sold_out","draft","expired"]).default("all"),section:z.string().max(20).regex(/^(all|uncategorized|unknown|missing|[1-9]\d{0,19})$/).default("all"),setup:z.enum(["all","full","partial","none","review"]).default("all"),sort:z.enum(["title_asc","title_desc","updated_desc"]).default("title_asc")}).strict();
export type ProductsQuery=z.infer<typeof catalogQuery>;
export type ProductsParams=Record<string,string|string[]|undefined>;
/** Invalid URL values fall back individually; no client ownership parameters. */
export function productsQuery(params:ProductsParams):ProductsQuery {
 const defaults=catalogQuery.parse({});
 for(const name of ["search","state","section","setup","sort","page","pageSize"] as const){
  const value=params[name];if(typeof value!=="string")continue;
  const parsed=catalogQuery.shape[name].safeParse(name==="page"||name==="pageSize"?Number(value):value);
  if(parsed.success)Object.assign(defaults,{[name]:parsed.data});
 }
 return defaults;
}
export function productsHref(query:ProductsQuery,change:Partial<ProductsQuery>={}) {
 const next={...query,...change},params=new URLSearchParams();
 for(const name of ["search","state","section","setup","sort","page","pageSize"] as const){
  const value=next[name];if(value!==catalogQuery.parse({})[name])params.set(name,String(value));
 }
 return "/products"+(params.size?"?"+params.toString():"");
}
