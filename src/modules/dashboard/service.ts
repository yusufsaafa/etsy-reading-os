import { sql } from "drizzle-orm";
import type { DbExecutor } from "../../db/client";
import type { Scope } from "../intake/contracts";
import { verifyScope } from "../intake/service";

export type DashboardOrder = {
  id: string; externalId: string; customer: string; products: string;
  count: number; status: string; date: string; priority: number;
};
export type DashboardData = {
  storeNotice?: string | null;
  metrics: { total: number; pending: number; active: number; generated: number; attention: number };
  recent: DashboardOrder[]; attention: DashboardOrder[];
  production: { queued: number; active: number; retry: number; attention: number };
};

// One statement gives aggregates and bounded lists a consistent snapshot. Orders,
// queue entries and generation attempts are deliberately separate counting units.
export async function dashboardData(db: DbExecutor, scope: Scope): Promise<DashboardData> {
  await verifyScope(db, scope);
  const result = await db.execute(sql`
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
    ), recent as (
      select * from classified order by created_at desc, id desc limit 5
    ), attention as (
      select * from classified where not canceled and priority < 4
      order by priority, created_at, id limit 6
    ), selected as (
      select id from recent union select id from attention
    ), titles as (
      select l.order_id, string_agg(l.title || ' ×' || l.quantity, ' · ' order by l.id) as products
      from order_line_items l join selected s on s.id = l.order_id
      where l.organization_id = ${scope.organizationId} and l.store_id = ${scope.storeId}
      group by l.order_id
    )
    select jsonb_build_object(
      'storeNotice', (select case
        when c.status <> 'connected' or c.expires_at < now() then 'Your store connection needs attention.'
        when (select status from sync_runs where organization_id = ${scope.organizationId} and store_id = ${scope.storeId} order by created_at desc, id desc limit 1) = 'failed' then 'Your last store update could not finish.'
        else null end from etsy_connections c
        where c.organization_id = ${scope.organizationId} and c.store_id = ${scope.storeId}),
      'metrics', (select jsonb_build_object(
        'total',count(*), 'pending',count(*) filter (where status = 'Pending'),
        'active',count(*) filter (where status = 'In production'),
        'generated',count(*) filter (where status = 'Generated'),
        'attention',count(*) filter (where not canceled and priority < 4)) from classified),
      'recent',coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'externalId',r.external_id,'customer',r.buyer_name,
        'products',coalesce(t.products,''),'count',r.reading_count,'status',r.status,
        'date',r.created_at,'priority',r.priority) order by r.created_at desc,r.id desc)
        from recent r left join titles t on t.order_id = r.id),'[]'::jsonb),
      'attention',coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'externalId',r.external_id,'customer',r.buyer_name,
        'products',coalesce(t.products,''),'count',r.reading_count,'status',r.status,
        'date',r.created_at,'priority',r.priority) order by r.priority,r.created_at,r.id)
        from attention r left join titles t on t.order_id = r.id),'[]'::jsonb),
      'production',(select jsonb_build_object(
        'queued',count(*) filter (where r.state = 'QUEUED'),
        'active',count(*) filter (where r.state in ('CLAIMED','EXECUTING')),
        'retry',count(*) filter (where r.state = 'RETRY_WAIT'),
        'attention',count(*) filter (where r.state = 'ATTENTION'))
        from readings r join owned_orders o on o.id = r.order_id where not o.canceled)
    ) as dashboard
  `);
  // The repository’s PGlite test driver returns rows in an envelope.
  const rows = Array.isArray(result) ? result : (result as unknown as { rows: { dashboard: DashboardData }[] }).rows;
  return rows[0].dashboard as DashboardData;
}
