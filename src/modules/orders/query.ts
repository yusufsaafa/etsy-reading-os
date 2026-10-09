export const ORDER_FILTERS=[["all","All"],["pending","Pending"],["production","In Production"],["generated","Generated"],["attention","Needs Attention"],["canceled","Canceled"]] as const;
export type OrderFilter=typeof ORDER_FILTERS[number][0];
export type OrdersQuery={q:string;filter:OrderFilter;sort:"newest"|"oldest";page:number;preview?:"sample"};
export const ORDER_PAGE_SIZE=20;
export function ordersQuery(params:Record<string,unknown>={}):OrdersQuery {
 const filter=ORDER_FILTERS.find(([key])=>key===params.filter)?.[0]??"all";
 const raw=typeof params.page==="string"&&/^[1-9]\d{0,6}$/.test(params.page)?Number(params.page):1;
 return {q:typeof params.q==="string"?params.q.trim().slice(0,200):"",filter,sort:params.sort==="oldest"?"oldest":"newest",page:raw};
}
export function ordersHref(query:OrdersQuery,changes:Partial<OrdersQuery>={}) {
 const next={...query,...changes},params=new URLSearchParams({filter:next.filter,sort:next.sort});
 if(next.preview==="sample")params.set("preview","sample");
 if(next.q)params.set("q",next.q);if(next.page>1)params.set("page",String(next.page));
 return "/orders?"+params.toString();
}
export function literalOrderSearch(value:string){return "%"+value.replace(/[\\%_]/g,"\\$&")+"%";}
