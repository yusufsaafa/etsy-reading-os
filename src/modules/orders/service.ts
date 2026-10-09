import {sql} from "drizzle-orm";
import type {DbExecutor} from "../../db/client";
import type {Scope} from "../intake/contracts";
import {verifyScope} from "../intake/service";
import type {DashboardOrder} from "../dashboard/service";
import {ORDER_PAGE_SIZE,literalOrderSearch,type OrdersQuery} from "./query";
export type OrdersData={rows:DashboardOrder[];total:number;matched:number;page:number;pages:number;connectionAttention:boolean};
export async function ordersData(db:DbExecutor,scope:Scope,query:OrdersQuery):Promise<OrdersData>{
 await verifyScope(db,scope);
 const pattern=literalOrderSearch(query.q);
 const direction=query.sort==="oldest"?sql`asc`:sql`desc`;
 // Same validated current-state lifecycle precedence as Dashboard. This read
 // projection adds list filtering/pagination without changing persisted state.
 const result=await db.execute(sql`
    with owned_orders as materialized (
      select id, external_id, buyer_name, canceled, paid, refund, created_at
      from orders where organization_id = ${scope.organizationId} and store_id = ${scope.storeId}
    ), latest_generations as materialized (
      select distinct on (unit_id) unit_id, status, customer_revision
      from generations where organization_id = ${scope.organizationId} and store_id = ${scope.storeId}
      order by unit_id, created_at desc, id desc
    ), readings as materialized (
      select l.order_id, u.id, u.issues, q.state,
        g.status, g.customer_revision, u.revision
      from owned_orders o
      join order_line_items l on l.order_id = o.id
        and l.organization_id = ${scope.organizationId} and l.store_id = ${scope.storeId}
      join fulfillment_units u on u.line_item_id = l.id
        and u.organization_id = l.organization_id and u.store_id = l.store_id
      left join production_queue q on q.unit_id = u.id
        and q.organization_id = u.organization_id and q.store_id = u.store_id
      left join latest_generations g on g.unit_id = u.id
    ), flags as (
      select order_id, count(*)::int as reading_count,
        bool_or(state in ('QUEUED','CLAIMED','EXECUTING','RETRY_WAIT') or status = 'PROCESSING') as active,
        bool_and(coalesce(status = 'SUCCEEDED' and customer_revision = revision and jsonb_array_length(issues) = 0, false)) as generated,
        min(case
          when state = 'ATTENTION' or (status = 'FAILED' and coalesce(state,'') not in ('QUEUED','CLAIMED','EXECUTING','RETRY_WAIT')) then 1
          when status = 'SUCCEEDED' and customer_revision <> revision then 2
          when jsonb_array_length(issues) > 0 then 3
          else 4 end) as priority
      from readings group by order_id
    ), classified as materialized (
      select o.*, coalesce(f.reading_count,0) as reading_count,
        case when not o.paid or o.refund <> 'none' then least(coalesce(f.priority,4),3) else coalesce(f.priority,4) end as priority,
        case when o.canceled then 'Canceled'
          when not o.paid then 'Awaiting payment'
          when o.refund <> 'none' then 'Review refund'
          when f.priority = 1 then 'Production needs attention'
          when f.priority = 2 then 'Review updated information'
          when f.priority = 3 then 'Information or setup needed'
          when f.active then 'In production'
          when f.generated then 'Generated'
          else 'Pending' end as status
      from owned_orders o left join flags f on f.order_id = o.id
    ),
 filtered as materialized (
   select *,case when canceled then 'canceled' when priority<4 then 'attention'
     when status='In production' then 'production' when status='Generated' then 'generated' else 'pending' end as category
   from classified o where (${query.q}='' or external_id ilike ${pattern} escape '\\'
     or id::text ilike ${pattern} escape '\\'
     or exists(select 1 from order_line_items l where l.order_id=o.id
       and l.organization_id=${scope.organizationId} and l.store_id=${scope.storeId}
       and l.title ilike ${pattern} escape '\\'))
 ), matching as materialized (
   select * from filtered where ${query.filter}='all' or category=${query.filter}
 ), totals as (
   select count(*) as matched,greatest(1,ceil(count(*)::numeric/${ORDER_PAGE_SIZE}))::int as pages from matching
 ), paging as (
   select *,least(${query.page}::int,pages) as page from totals
 ), selected as materialized (
   select * from matching order by created_at ${direction},id ${direction}
   limit ${ORDER_PAGE_SIZE} offset (select (page-1)*${ORDER_PAGE_SIZE} from paging)
 ), titles as (
   select l.order_id,string_agg(l.title || ' ×' || l.quantity,' · ' order by l.id) as products
   from selected o join order_line_items l on l.order_id=o.id
     and l.organization_id=${scope.organizationId} and l.store_id=${scope.storeId}
   group by l.order_id
 )
 select jsonb_build_object(
   'total',(select count(*) from owned_orders),'matched',(select matched from paging),
   'page',(select page from paging),'pages',(select pages from paging),
   'connectionAttention',coalesce((select c.status<>'connected' or c.expires_at<=now()
     or coalesce((select status='failed' from sync_runs r where r.organization_id=c.organization_id and r.store_id=c.store_id and r.connection_epoch=c.epoch order by r.created_at desc,r.id desc limit 1),false)
     from etsy_connections c where c.organization_id=${scope.organizationId} and c.store_id=${scope.storeId}),true),
   'rows',coalesce((select jsonb_agg(jsonb_build_object(
     'id',o.id,'externalId',o.external_id,'customer','','products',coalesce(t.products,''),
     'count',o.reading_count,'status',o.status,'date',o.created_at,'priority',o.priority)
     order by o.created_at ${direction},o.id ${direction})
     from selected o left join titles t on t.order_id=o.id),'[]'::jsonb)
 ) as orders
 `);
 const rows=Array.isArray(result)?result:(result as unknown as {rows:{orders:OrdersData}[]}).rows;
 return rows[0].orders as OrdersData;
}
