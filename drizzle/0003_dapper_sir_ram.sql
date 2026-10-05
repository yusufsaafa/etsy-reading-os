CREATE TABLE "product_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"configuration" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "version_owned_identity" UNIQUE("organization_id","store_id","id"),
	CONSTRAINT "version_product_identity" UNIQUE("organization_id","store_id","product_id","id"),
	CONSTRAINT "product_version_number" UNIQUE("organization_id","store_id","product_id","version_number"),
	CONSTRAINT "version_status" CHECK ("product_versions"."status" in ('DRAFT','ACTIVE','ARCHIVED')),
	CONSTRAINT "version_number_positive" CHECK ("product_versions"."version_number">0 and "product_versions"."revision">=0),
	CONSTRAINT "version_activation_time" CHECK (("product_versions"."status"='DRAFT') = ("product_versions"."activated_at" is null)),
	CONSTRAINT "configuration_structure" CHECK (jsonb_typeof("product_versions"."configuration")='object' and jsonb_typeof("product_versions"."configuration"->'inputs')='array' and jsonb_typeof("product_versions"."configuration"->'sections')='array')
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"active_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_owned_identity" UNIQUE("organization_id","store_id","id"),
	CONSTRAINT "product_status" CHECK ("products"."status" in ('draft','active')),
	CONSTRAINT "product_active_pointer" CHECK (("products"."status"='active') = ("products"."active_version_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "listing_mappings" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "fulfillment_units" ADD COLUMN "product_version_id" uuid;--> statement-breakpoint
ALTER TABLE "fulfillment_units" ADD COLUMN "configuration_state" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_versions" ADD CONSTRAINT "version_owned_product_fk" FOREIGN KEY ("organization_id","store_id","product_id") REFERENCES "public"."products"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "product_owned_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "product_active_version_fk" FOREIGN KEY ("organization_id","store_id","id","active_version_id") REFERENCES "public"."product_versions"("organization_id","store_id","product_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_product_version" ON "product_versions" USING btree ("organization_id","store_id","product_id") WHERE "product_versions"."status"='ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "one_product_draft" ON "product_versions" USING btree ("organization_id","store_id","product_id") WHERE "product_versions"."status"='DRAFT';--> statement-breakpoint
ALTER TABLE "listing_mappings" ADD CONSTRAINT "mapping_owned_product_fk" FOREIGN KEY ("organization_id","store_id","product_id") REFERENCES "public"."products"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_units" ADD CONSTRAINT "unit_owned_version_fk" FOREIGN KEY ("organization_id","store_id","product_version_id") REFERENCES "public"."product_versions"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_units" ADD CONSTRAINT "unit_configuration_state" CHECK ("fulfillment_units"."configuration_state" in ('legacy','unconfigured','versioned') and (("fulfillment_units"."configuration_state"='versioned') = ("fulfillment_units"."product_version_id" is not null)));--> statement-breakpoint
-- Published configuration is immutable, including against accidental direct repository writes.
CREATE FUNCTION protect_product_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'DRAFT' THEN RAISE EXCEPTION 'CREATE_DRAFT_FIRST'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'PUBLISHED_VERSION_IMMUTABLE'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.id<>NEW.id OR OLD.product_id<>NEW.product_id OR OLD.organization_id<>NEW.organization_id OR OLD.store_id<>NEW.store_id OR OLD.version_number<>NEW.version_number OR OLD.created_at<>NEW.created_at THEN RAISE EXCEPTION 'VERSION_IDENTITY_IMMUTABLE'; END IF;
  IF OLD.status<>'DRAFT' AND (OLD.configuration IS DISTINCT FROM NEW.configuration OR OLD.revision<>NEW.revision OR OLD.activated_at IS DISTINCT FROM NEW.activated_at OR (NEW.status<>OLD.status AND NOT (OLD.status='ACTIVE' AND NEW.status='ARCHIVED'))) THEN RAISE EXCEPTION 'PUBLISHED_VERSION_IMMUTABLE'; END IF;
  IF NEW.status='ACTIVE' AND OLD.status='DRAFT' THEN
    IF jsonb_typeof(NEW.configuration->'inputs') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.configuration->'sections') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_PRODUCT_CONFIGURATION'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.configuration->'inputs') WITH ORDINALITY a(field,n) WHERE jsonb_typeof(field) IS DISTINCT FROM 'object' OR coalesce(field->>'key','') !~ '^[a-z][a-z0-9_]{0,63}$' OR length(trim(coalesce(field->>'label','')))=0 OR coalesce(field->>'type','') NOT IN ('TEXT','LONG_TEXT','DATE') OR jsonb_typeof(field->'required') IS DISTINCT FROM 'boolean' OR field->>'sortOrder' IS DISTINCT FROM (n-1)::text)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.configuration->'inputs') a GROUP BY a->>'key' HAVING count(*)>1)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.configuration->'sections') WITH ORDINALITY a(section,n) WHERE length(trim(coalesce(section->>'title','')))=0 OR section->>'sortOrder' IS DISTINCT FROM (n-1)::text)
    THEN RAISE EXCEPTION 'INVALID_PRODUCT_CONFIGURATION'; END IF;
    IF jsonb_array_length(NEW.configuration->'sections')=0 OR NEW.configuration->>'output' NOT IN ('TEXT','PDF') OR NEW.configuration->>'workflow' NOT IN ('MANUAL','ASSISTED') OR NEW.configuration->>'output' IS NULL OR NEW.configuration->>'workflow' IS NULL THEN RAISE EXCEPTION 'INVALID_PRODUCT_CONFIGURATION'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_published_version BEFORE INSERT OR UPDATE OR DELETE ON product_versions FOR EACH ROW EXECUTE FUNCTION protect_product_version();
--> statement-breakpoint
CREATE FUNCTION check_active_product_pointer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p products%ROWTYPE; target uuid;
BEGIN
 IF TG_TABLE_NAME='products' THEN target:=NEW.id; ELSIF TG_OP='DELETE' THEN target:=OLD.product_id; ELSE target:=NEW.product_id; END IF;
 SELECT * INTO p FROM products WHERE id=target;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF p.active_version_id IS NULL THEN
   IF EXISTS(SELECT 1 FROM product_versions WHERE product_id=p.id AND status='ACTIVE') THEN RAISE EXCEPTION 'ACTIVE_VERSION_POINTER_REQUIRED'; END IF;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM product_versions WHERE id=p.active_version_id AND product_id=p.id AND status='ACTIVE') THEN RAISE EXCEPTION 'ACTIVE_VERSION_POINTER_INVALID'; END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER product_pointer_consistent AFTER INSERT OR UPDATE ON products DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_active_product_pointer();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER version_pointer_consistent AFTER INSERT OR UPDATE OR DELETE ON product_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_active_product_pointer();
--> statement-breakpoint
CREATE FUNCTION protect_unit_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (OLD.product_version_id IS DISTINCT FROM NEW.product_version_id OR OLD.configuration_state<>NEW.configuration_state) THEN RAISE EXCEPTION 'UNIT_CONFIGURATION_IMMUTABLE'; END IF;
 IF TG_OP='INSERT' AND NEW.product_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM product_versions WHERE id=NEW.product_version_id AND organization_id=NEW.organization_id AND store_id=NEW.store_id AND status='ACTIVE') THEN RAISE EXCEPTION 'ACTIVE_CONFIGURATION_REQUIRED'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER unit_configuration_immutable BEFORE INSERT OR UPDATE ON fulfillment_units FOR EACH ROW EXECUTE FUNCTION protect_unit_configuration();
