import {database} from "@/db/client";
import {currentScope} from "@/modules/identity/session";
import {authorizeStore} from "@/modules/identity/service";
import {stores} from "@/db/schema";
import {and,eq} from "drizzle-orm";
import {readCatalog} from "@/modules/catalog/read";
import {productsQuery,type ProductsParams} from "@/modules/catalog/query";
import {ProductsList} from "@/components/products/catalog-list";
export default async function ProductsPage({searchParams}:{searchParams:Promise<ProductsParams>}) {
 const scope=await currentScope(),db=database(),query=productsQuery(await searchParams);
 const data=await readCatalog(db,scope,query);
 let canConfigure=false,canSync=false;
 try {
  await authorizeStore(db,scope.userId,scope.storeId,true);canConfigure=true;
  const [store]=await db.select({source:stores.source}).from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId)));
  canSync=store?.source==="etsy";
 }catch{}
 if(query.page>Math.max(1,Math.ceil(data.pagination.total/query.pageSize))){query.page=Math.max(1,Math.ceil(data.pagination.total/query.pageSize));return <ProductsList data={await readCatalog(db,scope,query)} query={query} canConfigure={canConfigure} canSync={canSync}/>;}
 return <ProductsList data={data} query={query} canConfigure={canConfigure} canSync={canSync}/>;
}
