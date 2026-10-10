import {notFound} from "next/navigation";
import {database} from "@/db/client";
import {currentScope} from "@/modules/identity/session";
import {AccessDenied,authorizeStore} from "@/modules/identity/service";
import {readListingDetail} from "@/modules/catalog/detail";
import {productsReturnHref,type ProductsParams} from "@/modules/catalog/query";
import {ChoiceSetup} from "@/components/products/choice-setup";
export default async function ConfigureChoicePage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<ProductsParams>}){
 const {id}=await params;if(!/^[1-9]\d{0,19}$/.test(id))notFound();const scope=await currentScope(),db=database(),q=await searchParams;
 try{const data=await readListingDetail(db,scope,id);if(!data)notFound();let canEdit=true;try{await authorizeStore(db,scope.userId,scope.storeId,true);}catch(error){if(error instanceof AccessDenied)canEdit=false;else throw error;}
 return <ChoiceSetup data={data} choiceKey={typeof q.choice==="string"?q.choice:undefined} returnHref={productsReturnHref(q.returnTo)} canEdit={canEdit}/>;
 }catch(error){if(error instanceof AccessDenied)notFound();throw error;}
}
