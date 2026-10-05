CREATE TABLE "listing_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"listing_external_id" text NOT NULL,
	"selected_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "selection_store_listing_unique" UNIQUE("organization_id","store_id","listing_external_id")
);
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "onboarding_stage" text DEFAULT 'complete' NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_selections" ADD CONSTRAINT "listing_selections_selected_by_app_users_id_fk" FOREIGN KEY ("selected_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_selections" ADD CONSTRAINT "selection_owned_listing_fk" FOREIGN KEY ("organization_id","store_id","listing_external_id") REFERENCES "public"."listings"("organization_id","store_id","external_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "onboarding_stage" CHECK ("stores"."onboarding_stage" in ('etsy','products','product_setup','complete'));