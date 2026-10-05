import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, unique, foreignKey, check, index, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { Configuration } from "../modules/products/contracts";
import type { Answer, ExternalOrder, ExternalListing, InputPolicy } from "../modules/intake/contracts";

const id = () => uuid("id").defaultRandom().primaryKey();
const org = () => uuid("organization_id").notNull();
const store = () => uuid("store_id").notNull();
const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
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
}, t => [unique().on(t.organizationId, t.storeId, t.externalId), foreignKey({ columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] })]);
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
}, t => [unique().on(t.organizationId, t.storeId, t.externalId), unique().on(t.organizationId, t.storeId, t.id), foreignKey({ columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }), index("order_store_created").on(t.organizationId, t.storeId, t.createdAt)]);
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
