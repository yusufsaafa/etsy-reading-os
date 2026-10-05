CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"resource_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "etsy_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"encrypted_tokens" text,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone,
	"epoch" integer DEFAULT 0 NOT NULL,
	"last_sync_at" timestamp with time zone,
	"refresh_claim" uuid,
	"refresh_started_at" timestamp with time zone,
	CONSTRAINT "etsy_connections_organization_id_store_id_unique" UNIQUE("organization_id","store_id"),
	CONSTRAINT "connection_status" CHECK ("etsy_connections"."status" in ('disconnected','connected','reauthorization_required'))
);
--> statement-breakpoint
CREATE TABLE "customer_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"answers" jsonb NOT NULL,
	"source" text NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_inputs_organization_id_store_id_unit_id_revision_unique" UNIQUE("organization_id","store_id","unit_id","revision")
);
--> statement-breakpoint
CREATE TABLE "order_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"listing_external_id" text NOT NULL,
	"title" text NOT NULL,
	"quantity" integer NOT NULL,
	"sku" text,
	"variant_key" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "order_line_items_organization_id_store_id_external_id_unique" UNIQUE("organization_id","store_id","external_id"),
	CONSTRAINT "order_line_items_organization_id_store_id_id_unique" UNIQUE("organization_id","store_id","id"),
	CONSTRAINT "line_quantity_positive" CHECK ("order_line_items"."quantity" between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"source_updated_at" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "listings_organization_id_store_id_external_id_unique" UNIQUE("organization_id","store_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "listing_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"listing_external_id" text NOT NULL,
	"variant_key" text NOT NULL,
	"label" text NOT NULL,
	"required_inputs" jsonb NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	CONSTRAINT "listing_mappings_organization_id_store_id_listing_external_id_variant_key_unique" UNIQUE("organization_id","store_id","listing_external_id","variant_key")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	CONSTRAINT "memberships_organization_id_user_id_unique" UNIQUE("organization_id","user_id"),
	CONSTRAINT "membership_role" CHECK ("memberships"."role" in ('owner', 'operator'))
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"encrypted_verifier" text NOT NULL,
	"connection_epoch" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "oauth_states_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"buyer_name" text NOT NULL,
	"paid" boolean NOT NULL,
	"canceled" boolean NOT NULL,
	"refund" text NOT NULL,
	"source_updated_at" integer NOT NULL,
	"purchased_snapshot" jsonb NOT NULL,
	"latest_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "orders_organization_id_store_id_external_id_unique" UNIQUE("organization_id","store_id","external_id"),
	CONSTRAINT "orders_organization_id_store_id_id_unique" UNIQUE("organization_id","store_id","id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"external_shop_id" text,
	"source" text DEFAULT 'fixtures' NOT NULL,
	"import_since" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "stores_source_external_shop_id_unique" UNIQUE("source","external_shop_id"),
	CONSTRAINT "store_source" CHECK ("stores"."source" in ('fixtures','etsy'))
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"command_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"connection_epoch" integer NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claim" uuid,
	"lease_until" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checkpoint" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_runs_organization_id_store_id_command_key_unique" UNIQUE("organization_id","store_id","command_key"),
	CONSTRAINT "sync_status" CHECK ("sync_runs"."status" in ('queued','running','succeeded','failed','canceled'))
);
--> statement-breakpoint
CREATE TABLE "fulfillment_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"line_item_id" uuid NOT NULL,
	"unit_index" integer NOT NULL,
	"issues" jsonb NOT NULL,
	"source_changed" boolean DEFAULT false NOT NULL,
	"context_allocated" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "fulfillment_units_organization_id_store_id_line_item_id_unit_index_unique" UNIQUE("organization_id","store_id","line_item_id","unit_index"),
	CONSTRAINT "fulfillment_units_organization_id_store_id_id_unique" UNIQUE("organization_id","store_id","id"),
	CONSTRAINT "unit_index_positive" CHECK ("fulfillment_units"."unit_index" >= 1)
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_store_id_stores_organization_id_id_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etsy_connections" ADD CONSTRAINT "etsy_connections_organization_id_store_id_stores_organization_id_id_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_inputs" ADD CONSTRAINT "customer_inputs_organization_id_store_id_unit_id_fulfillment_units_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","unit_id") REFERENCES "public"."fulfillment_units"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_organization_id_store_id_order_id_orders_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","order_id") REFERENCES "public"."orders"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_organization_id_store_id_stores_organization_id_id_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_mappings" ADD CONSTRAINT "listing_mappings_organization_id_store_id_listing_external_id_listings_organization_id_store_id_external_id_fk" FOREIGN KEY ("organization_id","store_id","listing_external_id") REFERENCES "public"."listings"("organization_id","store_id","external_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_organization_id_store_id_stores_organization_id_id_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_store_id_stores_organization_id_id_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_organization_id_store_id_stores_organization_id_id_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_units" ADD CONSTRAINT "fulfillment_units_organization_id_store_id_line_item_id_order_line_items_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","line_item_id") REFERENCES "public"."order_line_items"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_store_created" ON "orders" USING btree ("organization_id","store_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_sync_per_store" ON "sync_runs" USING btree ("organization_id","store_id") WHERE "sync_runs"."status" in ('queued','running');