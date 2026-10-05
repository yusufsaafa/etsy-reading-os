import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, unique, foreignKey, check, index, uniqueIndex } from "drizzle-orm/pg-core";
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
export const mappings = pgTable("listing_mappings", {
  id: id(), organizationId: org(), storeId: store(), listingExternalId: text("listing_external_id").notNull(),
  variantKey: text("variant_key").notNull(), label: text("label").notNull(),
  required: jsonb("required_inputs").$type<InputPolicy>().notNull(), paused: boolean("paused").notNull().default(false),
}, t => [unique().on(t.organizationId, t.storeId, t.listingExternalId, t.variantKey), foreignKey({ columns: [t.organizationId, t.storeId, t.listingExternalId], foreignColumns: [listings.organizationId, listings.storeId, listings.externalId] })]);
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
  id: id(), organizationId: org(), storeId: store(), lineItemId: uuid("line_item_id").notNull(), unitIndex: integer("unit_index").notNull(),
  issues: jsonb("issues").$type<string[]>().notNull(), sourceChanged: boolean("source_changed").notNull().default(false),
  contextAllocated: boolean("context_allocated").notNull().default(false), revision: integer("revision").notNull().default(0),
}, t => [unique().on(t.organizationId, t.storeId, t.lineItemId, t.unitIndex), unique().on(t.organizationId, t.storeId, t.id), foreignKey({ columns: [t.organizationId, t.storeId, t.lineItemId], foreignColumns: [lineItems.organizationId, lineItems.storeId, lineItems.id] }), check("unit_index_positive", sql`${t.unitIndex} >= 1`)]);
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
