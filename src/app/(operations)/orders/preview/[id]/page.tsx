import {notFound} from "next/navigation";
import {currentScope} from "@/modules/identity/session";
import {verifyScope} from "@/modules/intake/service";
import {database} from "@/db/client";
import {ordersQuery,ordersHref} from "@/modules/orders/query";
import {OrderDetailView} from "@/components/order-detail";
export default async function SampleDetail({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,unknown>>}){
 if(process.env.NODE_ENV!=="development")notFound();
 const scope=await currentScope();await verifyScope(database(),scope);
 const {sampleOrderDetail}=await import("@/modules/orders/sample-preview");
 const data=sampleOrderDetail((await params).id);if(!data)notFound();
 return <OrderDetailView data={data} backHref={ordersHref({...ordersQuery(await searchParams),preview:"sample"})}/>;
}
