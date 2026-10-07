CREATE TABLE "document_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"reading_id" uuid NOT NULL,
	"document_snapshot_id" uuid NOT NULL,
	"media_snapshot_id" uuid NOT NULL,
	"renderer_version" text NOT NULL,
	"layout_hash" text NOT NULL,
	"resource_hash" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_length" integer NOT NULL,
	"page_count" integer NOT NULL,
	"content_type" text DEFAULT 'application/pdf' NOT NULL,
	"object_key" text NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone,
	CONSTRAINT "artifact_owned_identity" UNIQUE("organization_id","store_id","id"),
	CONSTRAINT "artifact_render_intent" UNIQUE("organization_id","store_id","reading_id","document_snapshot_id","media_snapshot_id","renderer_version"),
	CONSTRAINT "artifact_object_identity" UNIQUE("object_key"),
	CONSTRAINT "artifact_bounds" CHECK ("document_artifacts"."renderer_version"='reading-pdf/1' and "document_artifacts"."content_type"='application/pdf' and "document_artifacts"."layout_hash" ~ '^[a-f0-9]{64}$' and "document_artifacts"."resource_hash" ~ '^[a-f0-9]{64}$' and "document_artifacts"."sha256" ~ '^[a-f0-9]{64}$' and "document_artifacts"."byte_length" between 1 and 134217728 and "document_artifacts"."page_count" between 2 and 1000 and length("document_artifacts"."object_key")<=400),
	CONSTRAINT "artifact_lifecycle" CHECK ("document_artifacts"."state" in ('PENDING','AVAILABLE') and (("document_artifacts"."state"='AVAILABLE')=("document_artifacts"."available_at" is not null)) and ("document_artifacts"."available_at" is null or "document_artifacts"."available_at">="document_artifacts"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "document_production" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"reading_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"media_snapshot_id" uuid,
	"artifact_id" uuid,
	"state" text DEFAULT 'WAITING' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"claim_token" uuid,
	"claim_expires_at" timestamp with time zone,
	"available_at" timestamp with time zone,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_production_approval" UNIQUE("organization_id","store_id","reading_id","review_id"),
	CONSTRAINT "document_work_state" CHECK ("document_production"."state" in ('WAITING','PROCESSING','RETRY_WAIT','ATTENTION','COMPLETED') and "document_production"."attempt" between 0 and 3 and (("document_production"."state"='PROCESSING')=("document_production"."claim_token" is not null and "document_production"."claim_expires_at" is not null)) and (("document_production"."state"='RETRY_WAIT')=("document_production"."available_at" is not null)) and ("document_production"."state"<>'COMPLETED' or "document_production"."artifact_id" is not null) and ("document_production"."failure_code" is null or "document_production"."failure_code" in ('STORAGE_UNAVAILABLE','STORAGE_MISSING','STORAGE_CONFLICT','STORAGE_INTEGRITY','DOCUMENT_INVALID','SETUP_REQUIRED','READING_HOLD','MAX_ATTEMPTS')))
);
--> statement-breakpoint
ALTER TABLE "document_artifacts" ADD CONSTRAINT "document_artifacts_organization_id_store_id_reading_id_fulfillment_units_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","reading_id") REFERENCES "public"."fulfillment_units"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_artifacts" ADD CONSTRAINT "document_artifacts_organization_id_store_id_order_id_orders_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","order_id") REFERENCES "public"."orders"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_artifacts" ADD CONSTRAINT "document_artifacts_document_snapshot_id_document_snapshots_id_fk" FOREIGN KEY ("document_snapshot_id") REFERENCES "public"."document_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_artifacts" ADD CONSTRAINT "document_artifacts_media_snapshot_id_document_media_snapshots_id_fk" FOREIGN KEY ("media_snapshot_id") REFERENCES "public"."document_media_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_production" ADD CONSTRAINT "document_production_organization_id_store_id_reading_id_fulfillment_units_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","reading_id") REFERENCES "public"."fulfillment_units"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_production" ADD CONSTRAINT "document_production_organization_id_store_id_order_id_orders_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","order_id") REFERENCES "public"."orders"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_production" ADD CONSTRAINT "document_production_organization_id_store_id_review_id_reading_reviews_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","review_id") REFERENCES "public"."reading_reviews"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_production" ADD CONSTRAINT "document_production_media_snapshot_id_document_media_snapshots_id_fk" FOREIGN KEY ("media_snapshot_id") REFERENCES "public"."document_media_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_production" ADD CONSTRAINT "document_production_organization_id_store_id_artifact_id_document_artifacts_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","artifact_id") REFERENCES "public"."document_artifacts"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_owned_reading" ON "document_artifacts" USING btree ("organization_id","store_id","reading_id","created_at");--> statement-breakpoint
CREATE INDEX "document_work_due" ON "document_production" USING btree ("state","available_at","updated_at");
--> statement-breakpoint
CREATE FUNCTION protect_document_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d document_snapshots%ROWTYPE; m document_media_snapshots%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Document artifacts cannot be deleted'; END IF;
 PERFORM 1 FROM stores WHERE organization_id=NEW.organization_id AND id=NEW.store_id FOR UPDATE;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'state'-'available_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'available_at') OR
   NOT (OLD.state='PENDING' AND NEW.state='AVAILABLE' AND NEW.available_at IS NOT NULL) THEN RAISE EXCEPTION 'Artifact evidence is immutable'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO d FROM document_snapshots WHERE id=NEW.document_snapshot_id AND organization_id=NEW.organization_id AND store_id=NEW.store_id AND reading_id=NEW.reading_id AND order_id=NEW.order_id;
 SELECT * INTO m FROM document_media_snapshots WHERE id=NEW.media_snapshot_id AND document_snapshot_id=d.id AND organization_id=NEW.organization_id AND store_id=NEW.store_id AND reading_id=NEW.reading_id;
 IF d.id IS NULL OR m.id IS NULL OR NOT EXISTS(SELECT 1 FROM generations g WHERE g.id=d.generation_id AND g.context->'product'->'configuration'->>'output'='PDF') OR NEW.state<>'PENDING' OR NEW.available_at IS NOT NULL OR
  NEW.object_key IS DISTINCT FROM ('private/documents/v1/'||NEW.organization_id||'/'||NEW.store_id||'/'||NEW.reading_id||'/'||NEW.media_snapshot_id||'/'||replace(NEW.renderer_version,'/','-')||'/'||NEW.sha256||'.pdf') THEN RAISE EXCEPTION 'Invalid artifact provenance/key'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_artifact_guard BEFORE INSERT OR UPDATE OR DELETE ON document_artifacts FOR EACH ROW EXECUTE FUNCTION protect_document_artifact();
--> statement-breakpoint
CREATE FUNCTION protect_document_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r reading_reviews%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Document production history cannot be deleted'; END IF;
 PERFORM 1 FROM stores WHERE organization_id=NEW.organization_id AND id=NEW.store_id FOR UPDATE;
 SELECT * INTO r FROM reading_reviews WHERE id=NEW.review_id AND organization_id=NEW.organization_id AND store_id=NEW.store_id AND unit_id=NEW.reading_id AND state='APPROVED';
 IF r.id IS NULL OR NOT EXISTS(SELECT 1 FROM generations g WHERE g.id=r.generation_id AND g.context->'product'->'configuration'->>'output'='PDF') OR NOT EXISTS(SELECT 1 FROM fulfillment_units u JOIN order_line_items l ON l.id=u.line_item_id WHERE u.id=NEW.reading_id AND u.organization_id=NEW.organization_id AND u.store_id=NEW.store_id AND l.order_id=NEW.order_id) THEN RAISE EXCEPTION 'Invalid document work ownership'; END IF;
 IF TG_OP='INSERT' AND (NEW.state<>'WAITING' OR NEW.attempt<>0 OR NEW.media_snapshot_id IS NOT NULL OR NEW.artifact_id IS NOT NULL) THEN RAISE EXCEPTION 'Invalid initial document work'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.store_id<>OLD.store_id OR NEW.order_id<>OLD.order_id OR NEW.reading_id<>OLD.reading_id OR NEW.review_id<>OLD.review_id OR NEW.created_at<>OLD.created_at OR
   (OLD.media_snapshot_id IS NOT NULL AND NEW.media_snapshot_id IS DISTINCT FROM OLD.media_snapshot_id) OR
   (OLD.artifact_id IS NOT NULL AND NEW.artifact_id IS DISTINCT FROM OLD.artifact_id) OR OLD.state='COMPLETED' THEN RAISE EXCEPTION 'Document work identity is immutable'; END IF;
  IF NOT ((NEW.state='PROCESSING' AND OLD.state IN ('WAITING','RETRY_WAIT','PROCESSING') AND NEW.attempt=OLD.attempt+1 AND NEW.claim_token IS DISTINCT FROM OLD.claim_token AND
    (OLD.state<>'PROCESSING' OR OLD.claim_expires_at<=clock_timestamp()) AND (OLD.state<>'RETRY_WAIT' OR OLD.available_at<=clock_timestamp())) OR
   (OLD.state='PROCESSING' AND NEW.state IN ('PROCESSING','COMPLETED','RETRY_WAIT','ATTENTION') AND NEW.attempt=OLD.attempt AND (NEW.state<>'PROCESSING' OR NEW.claim_token=OLD.claim_token)) OR
   (OLD.state='ATTENTION' AND NEW.state='WAITING' AND NEW.attempt=0)) THEN RAISE EXCEPTION 'Invalid document work transition'; END IF;
 END IF;
 IF NEW.media_snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM document_media_snapshots WHERE id=NEW.media_snapshot_id AND organization_id=NEW.organization_id AND store_id=NEW.store_id AND reading_id=NEW.reading_id AND review_id=NEW.review_id) THEN RAISE EXCEPTION 'Invalid document work media'; END IF;
 IF NEW.artifact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM document_artifacts WHERE id=NEW.artifact_id AND organization_id=NEW.organization_id AND store_id=NEW.store_id AND reading_id=NEW.reading_id AND media_snapshot_id=NEW.media_snapshot_id AND (NEW.state<>'COMPLETED' OR state='AVAILABLE')) THEN RAISE EXCEPTION 'Invalid document work artifact'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_work_guard BEFORE INSERT OR UPDATE OR DELETE ON document_production FOR EACH ROW EXECUTE FUNCTION protect_document_work();

--> statement-breakpoint
ALTER TABLE document_production ADD CONSTRAINT document_claim_pair CHECK ((claim_token IS NULL)=(claim_expires_at IS NULL));
--> statement-breakpoint
ALTER TABLE document_production ADD CONSTRAINT document_failure_complete CHECK ((state IN ('RETRY_WAIT','ATTENTION'))=(failure_code IS NOT NULL));
