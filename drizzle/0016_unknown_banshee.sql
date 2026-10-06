CREATE TABLE "document_designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"configuration" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_design_owned_identity" UNIQUE("organization_id","store_id","id"),
	CONSTRAINT "document_design_state" CHECK ("document_designs"."status" in ('ACTIVE','ARCHIVED') and (not "document_designs"."is_default" or "document_designs"."status" = 'ACTIVE')),
	CONSTRAINT "document_design_bounds" CHECK ("document_designs"."revision" >= 0 and length(trim("document_designs"."name")) between 1 and 100 and jsonb_typeof("document_designs"."configuration") = 'object' and "document_designs"."configuration"->>'contractVersion' = 'document-design/v1' and octet_length("document_designs"."configuration"::text) <= 8192)
);
--> statement-breakpoint
CREATE TABLE "product_document_designs" (
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"design_id" uuid NOT NULL,
	CONSTRAINT "product_document_design_one_assignment" UNIQUE("organization_id","store_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "document_designs" ADD CONSTRAINT "document_designs_organization_id_store_id_stores_organization_id_id_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_document_designs" ADD CONSTRAINT "product_document_designs_organization_id_store_id_product_id_products_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","product_id") REFERENCES "public"."products"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_document_designs" ADD CONSTRAINT "product_document_designs_organization_id_store_id_design_id_document_designs_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","design_id") REFERENCES "public"."document_designs"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_design_one_default" ON "document_designs" USING btree ("organization_id","store_id") WHERE "document_designs"."is_default";--> statement-breakpoint
CREATE INDEX "product_document_design_references" ON "product_document_designs" USING btree ("organization_id","store_id","design_id");--> statement-breakpoint
CREATE FUNCTION guard_document_design() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Document designs must be archived'; END IF;
  IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.store_id <> OLD.store_id OR NEW.created_at <> OLD.created_at OR OLD.status = 'ARCHIVED' OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Invalid document design transition';
  END IF;
  IF NEW.status = 'ARCHIVED' AND (OLD.is_default OR EXISTS (SELECT 1 FROM product_document_designs WHERE design_id = OLD.id)) THEN
    RAISE EXCEPTION 'Document design is in use';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_design_guard BEFORE UPDATE OR DELETE ON document_designs FOR EACH ROW EXECUTE FUNCTION guard_document_design();
--> statement-breakpoint
CREATE FUNCTION guard_product_document_design() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE design_status text;
BEGIN
  SELECT status INTO design_status FROM document_designs WHERE id = NEW.design_id AND organization_id = NEW.organization_id AND store_id = NEW.store_id FOR UPDATE;
  IF design_status IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Document design unavailable'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER product_document_design_guard BEFORE INSERT OR UPDATE ON product_document_designs FOR EACH ROW EXECUTE FUNCTION guard_product_document_design();
