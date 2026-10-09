import {database} from "@/db/client";
import {currentScope} from "@/modules/identity/session";
import {AccessDenied} from "@/modules/identity/service";
import {ordersData} from "@/modules/orders/service";
import {ordersQuery} from "@/modules/orders/query";
import {OrdersListPage,OrdersError} from "@/components/orders-list-page";
export default async function OrdersPage({searchParams}:{searchParams:Promise<Record<string,unknown>>}){
 const scope=await currentScope(),query=ordersQuery(await searchParams);
 try{return <OrdersListPage data={await ordersData(database(),scope,query)} query={query}/>;}
 catch(error){if(error instanceof AccessDenied)throw error;return <OrdersError query={query}/>;}
}
