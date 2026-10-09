import {database} from "@/db/client";
import {currentScope} from "@/modules/identity/session";
import {verifyScope} from "@/modules/intake/service";
import {AccessDenied} from "@/modules/identity/service";
import {ordersData} from "@/modules/orders/service";
import {ordersQuery} from "@/modules/orders/query";
import {OrdersListPage,OrdersError} from "@/components/orders-list-page";
export default async function OrdersPage({searchParams}:{searchParams:Promise<Record<string,unknown>>}){
 const scope=await currentScope(),params=await searchParams,query=ordersQuery(params);
 const previewAvailable=process.env.NODE_ENV==="development";
 if(previewAvailable&&params.preview==="sample"){
   await verifyScope(database(),scope);
   const {sampleOrdersData}=await import("@/modules/orders/sample-preview");
   return <OrdersListPage data={sampleOrdersData(query)} query={{...query,preview:"sample"}} previewAvailable samplePreview/>;
 }
 try{return <OrdersListPage data={await ordersData(database(),scope,query)} query={query} previewAvailable={previewAvailable}/>;}
 catch(error){if(error instanceof AccessDenied)throw error;return <OrdersError query={query}/>;}
}
