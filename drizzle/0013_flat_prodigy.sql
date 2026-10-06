ALTER TABLE "generations" ADD CONSTRAINT "generation_owned_reading_identity" UNIQUE("organization_id","store_id","unit_id","id");
--> statement-breakpoint
CREATE TABLE "reading_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_review_per_reading" UNIQUE("organization_id","store_id","unit_id"),
	CONSTRAINT "review_state" CHECK ("reading_reviews"."state"='PENDING')
);
--> statement-breakpoint
ALTER TABLE "reading_reviews" ADD CONSTRAINT "review_owned_reading_fk" FOREIGN KEY ("organization_id","store_id","unit_id") REFERENCES "public"."fulfillment_units"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_reviews" ADD CONSTRAINT "review_exact_generation_fk" FOREIGN KEY ("organization_id","store_id","unit_id","generation_id") REFERENCES "public"."generations"("organization_id","store_id","unit_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
--> statement-breakpoint
CREATE FUNCTION protect_review_base() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Review base is immutable'; END IF;
 IF NOT EXISTS (SELECT 1 FROM generations g WHERE g.id=NEW.generation_id AND g.organization_id=NEW.organization_id AND g.store_id=NEW.store_id AND g.unit_id=NEW.unit_id AND g.status='SUCCEEDED' AND g.result IS NOT NULL AND g.completed_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Review requires successful reading evidence';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER review_base_guard BEFORE INSERT OR UPDATE OR DELETE ON reading_reviews FOR EACH ROW EXECUTE FUNCTION protect_review_base();
