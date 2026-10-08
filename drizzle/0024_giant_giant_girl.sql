CREATE TABLE "etsy_candidate_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"reviewed_by" text NOT NULL,
	"shop_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"selection_key" text NOT NULL,
	"product_version_id" uuid NOT NULL,
	"source_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	CONSTRAINT "review_evidence_replay" UNIQUE("organization_id","store_id","reviewed_by","receipt_id","transaction_id","product_version_id","source_fingerprint"),
	CONSTRAINT "review_ids" CHECK ("etsy_candidate_reviews"."shop_id" ~ '^[1-9][0-9]{0,19}$' and "etsy_candidate_reviews"."receipt_id" ~ '^[1-9][0-9]{0,19}$' and "etsy_candidate_reviews"."transaction_id" ~ '^[1-9][0-9]{0,19}$' and "etsy_candidate_reviews"."listing_id" ~ '^[1-9][0-9]{0,19}$'),
	CONSTRAINT "review_fingerprint" CHECK ("etsy_candidate_reviews"."source_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "review_selection" CHECK (length("etsy_candidate_reviews"."selection_key") between 17 and 2000 and "etsy_candidate_reviews"."selection_key" like 'etsy-selection/1:%')
);
--> statement-breakpoint
ALTER TABLE "etsy_candidate_reviews" ADD CONSTRAINT "etsy_candidate_reviews_reviewed_by_app_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etsy_candidate_reviews" ADD CONSTRAINT "review_owned_store" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etsy_candidate_reviews" ADD CONSTRAINT "review_owned_version" FOREIGN KEY ("organization_id","store_id","product_version_id") REFERENCES "public"."product_versions"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION protect_etsy_candidate_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Candidate review evidence is retained'; END IF;
 IF TG_OP = 'INSERT' THEN
  IF NOT EXISTS (SELECT 1 FROM stores WHERE id=NEW.store_id AND organization_id=NEW.organization_id AND external_shop_id=NEW.shop_id) THEN RAISE EXCEPTION 'Review shop mismatch'; END IF;
 ELSE
  IF (to_jsonb(NEW) - 'confirmed_at' - 'invalidated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'confirmed_at' - 'invalidated_at') THEN RAISE EXCEPTION 'Immutable candidate review evidence'; END IF;
  IF OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN RAISE EXCEPTION 'Immutable review confirmation'; END IF;
  IF OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at THEN RAISE EXCEPTION 'Immutable review invalidation'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER etsy_candidate_review_guard BEFORE INSERT OR UPDATE OR DELETE ON etsy_candidate_reviews FOR EACH ROW EXECUTE FUNCTION protect_etsy_candidate_review();
