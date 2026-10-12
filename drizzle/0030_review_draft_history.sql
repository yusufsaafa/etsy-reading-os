-- Retain saved draft bodies; original generation and approval guards are unchanged.
CREATE TABLE reading_review_draft_versions (
 review_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 store_id uuid NOT NULL,
 revision integer NOT NULL CHECK (revision >= 0),
 content jsonb NOT NULL,
 saved_at timestamptz NOT NULL,
 CONSTRAINT review_draft_version_identity UNIQUE (review_id, revision),
 CONSTRAINT draft_version_owned_review_fk FOREIGN KEY (organization_id,store_id,review_id)
 REFERENCES reading_reviews (organization_id,store_id,id)
);
--> statement-breakpoint
-- Only the currently persisted, validated draft can be archived. Older bodies
-- cannot be fabricated by an application caller; archive rows cannot change.
CREATE FUNCTION protect_review_draft_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Review draft history is immutable'; END IF;
 IF NOT EXISTS (SELECT 1 FROM reading_review_drafts d WHERE
  d.review_id=NEW.review_id AND d.organization_id=NEW.organization_id
  AND d.store_id=NEW.store_id AND d.revision=NEW.revision
  AND d.content=NEW.content AND d.updated_at=NEW.saved_at)
 THEN RAISE EXCEPTION 'Review draft history requires persisted evidence'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER review_draft_version_guard BEFORE INSERT OR UPDATE OR DELETE
 ON reading_review_draft_versions FOR EACH ROW EXECUTE FUNCTION protect_review_draft_version();
--> statement-breakpoint
CREATE FUNCTION archive_review_draft_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO reading_review_draft_versions(review_id,organization_id,store_id,revision,content,saved_at)
 VALUES(NEW.review_id,NEW.organization_id,NEW.store_id,NEW.revision,NEW.content,NEW.updated_at);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER review_draft_archive AFTER INSERT OR UPDATE ON reading_review_drafts
 FOR EACH ROW EXECUTE FUNCTION archive_review_draft_version();
--> statement-breakpoint
-- Retain existing current revisions only; unavailable older bodies are not invented.
INSERT INTO reading_review_draft_versions(review_id,organization_id,store_id,revision,content,saved_at)
 SELECT review_id,organization_id,store_id,revision,content,updated_at FROM reading_review_drafts;
