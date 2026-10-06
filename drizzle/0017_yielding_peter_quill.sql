CREATE TABLE "document_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"reading_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"design_id" uuid NOT NULL,
	"design_revision" integer NOT NULL,
	"snapshot_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "document_snapshot_intent" UNIQUE("organization_id","store_id","reading_id","review_id","design_id","design_revision","snapshot_hash"),
	CONSTRAINT "document_snapshot_bounds" CHECK ("document_snapshots"."design_revision">=0 and "document_snapshots"."snapshot_hash" ~ '^[a-f0-9]{64}$' and jsonb_typeof("document_snapshots"."payload")='object' and ("document_snapshots"."payload"->>'contractVersion') is not distinct from 'document-snapshot/v1' and octet_length("document_snapshots"."payload"::text)<=650000)
);
--> statement-breakpoint
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_organization_id_store_id_reading_id_fulfillment_units_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","reading_id") REFERENCES "public"."fulfillment_units"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_organization_id_store_id_order_id_orders_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","order_id") REFERENCES "public"."orders"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_organization_id_store_id_product_id_products_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","product_id") REFERENCES "public"."products"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_organization_id_store_id_review_id_reading_reviews_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","review_id") REFERENCES "public"."reading_reviews"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_organization_id_store_id_reading_id_generation_id_generations_organization_id_store_id_unit_id_id_fk" FOREIGN KEY ("organization_id","store_id","reading_id","generation_id") REFERENCES "public"."generations"("organization_id","store_id","unit_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_organization_id_store_id_design_id_document_designs_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","design_id") REFERENCES "public"."document_designs"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_snapshot_reading" ON "document_snapshots" USING btree ("organization_id","store_id","reading_id","created_at");--> statement-breakpoint
CREATE FUNCTION protect_document_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE approved reading_reviews%ROWTYPE; design document_designs%ROWTYPE;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Document snapshot is immutable'; END IF;
 SELECT * INTO approved FROM reading_reviews WHERE id=NEW.review_id AND organization_id=NEW.organization_id AND store_id=NEW.store_id AND unit_id=NEW.reading_id AND generation_id=NEW.generation_id AND state='APPROVED';
 SELECT * INTO design FROM document_designs WHERE id=NEW.design_id AND organization_id=NEW.organization_id AND store_id=NEW.store_id AND status='ACTIVE' FOR SHARE;
 IF approved.id IS NULL OR design.id IS NULL OR design.revision <> NEW.design_revision OR
  NEW.payload->'reading'->'sections' IS DISTINCT FROM approved.approved_content->'sections' OR
  NEW.payload->'reading'->>'contentHash' IS DISTINCT FROM approved.approved_content_hash OR
  NEW.payload->'design'->'configuration' IS DISTINCT FROM design.configuration OR
  NEW.payload->>'id' IS DISTINCT FROM NEW.id::text OR
  NEW.payload->>'organizationId' IS DISTINCT FROM NEW.organization_id::text OR
  NEW.payload->>'storeId' IS DISTINCT FROM NEW.store_id::text OR
  NEW.payload->'reading'->>'readingId' IS DISTINCT FROM NEW.reading_id::text OR
  NEW.payload->'reading'->'order'->>'id' IS DISTINCT FROM NEW.order_id::text OR
  NEW.payload->'reading'->'product'->>'id' IS DISTINCT FROM NEW.product_id::text OR
  NEW.payload->'provenance'->>'reviewId' IS DISTINCT FROM NEW.review_id::text OR
  NEW.payload->'provenance'->>'generationId' IS DISTINCT FROM NEW.generation_id::text OR
  NEW.payload->'design'->>'id' IS DISTINCT FROM NEW.design_id::text OR
  NEW.payload->'design'->>'revision' IS DISTINCT FROM NEW.design_revision::text OR
  NEW.payload->>'snapshotHash' IS DISTINCT FROM NEW.snapshot_hash OR
  (NEW.payload->>'createdAt')::timestamptz IS DISTINCT FROM NEW.created_at THEN
   RAISE EXCEPTION 'Invalid document snapshot provenance';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM fulfillment_units u JOIN order_line_items l ON l.id=u.line_item_id AND l.organization_id=u.organization_id AND l.store_id=u.store_id
  JOIN generations g ON g.id=NEW.generation_id AND g.unit_id=u.id AND g.organization_id=u.organization_id AND g.store_id=u.store_id AND g.product_version_id=u.product_version_id
  JOIN product_versions p ON p.id=g.product_version_id AND p.organization_id=u.organization_id AND p.store_id=u.store_id
  WHERE u.id=NEW.reading_id AND u.organization_id=NEW.organization_id AND u.store_id=NEW.store_id AND l.order_id=NEW.order_id AND p.product_id=NEW.product_id) THEN
   RAISE EXCEPTION 'Invalid document snapshot relationship';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON document_snapshots FOR EACH ROW EXECUTE FUNCTION protect_document_snapshot();
