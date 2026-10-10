import {sql} from "drizzle-orm";
import {listings,listingCatalog} from "../../db/schema";

/** Filter BEFORE count/pagination. Only current verified inventory is considered.
 * ACTIVE versions are immutable, validated publications from ProductService.
 * Canonical policy selection identity follows selectionKey's sorted string sets;
 * paused bindings remain configured. Historical/default bindings do not substitute.
 */
export function coverageFilter(filter:"full"|"partial"|"none"|"review") {
 const choices=sql`case when jsonb_typeof(${listingCatalog.setupCatalog}->'configurations')='array' then ${listingCatalog.setupCatalog}->'configurations' else '[]'::jsonb end`;
 const known=sql`(${listingCatalog.choicesError} is null and ${listingCatalog.choicesSourceUpdatedAt}=${listings.sourceUpdatedAt} and ${listingCatalog.setupCatalog}->>'contractVersion'='etsy-setup-catalog/v1' and ${listingCatalog.setupCatalog}->>'state'='READY' and jsonb_array_length(${choices}) between 1 and 100)`;
 const configured=sql`(select count(*) from jsonb_array_elements(${choices}) choice where exists (
  select 1 from listing_mappings binding
  join products product on product.id=binding.product_id and product.organization_id=binding.organization_id and product.store_id=binding.store_id
  join product_versions version on version.id=product.active_version_id and version.product_id=product.id and version.organization_id=product.organization_id and version.store_id=product.store_id and version.status='ACTIVE'
  where binding.organization_id=${listings.organizationId} and binding.store_id=${listings.storeId} and binding.listing_external_id=${listings.externalId} and binding.variant_key=choice->>'key'
   and version.configuration->'etsyFulfillment'->>'listingId'=${listings.externalId}
   and version.configuration->'etsyFulfillment'->>'contractVersion'='etsy-product-policy/v1'
   and version.configuration->'etsyFulfillment'->>'fulfillment'='READING'
   and ('etsy-selection/1:' || coalesce((select string_agg(identity, ';' order by identity collate "C") from (
    select (selection->>'propertyId') || '=' || (select string_agg(value, ',' order by value collate "C") from jsonb_array_elements_text(selection->'valueIds') value) identity
    from jsonb_array_elements(version.configuration->'etsyFulfillment'->'purchaseSelections') selection
   ) identities),''))=choice->>'key'
 ))`;
 const total=sql`jsonb_array_length(${choices})`;
 return filter==="review"?sql`not coalesce(${known},false)`:
  filter==="full"?sql`${known} and ${configured}=${total}`:
  filter==="none"?sql`${known} and ${configured}=0`:
  sql`${known} and ${configured}>0 and ${configured}<${total}`;
}
