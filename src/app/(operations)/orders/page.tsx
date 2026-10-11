import Link from "next/link";
import {automaticIntakeStatus} from "@/modules/etsy/automatic-intake";
import {webhookIntakeStatus} from "@/modules/etsy/webhook-intake";
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
 try{const [data,status,backup]=await Promise.all([ordersWorkQueue(database(),scope,query),webhookIntakeStatus(database(),scope),automaticIntakeStatus(database(),scope)]);return <OrdersListPage data={data} query={query} previewAvailable={previewAvailable} syncControl={<section aria-label="Incoming Etsy orders"><p role="status">{status}</p><p>Backup polling / reconciliation: {backup}</p>{internalOperatorAllowed(scope.userId)&&<Link href="/etsy/diagnostics">Intake diagnostics</Link>}</section>}/>;}
 catch(error){if(error instanceof AccessDenied)throw error;return <OrdersError query={query}/>;}
}
