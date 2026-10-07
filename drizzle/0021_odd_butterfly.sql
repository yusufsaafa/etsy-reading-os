CREATE TABLE "etsy_historical_adoptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"receipt_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"selection_key" text NOT NULL,
	"product_version_id" uuid NOT NULL,
	"authorized_by" text NOT NULL,
	"purchase_from" bigint NOT NULL,
	"purchase_through" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "etsy_adoption_command_unique" UNIQUE("organization_id","store_id","command_id"),
	CONSTRAINT "etsy_adoption_purchase_unique" UNIQUE("organization_id","store_id","receipt_id","listing_id","selection_key"),
	CONSTRAINT "etsy_adoption_ids" CHECK ("etsy_historical_adoptions"."receipt_id" ~ '^[1-9][0-9]{0,19}$' and "etsy_historical_adoptions"."listing_id" ~ '^[1-9][0-9]{0,19}$'),
	CONSTRAINT "etsy_adoption_key" CHECK (length("etsy_historical_adoptions"."selection_key") between 17 and 2000 and "etsy_historical_adoptions"."selection_key" like 'etsy-selection/1:%'),
	CONSTRAINT "etsy_adoption_bounds" CHECK ("etsy_historical_adoptions"."purchase_from" >= 0 and "etsy_historical_adoptions"."purchase_through" >= "etsy_historical_adoptions"."purchase_from" and "etsy_historical_adoptions"."purchase_through" <= 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "etsy_historical_adoptions" ADD CONSTRAINT "etsy_historical_adoptions_authorized_by_app_users_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etsy_historical_adoptions" ADD CONSTRAINT "etsy_adoption_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etsy_historical_adoptions" ADD CONSTRAINT "etsy_adoption_version_fk" FOREIGN KEY ("organization_id","store_id","product_version_id") REFERENCES "public"."product_versions"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION guard_etsy_historical_adoption() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Historical adoption is immutable';
  END IF;
  PERFORM 1 FROM stores WHERE organization_id=NEW.organization_id AND id=NEW.store_id FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM memberships WHERE organization_id=NEW.organization_id
      AND user_id=NEW.authorized_by AND role='owner'
  ) THEN RAISE EXCEPTION 'Historical adoption requires owner'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM product_versions v JOIN listing_mappings m
      ON m.organization_id=v.organization_id AND m.store_id=v.store_id AND m.product_id=v.product_id
    WHERE v.organization_id=NEW.organization_id AND v.store_id=NEW.store_id AND v.id=NEW.product_version_id
      AND v.status IN ('ACTIVE','ARCHIVED') AND v.activated_at IS NOT NULL
      AND NEW.purchase_through < ceil(extract(epoch FROM v.activated_at))
      AND v.configuration->'etsyFulfillment'->>'listingId'=NEW.listing_id
      AND m.listing_external_id=NEW.listing_id AND m.variant_key=NEW.selection_key
  ) THEN RAISE EXCEPTION 'Historical adoption requires approved owned mapping'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER etsy_historical_adoption_guard BEFORE INSERT OR UPDATE OR DELETE
ON etsy_historical_adoptions FOR EACH ROW EXECUTE FUNCTION guard_etsy_historical_adoption();
