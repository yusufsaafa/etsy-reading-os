export type PickerProduct = {externalId:string;title:string;state:string;configured?:boolean;thumbnailUrl?:string|null};
export const PRODUCTS_PER_PAGE = 8;
export function productPage(products:PickerProduct[],query:string,filter:string,page:number){
  const matching=products.filter(p=>p.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())&&(filter==="all"||p.state===filter));
  const pages=Math.max(1,Math.ceil(matching.length/PRODUCTS_PER_PAGE));
  const current=Math.max(1,Math.min(page,pages));
  return {matching,total:matching.length,pages,current,visible:matching.slice((current-1)*PRODUCTS_PER_PAGE,current*PRODUCTS_PER_PAGE)};
}
export function selectProductPage(selected:ReadonlySet<string>,visible:PickerProduct[],select:boolean){
  const next=new Set(selected);
  for(const product of visible){
    if(!select)next.delete(product.externalId);
    else if(product.state==="active"&&next.size<1000)next.add(product.externalId);
  }
  return next;
}
