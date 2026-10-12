import { MAX_GENERATION_ATTEMPTS } from "../modules/generation/limits";
import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, bigint, boolean, timestamp, jsonb, unique, foreignKey, check, index, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { Configuration } from "../modules/products/contracts";
import type { Answer, ExternalOrder, ExternalListing, InputPolicy } from "../modules/intake/contracts";

const id = () => uuid("id").defaultRandom().primaryKey();
const org = () => uuid("organization_id").notNull();
const store = () => uuid("store_id").notNull();
const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
// Verified notification identity is separate from receipt-discovery identity.
// Unknown/disconnected shops are quarantined without tenant adoption.
export const webhookEvents = pgTable("etsy_webhook_events", {
 id:id(), eventId:text("event_id").notNull(), eventType:text("event_type").notNull(),
 shopId:text("shop_id").notNull(), receiptId:text("receipt_id").notNull(), bodyHash:text("body_hash").notNull(),
 signedAt:bigint("signed_at",{mode:"number"}).notNull(), receivedAt:time("received_at").defaultNow().notNull(),
 organizationId:uuid("organization_id"), storeId:uuid("store_id"), epoch:integer("epoch"),
 status:text("status").notNull().default("PENDING"), attempts:integer("attempts").notNull().default(0),
 claim:uuid("claim"), leaseUntil:time("lease_until"), nextAt:time("next_at").defaultNow().notNull(),
 errorCode:text("error_code"), result:text("result"), settledAt:time("settled_at"),
},t=>[unique("webhook_event_identity").on(t.eventId),
 foreignKey({columns:[t.organizationId,t.storeId,t.epoch],foreignColumns:[automaticIntake.organizationId,automaticIntake.storeId,automaticIntake.epoch]}),
 check("webhook_event_evidence",sql`${t.eventId} ~ '^[A-Za-z0-9_-]+$' and length(${t.eventId}) between 1 and 256 and ${t.shopId} ~ '^[1-9][0-9]{0,19}$' and ${t.receiptId} ~ '^[1-9][0-9]{0,19}$' and ${t.bodyHash} ~ '^[0-9a-f]{64}$' and ${t.signedAt}>=0 and ${t.eventType} in ('order.paid','order.canceled','order.shipped','order.delivered')`),
 check("webhook_event_binding",sql`(${t.organizationId} is null and ${t.storeId} is null and ${t.epoch} is null and ${t.status} in ('ATTENTION','SUCCEEDED')) or (${t.organizationId} is not null and ${t.storeId} is not null and ${t.epoch} is not null and ${t.epoch}>=0)`),
 check("webhook_event_status",sql`${t.status} in ('PENDING','PROCESSING','SUCCEEDED','ATTENTION') and ${t.attempts} between 0 and 5`),
 check("webhook_event_claim",sql`(${t.status}='PROCESSING' and ${t.claim} is not null and ${t.leaseUntil} is not null) or (${t.status}<>'PROCESSING' and ${t.claim} is null and ${t.leaseUntil} is null)`),
 index("webhook_events_due").on(t.status,t.nextAt),index("webhook_events_store").on(t.organizationId,t.storeId,t.receivedAt)]);
// OAuth-owned automatic intake only; receipt evidence remains in the existing intake domain.
export const automaticIntake = pgTable("etsy_automatic_intake", {
 id:id(), organizationId:org(), storeId:store(), actorId:text("actor_id").notNull(), epoch:integer("epoch").notNull(),
 cutoff:integer("cutoff").notNull(), cursor:integer("cursor").notNull(), windowEnd:integer("window_end"), offset:integer("offset").notNull().default(0),
 claim:uuid("claim"), leaseUntil:time("lease_until"), nextAt:time("next_at").defaultNow().notNull(),
 attempts:integer("attempts").notNull().default(0), errorCode:text("error_code"), lastSuccessAt:time("last_success_at"),
},t=>[unique("automatic_intake_store_epoch").on(t.organizationId,t.storeId,t.epoch),
 foreignKey({columns:[t.organizationId,t.storeId],foreignColumns:[stores.organizationId,stores.id]}),
 check("automatic_intake_bounds",sql`${t.epoch}>=0 and ${t.cutoff}>=946684800 and ${t.cursor}>=${t.cutoff} and ${t.offset} between 0 and 10000 and ${t.attempts} between 0 and 5 and (${t.windowEnd} is null or ${t.windowEnd}>=${t.cursor})`),
 check("automatic_intake_claim",sql`(${t.claim} is null)=(${t.leaseUntil} is null)`),index("automatic_intake_due").on(t.nextAt)]);
export const automaticReceipts = pgTable("etsy_automatic_receipts", {
 id:id(), organizationId:org(), storeId:store(), epoch:integer("epoch").notNull(), receiptId:text("receipt_id").notNull(), sourceModified:integer("source_modified").notNull(),
 status:text("status").notNull().default("PENDING"), attempts:integer("attempts").notNull().default(0), claim:uuid("claim"), leaseUntil:time("lease_until"),
 nextAt:time("next_at").defaultNow().notNull(), errorCode:text("error_code"), result:text("result"), createdAt:time("created_at").defaultNow().notNull(),
},t=>[unique("automatic_receipt_identity").on(t.organizationId,t.storeId,t.epoch,t.receiptId,t.sourceModified),
 foreignKey({columns:[t.organizationId,t.storeId,t.epoch],foreignColumns:[automaticIntake.organizationId,automaticIntake.storeId,automaticIntake.epoch]}),
 check("automatic_receipt_bounds",sql`${t.receiptId} ~ '^[1-9][0-9]{0,18}$' and ${t.sourceModified}>=946684800 and ${t.attempts} between 0 and 5`),
 check("automatic_receipt_status",sql`${t.status} in ('PENDING','PROCESSING','SUCCEEDED','ATTENTION')`),
 check("automatic_receipt_claim",sql`(${t.status}='PROCESSING')=(${t.claim} is not null and ${t.leaseUntil} is not null)`),
 index("automatic_receipts_due").on(t.status,t.nextAt)]);
export const users = pgTable("app_users", { id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").unique(), passwordHash: text("password_hash"), createdAt: time("created_at").defaultNow().notNull() });
export const organizations = pgTable("organizations", { id: id(), name: text("name").notNull(), createdAt: time("created_at").defaultNow().notNull() });
export const memberships = pgTable("memberships", { id: id(), organizationId: org().references(() => organizations.id), userId: text("user_id").notNull().references(() => users.id), role: text("role").notNull().default("owner") }, t => [unique().on(t.organizationId, t.userId), check("membership_role", sql`${t.role} in ('owner', 'operator')`)]);
export const stores = pgTable("stores", {
  id: id(), organizationId: org().references(() => organizations.id), name: text("name").notNull(),
  externalShopId: text("external_shop_id"), source: text("source").notNull().default("fixtures"),
  onboardingStage: text("onboarding_stage").notNull().default("complete"),
  importSince: time("import_since").notNull(), createdAt: time("created_at").defaultNow().notNull(),
}, t => [unique().on(t.organizationId, t.id), unique().on(t.source, t.externalShopId), check("onboarding_stage", sql`${t.onboardingStage} in ('etsy','products','product_setup','complete')`), check("store_source", sql`${t.source} in ('fixtures','etsy')`)]);
// Composite ownership references are intentionally repeated: an ID alone never proves tenant ownership.
export const connections = pgTable("etsy_connections", {
  id: id(), organizationId: org(), storeId: store(), status: text("status").notNull().default("disconnected"),
  encryptedTokens: text("encrypted_tokens"), scopes: text("scopes").array().notNull().default(sql`'{}'`),
  expiresAt: time("expires_at"), epoch: integer("epoch").notNull().default(0),
  lastSyncAt: time("last_sync_at"), refreshClaim: uuid("refresh_claim"), refreshStartedAt: time("refresh_started_at"),
}, t => [unique().on(t.organizationId, t.storeId), foreignKey({ columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }), check("connection_status", sql`${t.status} in ('disconnected','connected','reauthorization_required')`)]);
export const listings = pgTable("listings", {
  id: id(), organizationId: org(), storeId: store(), externalId: text("external_id").notNull(),
  title: text("title").notNull(), state: text("state").notNull(), sourceUpdatedAt: integer("source_updated_at").notNull(),
  snapshot: jsonb("snapshot").$type<ExternalListing>().notNull(),
}, t => [unique().on(t.organizationId, t.storeId, t.externalId), foreignKey({ columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }), index("listing_catalog_title").on(t.organizationId,t.storeId,t.title,t.externalId), index("listing_catalog_state").on(t.organizationId,t.storeId,t.state,t.title,t.externalId)]);
// Current catalog evidence is separate from immutable purchased snapshots and configuration.
export const catalogSections = pgTable("catalog_sections", {
 id:id(), organizationId:org(), storeId:store(), shopId:text("shop_id").notNull(), externalId:text("external_id").notNull(),
 title:text("title"), rank:integer("rank"), activeListingCount:integer("active_listing_count"),
 present:boolean("present").notNull().default(true), verifiedAt:time("verified_at"),
},t=>[unique("catalog_section_identity").on(t.organizationId,t.storeId,t.externalId),
 foreignKey({columns:[t.organizationId,t.storeId],foreignColumns:[stores.organizationId,stores.id]}),
 index("catalog_section_order").on(t.organizationId,t.storeId,t.present,t.rank,t.externalId),
 check("catalog_section_bounds",sql`(${t.rank} is null or ${t.rank}>=0) and (${t.activeListingCount} is null or ${t.activeListingCount}>=0) and (${t.title} is null or length(${t.title}) between 1 and 500) and (not ${t.present} or (${t.title} is not null and ${t.rank} is not null and ${t.activeListingCount} is not null and ${t.verifiedAt} is not null))`)]);
export const listingCatalog = pgTable("listing_catalog", {
 organizationId:org(),storeId:store(),listingExternalId:text("listing_external_id").notNull(),shopId:text("shop_id").notNull(),
 thumbnailUrl:text("thumbnail_url"),listingUrl:text("listing_url"),sourceCreatedAt:integer("source_created_at"),
 sectionId:text("section_id"),sectionState:text("section_state").notNull().default("UNKNOWN"),sectionVerifiedAt:time("section_verified_at"),
 verifiedAt:time("verified_at").notNull(),seenRun:uuid("seen_run").notNull(),present:boolean("present").notNull().default(true),
 setupCatalog:jsonb("setup_catalog").$type<import("../modules/etsy/setup-catalog").SetupCatalog>(),
 choicesSourceUpdatedAt:integer("choices_source_updated_at"),choicesVerifiedAt:time("choices_verified_at"),choicesAttemptedAt:time("choices_attempted_at"),choicesError:text("choices_error"),
},t=>[unique("listing_catalog_identity").on(t.organizationId,t.storeId,t.listingExternalId),
 foreignKey({columns:[t.organizationId,t.storeId,t.listingExternalId],foreignColumns:[listings.organizationId,listings.storeId,listings.externalId]}),
 foreignKey({columns:[t.organizationId,t.storeId,t.sectionId],foreignColumns:[catalogSections.organizationId,catalogSections.storeId,catalogSections.externalId]}),
 index("listing_catalog_section").on(t.organizationId,t.storeId,t.sectionState,t.sectionId),
 index("listing_catalog_seen").on(t.organizationId,t.storeId,t.seenRun,t.listingExternalId),
 check("catalog_relation_state",sql`${t.sectionState} in ('KNOWN','UNCATEGORIZED','UNKNOWN','MISSING') and ((${t.sectionState} in ('KNOWN','MISSING')) = (${t.sectionId} is not null))`),
 check("catalog_snapshot_bound",sql`${t.setupCatalog} is null or octet_length(${t.setupCatalog}::text)<=262144`)]);
export const catalogSync = pgTable("catalog_sync", {
 organizationId:org(),storeId:store(),shopId:text("shop_id").notNull(),status:text("status").notNull().default("NOT_SYNCED"),
 runId:uuid("run_id"),claim:uuid("claim"),claimUntil:time("claim_until"),epoch:integer("epoch"),
 cursor:jsonb("cursor").$type<{phase:"LISTINGS"|"CHOICES";stateIndex:number;offset:number;after:string|null}>(),
 lastAttemptAt:time("last_attempt_at"),lastSuccessAt:time("last_success_at"),sectionsVerifiedAt:time("sections_verified_at"),
 processed:integer("processed").notNull().default(0),failures:integer("failures").notNull().default(0),issues:jsonb("issues").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
},t=>[unique("catalog_sync_store").on(t.organizationId,t.storeId),
 foreignKey({columns:[t.organizationId,t.storeId],foreignColumns:[stores.organizationId,stores.id]}),
 check("catalog_sync_status",sql`${t.status} in ('NOT_SYNCED','IN_PROGRESS','SUCCEEDED','PARTIAL','FAILED')`),
 check("catalog_sync_claim",sql`(${t.claim} is null) = (${t.claimUntil} is null)`),
 check("catalog_sync_bounds",sql`${t.processed}>=0 and ${t.failures}>=0 and jsonb_array_length(${t.issues})<=10`)]);
// Selection expresses intent only; it never creates a production configuration.
export const listingSelections = pgTable("listing_selections", {
  id: id(), organizationId: org(), storeId: store(), listingExternalId: text("listing_external_id").notNull(),
  selectedBy: text("selected_by").notNull().references(() => users.id), createdAt: time("created_at").defaultNow().notNull(),
}, t => [unique("selection_store_listing_unique").on(t.organizationId, t.storeId, t.listingExternalId), foreignKey({ name: "selection_owned_listing_fk", columns: [t.organizationId, t.storeId, t.listingExternalId], foreignColumns: [listings.organizationId, listings.storeId, listings.externalId] })]);
// Stable product identity; all production instructions are version-owned.
export const products = pgTable("products", {
  id: id(), organizationId: org(), storeId: store(), name: text("name").notNull(),
  status: text("status").notNull().default("draft"), activeVersionId: uuid("active_version_id"),
  createdAt: time("created_at").defaultNow().notNull(), updatedAt: time("updated_at").defaultNow().notNull(),
}, t => [unique("product_owned_identity").on(t.organizationId,t.storeId,t.id),
  foreignKey({ name:"product_owned_store_fk",columns:[t.organizationId,t.storeId],foreignColumns:[stores.organizationId,stores.id] }),
  foreignKey({ name:"product_active_version_fk",columns:[t.organizationId,t.storeId,t.id,t.activeVersionId],foreignColumns:ownedVersionColumns() }),
  check("product_status",sql`${t.status} in ('draft','active')`),
  check("product_active_pointer",sql`(${t.status}='active') = (${t.activeVersionId} is not null)`),
]);
export const productVersions = pgTable("product_versions", {
  id: id(), organizationId: org(), storeId: store(), productId: uuid("product_id").notNull(),
  versionNumber: integer("version_number").notNull(), status: text("status").notNull().default("DRAFT"),
  configuration: jsonb("configuration").$type<Configuration>().notNull(), revision: integer("revision").notNull().default(0),
  createdAt: time("created_at").defaultNow().notNull(), activatedAt: time("activated_at"),
}, t => [unique("version_owned_identity").on(t.organizationId,t.storeId,t.id), unique("version_product_identity").on(t.organizationId,t.storeId,t.productId,t.id),
  unique("product_version_number").on(t.organizationId,t.storeId,t.productId,t.versionNumber),
  foreignKey({ name:"version_owned_product_fk",columns:[t.organizationId,t.storeId,t.productId],foreignColumns:[products.organizationId,products.storeId,products.id] }),
  uniqueIndex("one_active_product_version").on(t.organizationId,t.storeId,t.productId).where(sql`${t.status}='ACTIVE'`),
  uniqueIndex("one_product_draft").on(t.organizationId,t.storeId,t.productId).where(sql`${t.status}='DRAFT'`),
  check("version_status",sql`${t.status} in ('DRAFT','ACTIVE','ARCHIVED')`), check("version_number_positive",sql`${t.versionNumber}>0 and ${t.revision}>=0`),
  check("version_activation_time",sql`(${t.status}='DRAFT') = (${t.activatedAt} is null)`),
  check("configuration_structure",sql`jsonb_typeof(${t.configuration})='object' and jsonb_typeof(${t.configuration}->'inputs')='array' and jsonb_typeof(${t.configuration}->'sections')='array'`),
]);
function ownedVersionColumns(): [AnyPgColumn,AnyPgColumn,AnyPgColumn,AnyPgColumn] { return [productVersions.organizationId,productVersions.storeId,productVersions.productId,productVersions.id]; }
// Explicit receipt-scoped historical permission; never an automatic historical import.
export const etsyHistoricalAdoptions = pgTable("etsy_historical_adoptions", {
  id:id(), organizationId:org(), storeId:store(), commandId:uuid("command_id").notNull(),
  transactionId:text("transaction_id"), shopId:text("shop_id"), sourceFingerprint:text("source_fingerprint"),
  receiptId:text("receipt_id").notNull(), listingId:text("listing_id").notNull(), selectionKey:text("selection_key").notNull(),
  productVersionId:uuid("product_version_id").notNull(), authorizedBy:text("authorized_by").notNull().references(()=>users.id),
  purchaseFrom:bigint("purchase_from",{mode:"number"}).notNull(), purchaseThrough:bigint("purchase_through",{mode:"number"}).notNull(),
  createdAt:time("created_at").defaultNow().notNull(),
},t=>[
  unique("etsy_adoption_command_unique").on(t.organizationId,t.storeId,t.commandId),
  uniqueIndex("etsy_adoption_legacy_purchase_unique").on(t.organizationId,t.storeId,t.receiptId,t.listingId,t.selectionKey).where(sql`${t.transactionId} is null`),
  uniqueIndex("etsy_adoption_line_unique").on(t.organizationId,t.storeId,t.receiptId,t.transactionId).where(sql`${t.transactionId} is not null`),
  check("etsy_adoption_line_evidence",sql`(${t.transactionId} is null and ${t.shopId} is null and ${t.sourceFingerprint} is null) or (${t.transactionId} is not null and ${t.shopId} is not null and ${t.sourceFingerprint} is not null and ${t.transactionId} ~ '^[1-9][0-9]{0,19}$' and ${t.shopId} ~ '^[1-9][0-9]{0,19}$' and ${t.sourceFingerprint} ~ '^[a-f0-9]{64}$')`),
  foreignKey({name:"etsy_adoption_store_fk",columns:[t.organizationId,t.storeId],foreignColumns:[stores.organizationId,stores.id]}),
  foreignKey({name:"etsy_adoption_version_fk",columns:[t.organizationId,t.storeId,t.productVersionId],foreignColumns:[productVersions.organizationId,productVersions.storeId,productVersions.id]}),
  check("etsy_adoption_ids",sql`${t.receiptId} ~ '^[1-9][0-9]{0,19}$' and ${t.listingId} ~ '^[1-9][0-9]{0,19}$'`),
  check("etsy_adoption_key",sql`length(${t.selectionKey}) between 17 and 2000 and ${t.selectionKey} like 'etsy-selection/1:%'`),
  check("etsy_adoption_bounds",sql`${t.purchaseFrom} >= 0 and ${t.purchaseThrough} >= ${t.purchaseFrom} and ${t.purchaseThrough} <= 9007199254740991`),
]);
export const mappings = pgTable("listing_mappings", {
  id: id(), organizationId: org(), storeId: store(), listingExternalId: text("listing_external_id").notNull(),
  productId: uuid("product_id"),
  variantKey: text("variant_key").notNull(), label: text("label").notNull(),
  required: jsonb("required_inputs").$type<InputPolicy>().notNull(), paused: boolean("paused").notNull().default(false),
}, t => [foreignKey({ name:"mapping_owned_product_fk",columns:[t.organizationId,t.storeId,t.productId],foreignColumns:[products.organizationId,products.storeId,products.id] }), unique().on(t.organizationId, t.storeId, t.listingExternalId, t.variantKey), foreignKey({ columns: [t.organizationId, t.storeId, t.listingExternalId], foreignColumns: [listings.organizationId, listings.storeId, listings.externalId] })]);
export const orders = pgTable("orders", {
  id: id(), organizationId: org(), storeId: store(), externalId: text("external_id").notNull(), buyerName: text("buyer_name").notNull(),
  paid: boolean("paid").notNull(), canceled: boolean("canceled").notNull(), refund: text("refund").notNull(),
  sourceUpdatedAt: integer("source_updated_at").notNull(), purchasedSnapshot: jsonb("purchased_snapshot").$type<ExternalOrder>().notNull(),
  latestSnapshot: jsonb("latest_snapshot").$type<ExternalOrder>().notNull(), createdAt: time("created_at").notNull(),
}, t => [unique().on(t.organizationId, t.storeId, t.externalId), unique().on(t.organizationId, t.storeId, t.id), unique("order_finance_identity").on(t.organizationId,t.storeId,t.id,t.externalId), foreignKey({ columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }), index("order_store_created").on(t.organizationId, t.storeId, t.createdAt)]);
export const orderFinances = pgTable("order_finances", {
 id:id(),organizationId:org(),storeId:store(),orderId:uuid("order_id").notNull(),receiptId:text("receipt_id").notNull(),shopId:text("shop_id").notNull(),
 source:text("source").notNull().default("etsy"),contract:text("contract").notNull().default("etsy-receipt-finance/v1"),
 state:text("state").notNull(),amount:bigint("amount",{mode:"bigint"}),divisor:bigint("divisor",{mode:"bigint"}),currency:text("currency"),
 sourceUpdatedAt:integer("source_updated_at"),totalSourceUpdatedAt:integer("total_source_updated_at"),sourceHash:text("source_hash").notNull(),
 totalVerifiedAt:time("total_verified_at"),refundObservedAt:time("refund_observed_at"),checkedAt:time("checked_at").defaultNow().notNull(),
},t=>[
 unique("finance_order_unique").on(t.organizationId,t.storeId,t.orderId),
 foreignKey({name:"finance_exact_receipt_fk",columns:[t.organizationId,t.storeId,t.orderId,t.receiptId],foreignColumns:[orders.organizationId,orders.storeId,orders.id,orders.externalId]}),
 check("finance_source_contract",sql`${t.source}='etsy' and ${t.contract}='etsy-receipt-finance/v1'`),
 check("finance_ids",sql`${t.receiptId} ~ '^[1-9][0-9]{0,19}$' and ${t.shopId} ~ '^[1-9][0-9]{0,19}$' and ${t.sourceHash} ~ '^[a-f0-9]{64}$'`),
 check("finance_state",sql`${t.state} in ('VERIFIED','MISSING','INVALID','UNCERTAIN')`),
 check("finance_money",sql`(${t.state}='VERIFIED' and ${t.amount} is not null and ${t.divisor} is not null and ${t.currency} is not null and ${t.sourceUpdatedAt} is not null and ${t.amount}>=0 and ${t.divisor} between 1 and 1000000000 and 1000000000::bigint % nullif(${t.divisor},0)=0 and ${t.currency} ~ '^[A-Z]{3}$' and ${t.totalVerifiedAt} is not null and ${t.totalSourceUpdatedAt} is not null and ${t.sourceUpdatedAt}>=${t.totalSourceUpdatedAt}) or (${t.state}<>'VERIFIED' and ${t.amount} is null and ${t.divisor} is null and ${t.currency} is null and ${t.totalVerifiedAt} is null and ${t.totalSourceUpdatedAt} is null)`),
 check("finance_timestamp",sql`(${t.sourceUpdatedAt} is null or ${t.sourceUpdatedAt}>=0) and (${t.totalSourceUpdatedAt} is null or ${t.totalSourceUpdatedAt}>=0)`),
]);
export const lineItems = pgTable("order_line_items", {
  id: id(), organizationId: org(), storeId: store(), orderId: uuid("order_id").notNull(), externalId: text("external_id").notNull(),
  listingExternalId: text("listing_external_id").notNull(), title: text("title").notNull(), quantity: integer("quantity").notNull(),
  sku: text("sku"), variantKey: text("variant_key").notNull(), snapshot: jsonb("snapshot").$type<ExternalOrder["lines"][number]>().notNull(),
}, t => [unique().on(t.organizationId, t.storeId, t.externalId), unique().on(t.organizationId, t.storeId, t.id), foreignKey({ columns: [t.organizationId, t.storeId, t.orderId], foreignColumns: [orders.organizationId, orders.storeId, orders.id] }), check("line_quantity_positive", sql`${t.quantity} between 1 and 1000`)]);
export const units = pgTable("fulfillment_units", {
  id: id(), organizationId: org(), storeId: store(), productVersionId: uuid("product_version_id"), configurationState: text("configuration_state").notNull().default("legacy"),
  lineItemId: uuid("line_item_id").notNull(), unitIndex: integer("unit_index").notNull(),
  issues: jsonb("issues").$type<string[]>().notNull(), sourceChanged: boolean("source_changed").notNull().default(false),
  contextAllocated: boolean("context_allocated").notNull().default(false), revision: integer("revision").notNull().default(0),
}, t => [foreignKey({ name:"unit_owned_version_fk",columns:[t.organizationId,t.storeId,t.productVersionId],foreignColumns:[productVersions.organizationId,productVersions.storeId,productVersions.id] }), check("unit_configuration_state",sql`${t.configurationState} in ('legacy','unconfigured','versioned') and ((${t.configurationState}='versioned') = (${t.productVersionId} is not null))`), unique().on(t.organizationId, t.storeId, t.lineItemId, t.unitIndex), unique().on(t.organizationId, t.storeId, t.id), foreignKey({ columns: [t.organizationId, t.storeId, t.lineItemId], foreignColumns: [lineItems.organizationId, lineItems.storeId, lineItems.id] }), check("unit_index_positive", sql`${t.unitIndex} >= 1`)]);
// Explicit per-Reading approval; insertion validates and applies the first binding in SQL.
export const readingAssignments = pgTable("reading_configuration_assignments", {
 id:id(),organizationId:org(),storeId:store(),unitId:uuid("unit_id").notNull(),productVersionId:uuid("product_version_id").notNull(),
 actorId:text("actor_id").notNull().references(()=>users.id),commandId:uuid("command_id").notNull(),expectedRevision:integer("expected_revision").notNull(),
 sourceEvidence:jsonb("source_evidence").$type<NonNullable<ExternalOrder["lines"][number]["etsySource"]>>().notNull(),createdAt:time("created_at").defaultNow().notNull(),
},t=>[unique("assignment_unit_unique").on(t.organizationId,t.storeId,t.unitId),unique("assignment_command_unique").on(t.organizationId,t.storeId,t.commandId),
 foreignKey({columns:[t.organizationId,t.storeId,t.unitId],foreignColumns:[units.organizationId,units.storeId,units.id]}),
 foreignKey({columns:[t.organizationId,t.storeId,t.productVersionId],foreignColumns:[productVersions.organizationId,productVersions.storeId,productVersions.id]}),
 check("assignment_revision",sql`${t.expectedRevision}>=0`),check("assignment_evidence",sql`jsonb_typeof(${t.sourceEvidence})='object' and octet_length(${t.sourceEvidence}::text)<=262144`)]);
export const customerInputs = pgTable("customer_inputs", {
  id: id(), organizationId: org(), storeId: store(), unitId: uuid("unit_id").notNull(), revision: integer("revision").notNull(),
  answers: jsonb("answers").$type<Answer[]>().notNull(), source: text("source").notNull(), actorId: text("actor_id"), createdAt: time("created_at").defaultNow().notNull(),
}, t => [unique().on(t.organizationId, t.storeId, t.unitId, t.revision), foreignKey({ columns: [t.organizationId, t.storeId, t.unitId], foreignColumns: [units.organizationId, units.storeId, units.id] })]);
export const syncRuns = pgTable("sync_runs", {
  id: id(), organizationId: org(), storeId: store(), actorId: text("actor_id").notNull(), commandKey: text("command_key").notNull(), status: text("status").notNull().default("queued"),
  connectionEpoch: integer("connection_epoch").notNull(), attempts: integer("attempts").notNull().default(0), claim: uuid("claim"),
  leaseUntil: time("lease_until"), availableAt: time("available_at").defaultNow().notNull(),
  checkpoint: integer("checkpoint").notNull().default(0), errorCode: text("error_code"), createdAt: time("created_at").defaultNow().notNull(),
}, t => [unique().on(t.organizationId, t.storeId, t.commandKey), foreignKey({ columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }), uniqueIndex("one_active_sync_per_store").on(t.organizationId, t.storeId).where(sql`${t.status} in ('queued','running')`), check("sync_status", sql`${t.status} in ('queued','running','succeeded','failed','canceled')`)]);
export const oauthStates = pgTable("oauth_states", {
  id: id(), organizationId: org(), storeId: store(), userId: text("user_id").notNull().references(() => users.id), stateHash: text("state_hash").notNull().unique(),
  encryptedVerifier: text("encrypted_verifier").notNull(), connectionEpoch: integer("connection_epoch").notNull(), expiresAt: time("expires_at").notNull(), consumedAt: time("consumed_at"),
}, t => [foreignKey({ columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] })]);
export const auditLogs = pgTable("audit_logs", {
  id: id(), organizationId: org(), storeId: store(), actorId: text("actor_id"), action: text("action").notNull(), resourceId: text("resource_id"), createdAt: time("created_at").defaultNow().notNull(),
}, t => [foreignKey({ columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] })]);

// One creator identity per store; business/shop identity stays on Store.
export const sellerProfiles = pgTable("seller_profiles", {
  id:id(), organizationId:org(), storeId:store(), displayName:text("display_name").notNull(), shortBio:text("short_bio").notNull().default(""),
  createdAt:time("created_at").defaultNow().notNull(), updatedAt:time("updated_at").defaultNow().notNull(),
},t=>[unique("seller_one_per_store").on(t.organizationId,t.storeId),unique("seller_owned_identity").on(t.organizationId,t.storeId,t.id),
  foreignKey({name:"seller_owned_store_fk",columns:[t.organizationId,t.storeId],foreignColumns:[stores.organizationId,stores.id]}),
  check("seller_identity_valid",sql`length(trim(${t.displayName})) between 1 and 100 and length(${t.shortBio})<=1000`)]);
// Separate stable style identity and immutable published instructions.
export const styleProfiles = pgTable("style_profiles", {
  id:id(),organizationId:org(),storeId:store(),activeVersionId:uuid("active_version_id"),createdAt:time("created_at").defaultNow().notNull(),
},t=>[unique("style_one_per_store").on(t.organizationId,t.storeId),unique("style_owned_identity").on(t.organizationId,t.storeId,t.id),
  foreignKey({name:"style_owned_store_fk",columns:[t.organizationId,t.storeId],foreignColumns:[stores.organizationId,stores.id]}),
  foreignKey({name:"style_active_version_fk",columns:[t.organizationId,t.storeId,t.id,t.activeVersionId],foreignColumns:ownedStyleColumns()})]);
export const styleVersions = pgTable("style_profile_versions", {
  id:id(),organizationId:org(),storeId:store(),styleProfileId:uuid("style_profile_id").notNull(),versionNumber:integer("version_number").notNull(),
  status:text("status").notNull().default("DRAFT"),configuration:jsonb("configuration").$type<import("../modules/seller-style/contracts").StyleConfiguration>().notNull(),
  revision:integer("revision").notNull().default(0),createdAt:time("created_at").defaultNow().notNull(),activatedAt:time("activated_at"),
},t=>[unique("style_version_owned_identity").on(t.organizationId,t.storeId,t.id),unique("style_version_profile_identity").on(t.organizationId,t.storeId,t.styleProfileId,t.id),
  unique("style_version_number").on(t.organizationId,t.storeId,t.styleProfileId,t.versionNumber),
  foreignKey({name:"style_version_owned_profile_fk",columns:[t.organizationId,t.storeId,t.styleProfileId],foreignColumns:[styleProfiles.organizationId,styleProfiles.storeId,styleProfiles.id]}),
  uniqueIndex("one_active_style_version").on(t.organizationId,t.storeId,t.styleProfileId).where(sql`${t.status}='ACTIVE'`),
  uniqueIndex("one_style_draft").on(t.organizationId,t.storeId,t.styleProfileId).where(sql`${t.status}='DRAFT'`),
  check("style_version_status",sql`${t.status} in ('DRAFT','ACTIVE','ARCHIVED')`),check("style_version_positive",sql`${t.versionNumber}>0 and ${t.revision}>=0`),
  check("style_activation_time",sql`(${t.status}='DRAFT')=(${t.activatedAt} is null)`),
  check("style_configuration_structure",sql`jsonb_typeof(${t.configuration})='object' and jsonb_typeof(${t.configuration}->'preferredExpressions')='array' and jsonb_typeof(${t.configuration}->'avoidExpressions')='array' and jsonb_typeof(${t.configuration}->'instructions')='string'`)]);
function ownedStyleColumns():[AnyPgColumn,AnyPgColumn,AnyPgColumn,AnyPgColumn] {return [styleVersions.organizationId,styleVersions.storeId,styleVersions.styleProfileId,styleVersions.id];}
export const styleSources = pgTable("style_sources", {
  id:id(),organizationId:org(),storeId:store(),title:text("title").notNull(),sourceType:text("source_type").notNull().default("PASTED_TEXT"),
  text:text("source_text").notNull(),contentHash:text("content_hash").notNull(),commandKey:uuid("command_key").notNull(),
  createdAt:time("created_at").defaultNow().notNull(),
},t=>[unique("source_command_unique").on(t.organizationId,t.storeId,t.commandKey),unique("source_owned_identity").on(t.organizationId,t.storeId,t.id),
  foreignKey({name:"source_owned_store_fk",columns:[t.organizationId,t.storeId],foreignColumns:[stores.organizationId,stores.id]}),
  check("source_text_valid",sql`${t.sourceType}='PASTED_TEXT' and length(trim(${t.title})) between 1 and 150 and length(trim(${t.text})) between 1 and 50000 and ${t.contentHash} ~ '^[a-f0-9]{64}$'`)]);

export const generations = pgTable("generations", {
 id:id(),organizationId:org(),storeId:store(),unitId:uuid("unit_id").notNull(),productVersionId:uuid("product_version_id").notNull(),
 styleVersionId:uuid("style_version_id"),sellerProfileId:uuid("seller_profile_id"),customerRevision:integer("customer_revision").notNull(),
 context:jsonb("context").$type<import("../modules/generation/contracts").GenerationContext>().notNull(),contextHash:text("context_hash").notNull(),
 status:text("status").notNull().default("PROCESSING"),result:jsonb("result").$type<import("../modules/generation/contracts").CanonicalResult>(),
 createdAt:time("created_at").defaultNow().notNull(),completedAt:time("completed_at"),
},t=>[unique("generation_owned_identity").on(t.organizationId,t.storeId,t.id),
 unique("generation_owned_reading_identity").on(t.organizationId,t.storeId,t.unitId,t.id),
 foreignKey({columns:[t.organizationId,t.storeId,t.unitId],foreignColumns:[units.organizationId,units.storeId,units.id]}),
 foreignKey({columns:[t.organizationId,t.storeId,t.productVersionId],foreignColumns:[productVersions.organizationId,productVersions.storeId,productVersions.id]}),
 foreignKey({columns:[t.organizationId,t.storeId,t.styleVersionId],foreignColumns:[styleVersions.organizationId,styleVersions.storeId,styleVersions.id]}),
 foreignKey({columns:[t.organizationId,t.storeId,t.sellerProfileId],foreignColumns:[sellerProfiles.organizationId,sellerProfiles.storeId,sellerProfiles.id]}),
 foreignKey({columns:[t.organizationId,t.storeId,t.unitId,t.customerRevision],foreignColumns:[customerInputs.organizationId,customerInputs.storeId,customerInputs.unitId,customerInputs.revision]}),
 uniqueIndex("one_processing_generation_per_reading").on(t.organizationId,t.storeId,t.unitId).where(sql`${t.status}='PROCESSING'`),
 check("generation_status",sql`${t.status} in ('PROCESSING','SUCCEEDED','FAILED')`),
 check("generation_success_result",sql`(${t.status}='SUCCEEDED')=(${t.result} is not null)`),
 check("generation_context_hash",sql`${t.contextHash} ~ '^[a-f0-9]{64}$'`)]);
export const aiRequests = pgTable("ai_requests", {
 id:id(),organizationId:org(),storeId:store(),generationId:uuid("generation_id"),attemptNumber:integer("attempt_number").notNull(),
 commandKey:uuid("command_key").notNull(),commandHash:text("command_hash").notNull(),styleAnalysisVersionId:uuid("style_analysis_version_id"),parentRequestId:uuid("parent_request_id"),
 operation:text("operation").notNull(),provider:text("provider").notNull(),model:text("model").notNull(),resolvedModel:text("resolved_model"),
 providerHttpStatus:integer("provider_http_status"),googleErrorStatus:text("google_error_status"),
 providerRequestId:text("provider_request_id"),status:text("status").notNull().default("CLAIMED"),failureCode:text("failure_code"),ambiguous:boolean("ambiguous").notNull().default(false),
 inputTokens:integer("input_tokens"),outputTokens:integer("output_tokens"),totalTokens:integer("total_tokens"),reasoningTokens:integer("reasoning_tokens"),cachedTokens:integer("cached_tokens"),
 durationMs:integer("duration_ms"),pricing:jsonb("pricing").$type<import("../infrastructure/ai/pricing").Pricing>().notNull(),
 reservedNanos:bigint("reserved_nanos",{mode:"bigint"}).notNull(),estimatedNanos:bigint("estimated_nanos",{mode:"bigint"}),actualNanos:bigint("actual_nanos",{mode:"bigint"}),
 costState:text("cost_state").notNull().default("unknown"),createdAt:time("created_at").defaultNow().notNull(),startedAt:time("started_at"),finishedAt:time("finished_at"),
},t=>[unique("ai_request_owned_identity").on(t.organizationId,t.storeId,t.id),
 foreignKey({name:"request_owned_analysis_fk",columns:[t.organizationId,t.storeId,t.styleAnalysisVersionId],foreignColumns:analysisIdentityColumns()}),
 uniqueIndex("one_request_per_style_analysis").on(t.organizationId,t.storeId,t.styleAnalysisVersionId).where(sql`${t.styleAnalysisVersionId} is not null`),
 check("analysis_request_attribution",sql`${t.styleAnalysisVersionId} is null or (${t.operation}='style-analysis/v1' and ${t.generationId} is null and ${t.attemptNumber}=1 and ${t.parentRequestId} is null)`),
 unique("ai_command_unique").on(t.organizationId,t.storeId,t.commandKey),
 unique("generation_attempt_number").on(t.organizationId,t.storeId,t.generationId,t.attemptNumber),
 foreignKey({columns:[t.organizationId,t.storeId],foreignColumns:[stores.organizationId,stores.id]}),
 foreignKey({columns:[t.organizationId,t.storeId,t.generationId],foreignColumns:[generations.organizationId,generations.storeId,generations.id]}),
 foreignKey({columns:[t.organizationId,t.storeId,t.parentRequestId],foreignColumns:requestIdentityColumns()}),
 uniqueIndex("one_active_request_per_generation").on(t.organizationId,t.storeId,t.generationId).where(sql`${t.status} in ('CLAIMED','RUNNING')`),
 check("ai_request_status",sql`${t.status} in ('CLAIMED','RUNNING','SUCCEEDED','FAILED')`),
 check("ai_cost_state",sql`${t.costState} in ('estimated','known_zero','unknown') and ((${t.costState}='unknown')=(${t.estimatedNanos} is null))`),
 check("ai_nonnegative",sql`${t.attemptNumber}>0 and ${t.reservedNanos}>=0 and ${t.estimatedNanos}>=0 and ${t.actualNanos}>=0 and ${t.durationMs}>=0 and ${t.inputTokens}>=0 and ${t.outputTokens}>=0 and ${t.totalTokens}>=0 and ${t.reasoningTokens}>=0 and ${t.cachedTokens}>=0`)]);
function requestIdentityColumns():[AnyPgColumn,AnyPgColumn,AnyPgColumn] {return [aiRequests.organizationId,aiRequests.storeId,aiRequests.id];}
export const usageEvents=pgTable("usage_events",{
 id:id(),organizationId:org(),storeId:store(),aiRequestId:uuid("ai_request_id").notNull(),operation:text("operation").notNull(),
 amountNanos:bigint("amount_nanos",{mode:"bigint"}),currency:text("currency").notNull().default("USD"),costState:text("cost_state").notNull().default("unknown"),
 createdAt:time("created_at").defaultNow().notNull(),
},t=>[unique("one_usage_per_request").on(t.organizationId,t.storeId,t.aiRequestId),
 foreignKey({columns:[t.organizationId,t.storeId,t.aiRequestId],foreignColumns:[aiRequests.organizationId,aiRequests.storeId,aiRequests.id]}),
 check("usage_cost",sql`${t.currency}='USD' and ${t.costState} in ('estimated','known_zero','unknown') and ((${t.costState}='unknown')=(${t.amountNanos} is null)) and ${t.amountNanos}>=0`)]);

// Durable production intent, claims and execution outcome; canonical bodies stay in Generation.
export const productionQueue = pgTable("production_queue", {
  id: id(), organizationId: org(), storeId: store(), unitId: uuid("unit_id").notNull(),
  productVersionId: uuid("product_version_id").notNull(), state: text("state").notNull().default("QUEUED"),
  priorityClass: text("priority_class").notNull(), targetCompletionMinutes: integer("target_completion_minutes"),
  targetDeadline: time("target_deadline"), createdAt: time("created_at").defaultNow().notNull(),
  updatedAt: time("updated_at").defaultNow().notNull(),
  claimToken: uuid("claim_token"), claimedAt: time("claimed_at"), claimExpiresAt: time("claim_expires_at"),
  executionAttempt:integer("execution_attempt").notNull().default(1),retryCommandKey:uuid("retry_command_key"),availableAt:time("available_at"),
  generationCommandKey:uuid("generation_command_key"),generationId:uuid("generation_id"),executionStartedAt:time("execution_started_at"),
  schedulingOrdinal: bigint("scheduling_ordinal",{mode:"bigint"}), resolvedAt: time("resolved_at"), resolutionCode: text("resolution_code"),
}, t => [unique("production_queue_one_per_reading").on(t.organizationId,t.storeId,t.unitId),
  foreignKey({columns:[t.organizationId,t.storeId,t.unitId],foreignColumns:[units.organizationId,units.storeId,units.id]}),
  foreignKey({columns:[t.organizationId,t.storeId,t.productVersionId],foreignColumns:[productVersions.organizationId,productVersions.storeId,productVersions.id]}),
  check("production_queue_waiting",sql`${t.state} in ('QUEUED','CLAIMED','SKIPPED','EXECUTING','COMPLETED','ATTENTION','RETRY_WAIT')`),
  unique("production_command_identity").on(t.organizationId,t.storeId,t.generationCommandKey),
  foreignKey({columns:[t.organizationId,t.storeId,t.generationId],foreignColumns:[generations.organizationId,generations.storeId,generations.id]}),
  check("production_execution_binding",sql`(
    (${t.generationCommandKey} is null and ${t.state} in ('QUEUED','CLAIMED','SKIPPED') and ${t.generationId} is null and ${t.executionStartedAt} is null)
    or (${t.generationCommandKey}=${t.id} and ${t.generationCommandKey} is not null and ${t.executionStartedAt} is not null)
  ) and ${t.executionAttempt} between 1 and ${sql.raw(String(MAX_GENERATION_ATTEMPTS))} and ((${t.executionAttempt}=1 and ${t.retryCommandKey} is null) or (${t.executionAttempt}>1 and ${t.retryCommandKey} is not null and ${t.retryCommandKey}<>${t.id} and ${t.generationId} is not null))`),
  uniqueIndex("production_retry_command_unique").on(t.retryCommandKey).where(sql`${t.retryCommandKey} is not null`),
  index("production_recovery_scan").on(t.state,t.updatedAt,t.id),
  index("production_retry_due").on(t.state,t.availableAt),
  uniqueIndex("production_claim_token_unique").on(t.claimToken).where(sql`${t.claimToken} is not null`),
  index("production_waiting_scan").on(t.state,t.claimExpiresAt),
  check("production_available_time",sql`(${t.state}='RETRY_WAIT')=(${t.availableAt} is not null)`),
  check("production_claim_metadata",sql`(
    (${t.state}='QUEUED' and ${t.claimToken} is null and ${t.claimedAt} is null and ${t.claimExpiresAt} is null and ${t.schedulingOrdinal} is null and ${t.resolvedAt} is null and ${t.resolutionCode} is null)
    or (${t.state} in ('CLAIMED','EXECUTING') and ${t.claimToken} is not null and ${t.claimedAt} is not null and ${t.claimExpiresAt} is not null and ${t.claimExpiresAt}>${t.claimedAt} and ${t.schedulingOrdinal} is not null and ${t.schedulingOrdinal}>0 and ${t.resolvedAt} is null and ${t.resolutionCode} is null)
    or (${t.state} in ('COMPLETED','ATTENTION','RETRY_WAIT') and ${t.claimToken} is not null and ${t.claimedAt} is not null and ${t.claimExpiresAt} is null and ${t.resolvedAt} is not null and ${t.resolutionCode} is not null and ${t.schedulingOrdinal} is not null and ${t.schedulingOrdinal}>0 and (${t.state}<>'COMPLETED' or ${t.generationId} is not null))
    or (${t.state}='SKIPPED'  and ${t.claimToken} is null and ${t.claimExpiresAt} is null and ${t.resolvedAt} is not null and ${t.resolutionCode} is not null and ${t.schedulingOrdinal} is not null and ${t.schedulingOrdinal}>0)
  )`),
  check("production_queue_urgency",sql`${t.priorityClass} in ('STANDARD','EXPRESS') and (${t.targetCompletionMinutes} is null or ${t.targetCompletionMinutes} between 1 and 525600) and ((${t.targetCompletionMinutes} is null)=(${t.targetDeadline} is null))`),
]);

// Coordination only: one expiring owner for a bounded server tick, never an AI retry signal.
export const productionTick=pgTable("production_tick",{
 id:text("id").primaryKey(),token:uuid("token"),expiresAt:time("expires_at"),
},t=>[check("production_tick_singleton",sql`${t.id}='production'`),check("production_tick_owner",sql`(${t.token} is null)=(${t.expiresAt} is null)`)]);

// Independent analysis history on the existing stable StyleProfile; never generation context in Part 1.
export const styleAnalysisVersions = pgTable("style_analysis_versions", {
 id:id(), organizationId:org(), storeId:store(), styleProfileId:uuid("style_profile_id").notNull(),
 versionNumber:integer("version_number").notNull(), status:text("status").notNull().default("DRAFT"),
 commandKey:uuid("command_key"), commandHash:text("command_hash"),
 inputManifest:jsonb("input_manifest").$type<import("../modules/seller-style/analysis-input").AnalysisInputManifest>(),
 contractVersion:text("contract_version").notNull(), operationVersion:text("operation_version").notNull(),
 payload:jsonb("payload").$type<import("../modules/seller-style/analysis-contracts").StyleIntelligence>(),
 aiRequestId:uuid("ai_request_id"), failureCode:text("failure_code"),
 createdAt:time("created_at").defaultNow().notNull(), startedAt:time("started_at"), completedAt:time("completed_at"),
},t=>[unique("analysis_owned_identity").on(t.organizationId,t.storeId,t.id),
 unique("analysis_command_unique").on(t.organizationId,t.storeId,t.commandKey),
 check("analysis_execution_metadata",sql`(${t.commandKey} is null and ${t.commandHash} is null and ${t.inputManifest} is null) or (${t.commandKey} is not null and ${t.commandHash} is not null and ${t.commandHash} ~ '^[a-f0-9]{64}$' and ${t.inputManifest} is not null)`),
 unique("analysis_profile_version_number").on(t.organizationId,t.storeId,t.styleProfileId,t.versionNumber),
 foreignKey({name:"analysis_owned_profile_fk",columns:[t.organizationId,t.storeId,t.styleProfileId],foreignColumns:[styleProfiles.organizationId,styleProfiles.storeId,styleProfiles.id]}),
 foreignKey({name:"analysis_owned_request_fk",columns:[t.organizationId,t.storeId,t.aiRequestId],foreignColumns:[aiRequests.organizationId,aiRequests.storeId,aiRequests.id]}),
 check("analysis_version_positive",sql`${t.versionNumber}>0`),
 check("analysis_contract",sql`${t.contractVersion}='style-intelligence/v1' and ${t.operationVersion}='style-analysis/v1'`),
 check("analysis_lifecycle",sql`${t.status} in ('DRAFT','PENDING','ANALYZING','READY','FAILED') and
 ((${t.status} in ('READY','FAILED'))=(${t.completedAt} is not null)) and
 ((${t.status}='READY')=(${t.payload} is not null)) and ((${t.status}='FAILED')=(${t.failureCode} is not null)) and
 (${t.status}<>'ANALYZING' or ${t.startedAt} is not null) and
 (${t.failureCode} is null or ${t.failureCode} in ('INVALID_RESULT','PROVIDER_FAILURE','CANCELED','INTERNAL_FAILURE','POLICY_REJECTED','BUDGET_REJECTED','AMBIGUOUS_EXECUTION'))`),
 index("analysis_latest_attempt").on(t.organizationId,t.storeId,t.styleProfileId,t.versionNumber),
 index("analysis_latest_usable").on(t.organizationId,t.storeId,t.styleProfileId,t.versionNumber).where(sql`${t.status}='READY'`),
]);
export const styleAnalysisSources = pgTable("style_analysis_sources", {
 organizationId:org(), storeId:store(), analysisVersionId:uuid("analysis_version_id").notNull(), sourceId:uuid("source_id").notNull(),
},t=>[unique("analysis_source_unique").on(t.organizationId,t.storeId,t.analysisVersionId,t.sourceId),
 foreignKey({name:"analysis_source_owned_version_fk",columns:[t.organizationId,t.storeId,t.analysisVersionId],foreignColumns:[styleAnalysisVersions.organizationId,styleAnalysisVersions.storeId,styleAnalysisVersions.id]}),
 foreignKey({name:"analysis_source_owned_source_fk",columns:[t.organizationId,t.storeId,t.sourceId],foreignColumns:[styleSources.organizationId,styleSources.storeId,styleSources.id]}),
 index("analysis_source_reverse_lookup").on(t.organizationId,t.storeId,t.sourceId),
]);

function analysisIdentityColumns():[AnyPgColumn,AnyPgColumn,AnyPgColumn] {return [styleAnalysisVersions.organizationId,styleAnalysisVersions.storeId,styleAnalysisVersions.id];}

// Seller workflow identity; original generated evidence is never edited here.
export const readingReviews=pgTable("reading_reviews",{
 id:id(),organizationId:org(),storeId:store(),unitId:uuid("unit_id").notNull(),generationId:uuid("generation_id").notNull(),
 state:text("state").notNull().default("PENDING"),createdAt:time("created_at").defaultNow().notNull(),
 approvedMedia:jsonb("approved_media").$type<import("../modules/review/approved-media").ApprovedReadingMedia>(),
 approvedContent:jsonb("approved_content").$type<import("../modules/generation/contracts").CanonicalResult>(),
 approvedByUserId:text("approved_by_user_id").references(()=>users.id),
 approvedDraftRevision:integer("approved_draft_revision"),approvedContentHash:text("approved_content_hash"),approvedAt:time("approved_at"),
},t=>[unique("one_review_per_reading").on(t.organizationId,t.storeId,t.unitId),
 unique("review_owned_identity").on(t.organizationId,t.storeId,t.id),
 foreignKey({name:"review_owned_reading_fk",columns:[t.organizationId,t.storeId,t.unitId],foreignColumns:[units.organizationId,units.storeId,units.id]}),
 foreignKey({name:"review_exact_generation_fk",columns:[t.organizationId,t.storeId,t.unitId,t.generationId],foreignColumns:[generations.organizationId,generations.storeId,generations.unitId,generations.id]}),
 check("review_state",sql`${t.state} IN ('PENDING','APPROVED')`),
 check("review_approval_complete",sql`(${t.state}='PENDING' AND ${t.approvedByUserId} IS NULL AND ${t.approvedContent} IS NULL AND ${t.approvedDraftRevision} IS NULL AND ${t.approvedContentHash} IS NULL AND ${t.approvedAt} IS NULL) OR (${t.state}='APPROVED' AND ${t.approvedByUserId} IS NOT NULL AND ${t.approvedContent} IS NOT NULL AND ${t.approvedContentHash} IS NOT NULL AND ${t.approvedContentHash} ~ '^[a-f0-9]{64}$' AND ${t.approvedAt} IS NOT NULL AND (${t.approvedDraftRevision} IS NULL OR ${t.approvedDraftRevision}>=0))`)]);

export const readingReviewDrafts=pgTable("reading_review_drafts",{
 reviewId:uuid("review_id").primaryKey(),organizationId:org(),storeId:store(),
 revision:integer("revision").notNull().default(0),
 content:jsonb("content").$type<import("../modules/generation/contracts").CanonicalResult>().notNull(),
 updatedAt:time("updated_at").defaultNow().notNull(),
},t=>[foreignKey({name:"draft_owned_review_fk",columns:[t.organizationId,t.storeId,t.reviewId],foreignColumns:[readingReviews.organizationId,readingReviews.storeId,readingReviews.id]}),
 check("review_draft_revision",sql`${t.revision}>=0`)]);

// Database-triggered append-only copies of every persisted review draft revision.
export const readingReviewDraftVersions=pgTable("reading_review_draft_versions",{
 reviewId:uuid("review_id").notNull(),organizationId:org(),storeId:store(),revision:integer("revision").notNull(),
 content:jsonb("content").$type<import("../modules/generation/contracts").CanonicalResult>().notNull(),savedAt:time("saved_at").notNull(),
},t=>[unique("review_draft_version_identity").on(t.reviewId,t.revision),
 foreignKey({name:"draft_version_owned_review_fk",columns:[t.organizationId,t.storeId,t.reviewId],foreignColumns:[readingReviews.organizationId,readingReviews.storeId,readingReviews.id]}),
 check("reading_review_draft_versions_revision_check",sql`${t.revision}>=0`)]);

// Presentation configuration is separate from product content and approved readings.
export const documentDesigns = pgTable("document_designs", {
  id: id(), organizationId: org(), storeId: store(), name: text("name").notNull(),
  status: text("status").notNull().default("ACTIVE"), configuration: jsonb("configuration").$type<import("../modules/documents/contracts").DocumentDesignConfiguration>().notNull(),
  revision: integer("revision").notNull().default(0), isDefault: boolean("is_default").notNull().default(false),
  createdAt: time("created_at").defaultNow().notNull(), updatedAt: time("updated_at").defaultNow().notNull(),
}, t => [unique("document_design_owned_identity").on(t.organizationId,t.storeId,t.id),
  foreignKey({columns:[t.organizationId,t.storeId],foreignColumns:[stores.organizationId,stores.id]}),
  uniqueIndex("document_design_one_default").on(t.organizationId,t.storeId).where(sql`${t.isDefault}`),
  check("document_design_state",sql`${t.status} in ('ACTIVE','ARCHIVED') and (not ${t.isDefault} or ${t.status} = 'ACTIVE')`),
  check("document_design_bounds",sql`${t.revision} >= 0 and length(trim(${t.name})) between 1 and 100 and jsonb_typeof(${t.configuration}) = 'object' and ${t.configuration}->>'contractVersion' = 'document-design/v1' and octet_length(${t.configuration}::text) <= 8192`),
]);
export const productDocumentDesigns = pgTable("product_document_designs", {
  organizationId: org(), storeId: store(), productId: uuid("product_id").notNull(), designId: uuid("design_id").notNull(),
}, t => [unique("product_document_design_one_assignment").on(t.organizationId,t.storeId,t.productId),
  foreignKey({columns:[t.organizationId,t.storeId,t.productId],foreignColumns:[products.organizationId,products.storeId,products.id]}),
  foreignKey({columns:[t.organizationId,t.storeId,t.designId],foreignColumns:[documentDesigns.organizationId,documentDesigns.storeId,documentDesigns.id]}),
  index("product_document_design_references").on(t.organizationId,t.storeId,t.designId),
]);

export const documentSnapshots = pgTable("document_snapshots", {
  id:id(),organizationId:org(),storeId:store(),readingId:uuid("reading_id").notNull(),orderId:uuid("order_id").notNull(),productId:uuid("product_id").notNull(),
  reviewId:uuid("review_id").notNull(),generationId:uuid("generation_id").notNull(),designId:uuid("design_id").notNull(),designRevision:integer("design_revision").notNull(),
  snapshotHash:text("snapshot_hash").notNull(),payload:jsonb("payload").$type<import("../modules/documents/snapshot-contract").DocumentSnapshot>().notNull(),createdAt:time("created_at").notNull(),
},t=>[
  unique("document_snapshot_intent").on(t.organizationId,t.storeId,t.readingId,t.reviewId,t.designId,t.designRevision,t.snapshotHash),
  foreignKey({columns:[t.organizationId,t.storeId,t.readingId],foreignColumns:[units.organizationId,units.storeId,units.id]}),
  foreignKey({columns:[t.organizationId,t.storeId,t.orderId],foreignColumns:[orders.organizationId,orders.storeId,orders.id]}),
  foreignKey({columns:[t.organizationId,t.storeId,t.productId],foreignColumns:[products.organizationId,products.storeId,products.id]}),
  foreignKey({columns:[t.organizationId,t.storeId,t.reviewId],foreignColumns:[readingReviews.organizationId,readingReviews.storeId,readingReviews.id]}),
  foreignKey({columns:[t.organizationId,t.storeId,t.readingId,t.generationId],foreignColumns:[generations.organizationId,generations.storeId,generations.unitId,generations.id]}),
  foreignKey({columns:[t.organizationId,t.storeId,t.designId],foreignColumns:[documentDesigns.organizationId,documentDesigns.storeId,documentDesigns.id]}),
  index("document_snapshot_reading").on(t.organizationId,t.storeId,t.readingId,t.createdAt),
  check("document_snapshot_bounds",sql`${t.designRevision}>=0 and ${t.snapshotHash} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.payload})='object' and (${t.payload}->>'contractVersion') is not distinct from 'document-snapshot/v1' and octet_length(${t.payload}::text)<=650000`),
]);

// Platform media has no Store/organization ownership. All asset bytes/metadata are immutable.
export const platformAssets=pgTable("platform_assets",{
 id:id(),objectKey:text("object_key").notNull().unique(),metadata:jsonb("metadata").$type<import("../modules/media/contracts").PlatformAsset>().notNull(),
},t=>[check("platform_asset_metadata",sql`jsonb_typeof(${t.metadata})='object' and octet_length(${t.metadata}::text)<=8192 and ${t.metadata}->>'id'=${t.id}::text and ${t.metadata}->>'objectKey'=${t.objectKey}`)]);
export const tarotDecks=pgTable("tarot_decks",{
 key:text("key").primaryKey(),name:text("name").notNull(),description:text("description").notNull(),
},t=>[check("tarot_deck_bounds",sql`${t.key} ~ '^[a-z][a-z0-9-]{0,63}$' and length(trim(${t.name})) between 1 and 100 and length(${t.description})<=300`)]);
// Mapping JSON is one atomic, immutable version-owned manifest, not a mutable mapping table.
export const tarotDeckVersions=pgTable("tarot_deck_versions",{
 deckKey:text("deck_key").notNull().references(()=>tarotDecks.key),version:integer("version").notNull(),status:text("status").notNull(),
 manifest:jsonb("manifest").$type<import("../modules/media/contracts").DeepReadonly<import("zod").infer<typeof import("../modules/media/contracts").deckVersionSchema>>>().notNull(),
},t=>[unique("tarot_deck_version_identity").on(t.deckKey,t.version),
 uniqueIndex("tarot_one_selectable_version").on(t.deckKey).where(sql`${t.status}='PUBLISHED'`),
 check("tarot_version_bounds",sql`${t.version}>0 and ${t.status} in ('DRAFT','PUBLISHED','RETIRED') and jsonb_typeof(${t.manifest})='object' and octet_length(${t.manifest}::text)<=20000 and ${t.manifest}->>'deckKey'=${t.deckKey} and (${t.manifest}->>'version')::integer=${t.version} and ${t.manifest}->>'status'=${t.status}`)]);
export const storeTarotPreferences=pgTable("store_tarot_preferences",{
 organizationId:org(),storeId:store(),deckKey:text("deck_key").notNull(),deckVersion:integer("deck_version").notNull(),revision:integer("revision").notNull(),
},t=>[unique("store_tarot_preference_identity").on(t.organizationId,t.storeId),
 foreignKey({name:"tarot_preference_owned_store",columns:[t.organizationId,t.storeId],foreignColumns:[stores.organizationId,stores.id]}),
 foreignKey({name:"tarot_preference_exact_version",columns:[t.deckKey,t.deckVersion],foreignColumns:[tarotDeckVersions.deckKey,tarotDeckVersions.version]}),
 check("tarot_preference_revision",sql`${t.revision}>0`)]);

export const documentMediaSnapshots=pgTable("document_media_snapshots",{
 id:id(),organizationId:org(),storeId:store(),documentSnapshotId:uuid("document_snapshot_id").notNull(),readingId:uuid("reading_id").notNull(),reviewId:uuid("review_id").notNull(),generationId:uuid("generation_id").notNull(),mediaHash:text("media_hash").notNull(),payload:jsonb("payload").$type<import("../modules/documents/media-contract").DocumentMediaSnapshot>().notNull(),createdAt:time("created_at").notNull(),
},t=>[unique("document_media_intent").on(t.organizationId,t.storeId,t.documentSnapshotId,t.mediaHash),
 foreignKey({columns:[t.organizationId,t.storeId,t.reviewId],foreignColumns:[readingReviews.organizationId,readingReviews.storeId,readingReviews.id]}),
 foreignKey({columns:[t.organizationId,t.storeId,t.readingId],foreignColumns:[units.organizationId,units.storeId,units.id]}),
 foreignKey({columns:[t.organizationId,t.storeId,t.generationId],foreignColumns:[generations.organizationId,generations.storeId,generations.id]}),
 foreignKey({columns:[t.documentSnapshotId],foreignColumns:[documentSnapshots.id]}),
 check("document_media_bounds",sql`${t.mediaHash} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.payload})='object' and octet_length(${t.payload}::text)<=30000 and ${t.payload}->>'contractVersion'='document-media-snapshot/v1'`)]);

// Immutable output evidence; only PENDING -> AVAILABLE lifecycle finalization is mutable.
export const documentArtifacts=pgTable("document_artifacts",{
 id:id(),organizationId:org(),storeId:store(),orderId:uuid("order_id").notNull(),readingId:uuid("reading_id").notNull(),
 documentSnapshotId:uuid("document_snapshot_id").notNull(),mediaSnapshotId:uuid("media_snapshot_id").notNull(),
 rendererVersion:text("renderer_version").notNull(),layoutHash:text("layout_hash").notNull(),resourceHash:text("resource_hash").notNull(),
 sha256:text("sha256").notNull(),byteLength:integer("byte_length").notNull(),pageCount:integer("page_count").notNull(),
 contentType:text("content_type").notNull().default("application/pdf"),objectKey:text("object_key").notNull(),
 state:text("state").notNull().default("PENDING"),createdAt:time("created_at").defaultNow().notNull(),availableAt:time("available_at"),
},t=>[unique("artifact_owned_identity").on(t.organizationId,t.storeId,t.id),
 unique("artifact_owned_reading_identity").on(t.organizationId,t.storeId,t.readingId,t.id),
 unique("artifact_render_intent").on(t.organizationId,t.storeId,t.readingId,t.documentSnapshotId,t.mediaSnapshotId,t.rendererVersion),
 unique("artifact_object_identity").on(t.objectKey),
 foreignKey({columns:[t.organizationId,t.storeId,t.readingId],foreignColumns:[units.organizationId,units.storeId,units.id]}),
 foreignKey({columns:[t.organizationId,t.storeId,t.orderId],foreignColumns:[orders.organizationId,orders.storeId,orders.id]}),
 foreignKey({columns:[t.documentSnapshotId],foreignColumns:[documentSnapshots.id]}),
 foreignKey({columns:[t.mediaSnapshotId],foreignColumns:[documentMediaSnapshots.id]}),
 check("artifact_bounds",sql`${t.rendererVersion}='reading-pdf/1' and ${t.contentType}='application/pdf' and ${t.layoutHash} ~ '^[a-f0-9]{64}$' and ${t.resourceHash} ~ '^[a-f0-9]{64}$' and ${t.sha256} ~ '^[a-f0-9]{64}$' and ${t.byteLength} between 1 and 134217728 and ${t.pageCount} between 2 and 1000 and length(${t.objectKey})<=400`),
 check("artifact_lifecycle",sql`${t.state} in ('PENDING','AVAILABLE') and ((${t.state}='AVAILABLE')=(${t.availableAt} is not null)) and (${t.availableAt} is null or ${t.availableAt}>=${t.createdAt})`),
 index("artifact_owned_reading").on(t.organizationId,t.storeId,t.readingId,t.createdAt),
]);

// Downstream stage of PostgreSQL production, not a second Reading/AI state machine.
export const documentProduction=pgTable("document_production",{
 id:id(),organizationId:org(),storeId:store(),orderId:uuid("order_id").notNull(),readingId:uuid("reading_id").notNull(),reviewId:uuid("review_id").notNull(),
 mediaSnapshotId:uuid("media_snapshot_id"),artifactId:uuid("artifact_id"),
 state:text("state").notNull().default("WAITING"),attempt:integer("attempt").notNull().default(0),
 claimToken:uuid("claim_token"),claimExpiresAt:time("claim_expires_at"),availableAt:time("available_at"),failureCode:text("failure_code"),
 createdAt:time("created_at").defaultNow().notNull(),updatedAt:time("updated_at").defaultNow().notNull(),
},t=>[unique("document_production_approval").on(t.organizationId,t.storeId,t.readingId,t.reviewId),
 foreignKey({columns:[t.organizationId,t.storeId,t.readingId],foreignColumns:[units.organizationId,units.storeId,units.id]}),
 foreignKey({columns:[t.organizationId,t.storeId,t.orderId],foreignColumns:[orders.organizationId,orders.storeId,orders.id]}),
 foreignKey({columns:[t.organizationId,t.storeId,t.reviewId],foreignColumns:[readingReviews.organizationId,readingReviews.storeId,readingReviews.id]}),
 foreignKey({columns:[t.mediaSnapshotId],foreignColumns:[documentMediaSnapshots.id]}),
 foreignKey({columns:[t.organizationId,t.storeId,t.artifactId],foreignColumns:[documentArtifacts.organizationId,documentArtifacts.storeId,documentArtifacts.id]}),
 check("document_work_state",sql`${t.state} in ('WAITING','PROCESSING','RETRY_WAIT','ATTENTION','COMPLETED') and ${t.attempt} between 0 and 3 and ((${t.state}='PROCESSING')=(${t.claimToken} is not null and ${t.claimExpiresAt} is not null)) and ((${t.state}='RETRY_WAIT')=(${t.availableAt} is not null)) and (${t.state}<>'COMPLETED' or ${t.artifactId} is not null) and (${t.failureCode} is null or ${t.failureCode} in ('STORAGE_UNAVAILABLE','STORAGE_MISSING','STORAGE_CONFLICT','STORAGE_INTEGRITY','DOCUMENT_INVALID','SETUP_REQUIRED','READING_HOLD','MAX_ATTEMPTS'))`),
 index("document_work_due").on(t.state,t.availableAt,t.updatedAt),
]);

// Private review evidence only: this table is never historical adoption authority.
export const etsyCandidateReviews = pgTable("etsy_candidate_reviews", {
 id:id(), organizationId:org(), storeId:store(), reviewedBy:text("reviewed_by").notNull().references(()=>users.id),
 shopId:text("shop_id").notNull(), receiptId:text("receipt_id").notNull(), transactionId:text("transaction_id").notNull(),
 listingId:text("listing_id").notNull(), selectionKey:text("selection_key").notNull(),
 productVersionId:uuid("product_version_id").notNull(), sourceFingerprint:text("source_fingerprint").notNull(),
 createdAt:time("created_at").defaultNow().notNull(), confirmedAt:time("confirmed_at"), invalidatedAt:time("invalidated_at"),
},t=>[
 foreignKey({name:"review_owned_store",columns:[t.organizationId,t.storeId],foreignColumns:[stores.organizationId,stores.id]}),
 foreignKey({name:"review_owned_version",columns:[t.organizationId,t.storeId,t.productVersionId],foreignColumns:[productVersions.organizationId,productVersions.storeId,productVersions.id]}),
 unique("review_evidence_replay").on(t.organizationId,t.storeId,t.reviewedBy,t.receiptId,t.transactionId,t.productVersionId,t.sourceFingerprint),
 check("review_ids",sql`${t.shopId} ~ '^[1-9][0-9]{0,19}$' and ${t.receiptId} ~ '^[1-9][0-9]{0,19}$' and ${t.transactionId} ~ '^[1-9][0-9]{0,19}$' and ${t.listingId} ~ '^[1-9][0-9]{0,19}$'`),
 check("review_fingerprint",sql`${t.sourceFingerprint} ~ '^[a-f0-9]{64}$'`),
 check("review_selection",sql`length(${t.selectionKey}) between 17 and 2000 and ${t.selectionKey} like 'etsy-selection/1:%'`),
]);

// Manual seller confirmation history; status is derived from the latest event per Reading.
export const manualDeliveryEvents=pgTable("manual_delivery_events",{
 id:id(),organizationId:org(),storeId:store(),readingId:uuid("reading_id").notNull(),artifactId:uuid("artifact_id").notNull(),
 sequence:integer("sequence").notNull(),action:text("action").notNull(),actorId:text("actor_id").notNull().references(()=>users.id),
 commandId:uuid("command_id").notNull(),commandHash:text("command_hash").notNull(),note:text("note").notNull().default(""),createdAt:time("created_at").notNull().defaultNow(),
},t=>[unique("manual_delivery_sequence").on(t.organizationId,t.storeId,t.readingId,t.sequence),unique("manual_delivery_command").on(t.organizationId,t.storeId,t.commandId),
 foreignKey({name:"manual_delivery_owned_unit_fk",columns:[t.organizationId,t.storeId,t.readingId],foreignColumns:[units.organizationId,units.storeId,units.id]}),
 foreignKey({name:"manual_delivery_exact_artifact_fk",columns:[t.organizationId,t.storeId,t.readingId,t.artifactId],foreignColumns:[documentArtifacts.organizationId,documentArtifacts.storeId,documentArtifacts.readingId,documentArtifacts.id]}),
 check("manual_delivery_events_sequence_check",sql`${t.sequence}>0`),check("manual_delivery_events_action_check",sql`${t.action} in ('CONFIRMED','CORRECTED')`),
 check("manual_delivery_events_command_hash_check",sql`${t.commandHash} ~ '^[a-f0-9]{64}$'`),check("manual_delivery_events_note_check",sql`length(${t.note})<=1000`)]);
