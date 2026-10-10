CREATE TABLE "catalog_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"shop_id" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text,
	"rank" integer,
	"active_listing_count" integer,
	"present" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone,
	CONSTRAINT "catalog_section_identity" UNIQUE("organization_id","store_id","external_id"),
	CONSTRAINT "catalog_section_bounds" CHECK (("catalog_sections"."rank" is null or "catalog_sections"."rank">=0) and ("catalog_sections"."active_listing_count" is null or "catalog_sections"."active_listing_count">=0) and ("catalog_sections"."title" is null or length("catalog_sections"."title") between 1 and 500) and (not "catalog_sections"."present" or ("catalog_sections"."title" is not null and "catalog_sections"."rank" is not null and "catalog_sections"."active_listing_count" is not null and "catalog_sections"."verified_at" is not null)))
);
--> statement-breakpoint
CREATE TABLE "catalog_sync" (
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"shop_id" text NOT NULL,
	"status" text DEFAULT 'NOT_SYNCED' NOT NULL,
	"run_id" uuid,
	"claim" uuid,
	"claim_until" timestamp with time zone,
	"epoch" integer,
	"cursor" jsonb,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"sections_verified_at" timestamp with time zone,
	"processed" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "catalog_sync_store" UNIQUE("organization_id","store_id"),
	CONSTRAINT "catalog_sync_status" CHECK ("catalog_sync"."status" in ('NOT_SYNCED','IN_PROGRESS','SUCCEEDED','PARTIAL','FAILED')),
	CONSTRAINT "catalog_sync_claim" CHECK (("catalog_sync"."claim" is null) = ("catalog_sync"."claim_until" is null)),
	CONSTRAINT "catalog_sync_bounds" CHECK ("catalog_sync"."processed">=0 and "catalog_sync"."failures">=0 and jsonb_array_length("catalog_sync"."issues")<=10)
);
--> statement-breakpoint
CREATE TABLE "listing_catalog" (
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"listing_external_id" text NOT NULL,
	"shop_id" text NOT NULL,
	"thumbnail_url" text,
	"listing_url" text,
	"source_created_at" integer,
	"section_id" text,
	"section_state" text DEFAULT 'UNKNOWN' NOT NULL,
	"section_verified_at" timestamp with time zone,
	"verified_at" timestamp with time zone NOT NULL,
	"seen_run" uuid NOT NULL,
	"present" boolean DEFAULT true NOT NULL,
	"setup_catalog" jsonb,
	"choices_source_updated_at" integer,
	"choices_verified_at" timestamp with time zone,
	"choices_attempted_at" timestamp with time zone,
	"choices_error" text,
	CONSTRAINT "listing_catalog_identity" UNIQUE("organization_id","store_id","listing_external_id"),
	CONSTRAINT "catalog_relation_state" CHECK ("listing_catalog"."section_state" in ('KNOWN','UNCATEGORIZED','UNKNOWN','MISSING') and (("listing_catalog"."section_state" in ('KNOWN','MISSING')) = ("listing_catalog"."section_id" is not null))),
	CONSTRAINT "catalog_snapshot_bound" CHECK ("listing_catalog"."setup_catalog" is null or octet_length("listing_catalog"."setup_catalog"::text)<=262144)
);
--> statement-breakpoint
ALTER TABLE "catalog_sections" ADD CONSTRAINT "catalog_sections_organization_id_store_id_stores_organization_id_id_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_sync" ADD CONSTRAINT "catalog_sync_organization_id_store_id_stores_organization_id_id_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_catalog" ADD CONSTRAINT "listing_catalog_organization_id_store_id_listing_external_id_listings_organization_id_store_id_external_id_fk" FOREIGN KEY ("organization_id","store_id","listing_external_id") REFERENCES "public"."listings"("organization_id","store_id","external_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_catalog" ADD CONSTRAINT "listing_catalog_organization_id_store_id_section_id_catalog_sections_organization_id_store_id_external_id_fk" FOREIGN KEY ("organization_id","store_id","section_id") REFERENCES "public"."catalog_sections"("organization_id","store_id","external_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_section_order" ON "catalog_sections" USING btree ("organization_id","store_id","present","rank","external_id");--> statement-breakpoint
CREATE INDEX "listing_catalog_section" ON "listing_catalog" USING btree ("organization_id","store_id","section_state","section_id");--> statement-breakpoint
CREATE INDEX "listing_catalog_seen" ON "listing_catalog" USING btree ("organization_id","store_id","seen_run","listing_external_id");--> statement-breakpoint
CREATE INDEX "listing_catalog_title" ON "listings" USING btree ("organization_id","store_id","title","external_id");--> statement-breakpoint
CREATE INDEX "listing_catalog_state" ON "listings" USING btree ("organization_id","store_id","state","title","external_id");