ALTER TABLE "reading_reviews" DROP CONSTRAINT "review_state";--> statement-breakpoint
ALTER TABLE "reading_reviews" ADD COLUMN "approved_content" jsonb;--> statement-breakpoint
ALTER TABLE "reading_reviews" ADD COLUMN "approved_draft_revision" integer;--> statement-breakpoint
ALTER TABLE "reading_reviews" ADD COLUMN "approved_content_hash" text;--> statement-breakpoint
ALTER TABLE "reading_reviews" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reading_reviews" ADD COLUMN "approved_by_user_id" text CONSTRAINT "reading_reviews_approved_by_user_id_app_users_id_fk" REFERENCES "app_users"("id");--> statement-breakpoint
ALTER TABLE "reading_reviews" ADD CONSTRAINT "review_approval_complete" CHECK (("reading_reviews"."state"='PENDING' AND "reading_reviews"."approved_by_user_id" IS NULL AND "reading_reviews"."approved_content" IS NULL AND "reading_reviews"."approved_draft_revision" IS NULL AND "reading_reviews"."approved_content_hash" IS NULL AND "reading_reviews"."approved_at" IS NULL) OR ("reading_reviews"."state"='APPROVED' AND "reading_reviews"."approved_by_user_id" IS NOT NULL AND "reading_reviews"."approved_content" IS NOT NULL AND "reading_reviews"."approved_content_hash" IS NOT NULL AND "reading_reviews"."approved_content_hash" ~ '^[a-f0-9]{64}$' AND "reading_reviews"."approved_at" IS NOT NULL AND ("reading_reviews"."approved_draft_revision" IS NULL OR "reading_reviews"."approved_draft_revision">=0)));--> statement-breakpoint
ALTER TABLE "reading_reviews" ADD CONSTRAINT "review_state" CHECK ("reading_reviews"."state" IN ('PENDING','APPROVED'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_review_base() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base jsonb; draft jsonb; rev integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Review base is immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'PENDING' THEN RAISE EXCEPTION 'Review must begin pending'; END IF;
 ELSE
  IF OLD.state<>'PENDING' OR NEW.state<>'APPROVED' OR
   (NEW.id,NEW.organization_id,NEW.store_id,NEW.unit_id,NEW.generation_id,NEW.created_at) IS DISTINCT FROM
   (OLD.id,OLD.organization_id,OLD.store_id,OLD.unit_id,OLD.generation_id,OLD.created_at) THEN
   RAISE EXCEPTION 'Review approval is immutable';
  END IF;
 END IF;
 SELECT g.result INTO base FROM generations g WHERE g.id=NEW.generation_id AND g.organization_id=NEW.organization_id AND g.store_id=NEW.store_id AND g.unit_id=NEW.unit_id AND g.status='SUCCEEDED' AND g.result IS NOT NULL AND g.completed_at IS NOT NULL;
 IF base IS NULL THEN RAISE EXCEPTION 'Review requires successful reading evidence'; END IF;
 IF TG_OP='UPDATE' THEN
  SELECT d.content,d.revision INTO draft,rev FROM reading_review_drafts d WHERE d.review_id=NEW.id AND d.organization_id=NEW.organization_id AND d.store_id=NEW.store_id FOR UPDATE;
  IF NEW.approved_content IS DISTINCT FROM coalesce(draft,base) OR NEW.approved_draft_revision IS DISTINCT FROM rev THEN
   RAISE EXCEPTION 'Approval must freeze current durable reading';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION lock_pending_review_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_state text;
BEGIN
 SELECT state INTO current_state FROM reading_reviews WHERE id=NEW.review_id AND organization_id=NEW.organization_id AND store_id=NEW.store_id FOR UPDATE;
 IF current_state IS DISTINCT FROM 'PENDING' THEN RAISE EXCEPTION 'Approved reading cannot be edited'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER draft_approval_lock BEFORE INSERT OR UPDATE ON reading_review_drafts FOR EACH ROW EXECUTE FUNCTION lock_pending_review_draft();
