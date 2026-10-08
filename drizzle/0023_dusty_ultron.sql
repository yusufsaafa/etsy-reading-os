ALTER TABLE "etsy_historical_adoptions" DROP CONSTRAINT "etsy_adoption_purchase_unique";--> statement-breakpoint
ALTER TABLE "etsy_historical_adoptions" ADD COLUMN "transaction_id" text;--> statement-breakpoint
ALTER TABLE "etsy_historical_adoptions" ADD COLUMN "shop_id" text;--> statement-breakpoint
ALTER TABLE "etsy_historical_adoptions" ADD COLUMN "source_fingerprint" text;--> statement-breakpoint
CREATE UNIQUE INDEX "etsy_adoption_legacy_purchase_unique" ON "etsy_historical_adoptions" USING btree ("organization_id","store_id","receipt_id","listing_id","selection_key") WHERE "etsy_historical_adoptions"."transaction_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "etsy_adoption_line_unique" ON "etsy_historical_adoptions" USING btree ("organization_id","store_id","receipt_id","transaction_id") WHERE "etsy_historical_adoptions"."transaction_id" is not null;--> statement-breakpoint
ALTER TABLE "etsy_historical_adoptions" ADD CONSTRAINT "etsy_adoption_line_evidence" CHECK (("etsy_historical_adoptions"."transaction_id" is null and "etsy_historical_adoptions"."shop_id" is null and "etsy_historical_adoptions"."source_fingerprint" is null) or ("etsy_historical_adoptions"."transaction_id" is not null and "etsy_historical_adoptions"."shop_id" is not null and "etsy_historical_adoptions"."source_fingerprint" is not null and "etsy_historical_adoptions"."transaction_id" ~ '^[1-9][0-9]{0,19}$' and "etsy_historical_adoptions"."shop_id" ~ '^[1-9][0-9]{0,19}$' and "etsy_historical_adoptions"."source_fingerprint" ~ '^[a-f0-9]{64}$'));--> statement-breakpoint
-- Existing append-only adoption trigger also protects the new evidence columns.
CREATE FUNCTION guard_etsy_adoption_shop() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.transaction_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM stores WHERE id=NEW.store_id AND organization_id=NEW.organization_id AND external_shop_id=NEW.shop_id) THEN RAISE EXCEPTION 'Historical adoption shop mismatch'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER etsy_adoption_shop_guard BEFORE INSERT ON etsy_historical_adoptions FOR EACH ROW EXECUTE FUNCTION guard_etsy_adoption_shop();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_unit_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (OLD.product_version_id IS DISTINCT FROM NEW.product_version_id OR OLD.configuration_state<>NEW.configuration_state) THEN RAISE EXCEPTION 'UNIT_CONFIGURATION_IMMUTABLE'; END IF;
 IF TG_OP='INSERT' AND NEW.product_version_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM product_versions v WHERE v.id=NEW.product_version_id AND v.organization_id=NEW.organization_id AND v.store_id=NEW.store_id
   AND (v.status='ACTIVE' OR (v.status='ARCHIVED' AND EXISTS(
    SELECT 1 FROM etsy_historical_adoptions a JOIN order_line_items l ON l.id=NEW.line_item_id AND l.organization_id=a.organization_id AND l.store_id=a.store_id
     JOIN orders o ON o.id=l.order_id AND o.organization_id=a.organization_id AND o.store_id=a.store_id
    WHERE a.organization_id=NEW.organization_id AND a.store_id=NEW.store_id AND a.product_version_id=v.id
     AND a.receipt_id=o.external_id AND a.transaction_id=l.external_id AND a.listing_id=l.listing_external_id AND a.selection_key=l.variant_key
     AND a.shop_id=l.snapshot#>>'{etsySource,receipt,shopId}' AND a.source_fingerprint IS NOT NULL
     AND (l.snapshot#>>'{etsySource,receipt,createdTimestamp,value}')::bigint BETWEEN a.purchase_from AND a.purchase_through
   )))
 ) THEN RAISE EXCEPTION 'ACTIVE_CONFIGURATION_REQUIRED'; END IF;
 RETURN NEW;
END $$;
