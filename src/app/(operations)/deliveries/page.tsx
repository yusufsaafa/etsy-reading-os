import {database} from "@/db/client";
import {currentScope} from "@/modules/identity/session";
import {configuredDocumentPorts} from "@/infrastructure/document-runtime";
import {listDeliveries,deliveryQuery} from "@/modules/deliveries/service";
import {DeliveryList} from "@/components/deliveries-list";
export default async function DeliveriesPage({searchParams}:{searchParams:Promise<Record<string,unknown>>}){
 const scope=await currentScope(),query=deliveryQuery(await searchParams);
 let storage;try{storage=configuredDocumentPorts()?.artifacts;}catch{}
 return <DeliveryList query={query} data={await listDeliveries(database(),scope,query,storage)}/>;
}
