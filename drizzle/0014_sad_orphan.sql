ALTER TABLE "reading_reviews" ADD CONSTRAINT "review_owned_identity" UNIQUE("organization_id","store_id","id");
--> statement-breakpoint
CREATE TABLE "reading_review_drafts" (
	"review_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"content" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_draft_revision" CHECK ("reading_review_drafts"."revision">=0)
);
--> statement-breakpoint
ALTER TABLE "reading_review_drafts" ADD CONSTRAINT "draft_owned_review_fk" FOREIGN KEY ("organization_id","store_id","review_id") REFERENCES "public"."reading_reviews"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
--> statement-breakpoint
CREATE FUNCTION protect_review_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Review draft cannot be reset'; END IF;
 IF TG_OP='UPDATE' AND (NEW.review_id<>OLD.review_id OR NEW.organization_id<>OLD.organization_id OR NEW.store_id<>OLD.store_id OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'Review draft identity or revision is invalid'; END IF;
 IF TG_OP='INSERT' AND NEW.revision<>0 THEN RAISE EXCEPTION 'Review draft must begin at zero'; END IF;
 SELECT g.result INTO base FROM reading_reviews r JOIN generations g ON g.id=r.generation_id AND g.organization_id=r.organization_id AND g.store_id=r.store_id
 WHERE r.id=NEW.review_id AND r.organization_id=NEW.organization_id AND r.store_id=NEW.store_id AND r.state='PENDING';
 IF base IS NULL OR jsonb_typeof(NEW.content)<>'object' OR jsonb_typeof(NEW.content->'sections') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Review draft structure is invalid'; END IF;
 IF jsonb_array_length(NEW.content->'sections')<>jsonb_array_length(base->'sections') THEN RAISE EXCEPTION 'Review draft sections are fixed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.content->'sections') WITH ORDINALITY s(section,n) WHERE
 s.section->>'sectionId' IS DISTINCT FROM (base->'sections'->(s.n::int-1)->>'sectionId') OR
 s.section->>'title' IS DISTINCT FROM (base->'sections'->(s.n::int-1)->>'title') OR jsonb_typeof(s.section->'content') IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'Review draft sections are fixed'; END IF;
 IF TG_OP='INSERT' AND NEW.content<>base THEN RAISE EXCEPTION 'Review draft begins from pinned evidence'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER review_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON reading_review_drafts FOR EACH ROW EXECUTE FUNCTION protect_review_draft();
