import {notFound} from "next/navigation";
import {database} from "@/db/client";
import {currentScope} from "@/modules/identity/session";
import {AccessDenied,authorizeStore} from "@/modules/identity/service";
import {readListingDetail} from "@/modules/catalog/detail";
import {productsReturnHref,type ProductsParams} from "@/modules/catalog/query";
import {ListingDetail} from "@/components/products/listing-detail";
export default async function ListingPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<ProductsParams>}){
 const {id}=await params;
 if(!/^[1-9]\d{0,19}$/.test(id))notFound();
 const scope=await currentScope(),db=database();
 try {
  const data=await readListingDetail(db,scope,id);if(!data)notFound();
  let canConfigure=false;try{await authorizeStore(db,scope.userId,scope.storeId,true);canConfigure=true;}catch(error){if(!(error instanceof AccessDenied))throw error;}
  return <ListingDetail data={data} returnHref={productsReturnHref((await searchParams).returnTo)} canConfigure={canConfigure}/>;
 }catch(error){if(error instanceof AccessDenied)notFound();throw error;}
}
