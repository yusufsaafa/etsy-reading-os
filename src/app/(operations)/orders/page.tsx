import {randomUUID} from "node:crypto";
import {orderSyncAccess} from "@/modules/orders/sync";
import {OrderSync} from "@/components/order-sync";
import {syncOrdersAction} from "./actions";
import {internalOperatorAllowed} from "@/modules/identity/internal-access";
import {database} from "@/db/client";
import {currentScope} from "@/modules/identity/session";
import {verifyScope} from "@/modules/intake/service";
import {AccessDenied} from "@/modules/identity/service";
import {ordersWorkQueue} from "@/modules/orders/work-queue";
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
 try{const [data,access]=await Promise.all([ordersWorkQueue(database(),scope,query),orderSyncAccess(database(),scope)]);return <OrdersListPage data={data} query={query} previewAvailable={previewAvailable} syncControl={<OrderSync access={access} commandId={randomUUID()} action={syncOrdersAction} historicalHref={internalOperatorAllowed(scope.userId)?"/etsy/historical-review":undefined}/>}/>;}
 catch(error){if(error instanceof AccessDenied)throw error;return <OrdersError query={query}/>;}
}
