CREATE TABLE "seller_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"short_bio" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_one_per_store" UNIQUE("organization_id","store_id"),
	CONSTRAINT "seller_owned_identity" UNIQUE("organization_id","store_id","id"),
	CONSTRAINT "seller_identity_valid" CHECK (length(trim("seller_profiles"."display_name")) between 1 and 100 and length("seller_profiles"."short_bio")<=1000)
);
--> statement-breakpoint
CREATE TABLE "style_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"active_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "style_one_per_store" UNIQUE("organization_id","store_id"),
	CONSTRAINT "style_owned_identity" UNIQUE("organization_id","store_id","id")
);
--> statement-breakpoint
CREATE TABLE "style_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source_type" text DEFAULT 'PASTED_TEXT' NOT NULL,
	"source_text" text NOT NULL,
	"content_hash" text NOT NULL,
	"command_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_command_unique" UNIQUE("organization_id","store_id","command_key"),
	CONSTRAINT "source_owned_identity" UNIQUE("organization_id","store_id","id"),
	CONSTRAINT "source_text_valid" CHECK ("style_sources"."source_type"='PASTED_TEXT' and length(trim("style_sources"."title")) between 1 and 150 and length(trim("style_sources"."source_text")) between 1 and 50000 and "style_sources"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "style_profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"style_profile_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"configuration" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "style_version_owned_identity" UNIQUE("organization_id","store_id","id"),
	CONSTRAINT "style_version_profile_identity" UNIQUE("organization_id","store_id","style_profile_id","id"),
	CONSTRAINT "style_version_number" UNIQUE("organization_id","store_id","style_profile_id","version_number"),
	CONSTRAINT "style_version_status" CHECK ("style_profile_versions"."status" in ('DRAFT','ACTIVE','ARCHIVED')),
	CONSTRAINT "style_version_positive" CHECK ("style_profile_versions"."version_number">0 and "style_profile_versions"."revision">=0),
	CONSTRAINT "style_activation_time" CHECK (("style_profile_versions"."status"='DRAFT')=("style_profile_versions"."activated_at" is null)),
	CONSTRAINT "style_configuration_structure" CHECK (jsonb_typeof("style_profile_versions"."configuration")='object' and jsonb_typeof("style_profile_versions"."configuration"->'preferredExpressions')='array' and jsonb_typeof("style_profile_versions"."configuration"->'avoidExpressions')='array' and jsonb_typeof("style_profile_versions"."configuration"->'instructions')='string')
);
--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_owned_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_owned_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_active_version_fk" FOREIGN KEY ("organization_id","store_id","id","active_version_id") REFERENCES "public"."style_profile_versions"("organization_id","store_id","style_profile_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_sources" ADD CONSTRAINT "source_owned_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_profile_versions" ADD CONSTRAINT "style_version_owned_profile_fk" FOREIGN KEY ("organization_id","store_id","style_profile_id") REFERENCES "public"."style_profiles"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_style_version" ON "style_profile_versions" USING btree ("organization_id","store_id","style_profile_id") WHERE "style_profile_versions"."status"='ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "one_style_draft" ON "style_profile_versions" USING btree ("organization_id","store_id","style_profile_id") WHERE "style_profile_versions"."status"='DRAFT';--> statement-breakpoint
-- Keep these handwritten invariants in future migrations; snapshots do not model triggers.
CREATE FUNCTION protect_style_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.status<>'DRAFT' THEN RAISE EXCEPTION 'CREATE_STYLE_DRAFT_FIRST'; END IF;
   RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
   IF OLD.status<>'DRAFT' THEN RAISE EXCEPTION 'PUBLISHED_STYLE_IMMUTABLE'; END IF;
   RETURN OLD;
 END IF;
 IF ROW(OLD.id,OLD.organization_id,OLD.store_id,OLD.style_profile_id,OLD.version_number,OLD.created_at) IS DISTINCT FROM ROW(NEW.id,NEW.organization_id,NEW.store_id,NEW.style_profile_id,NEW.version_number,NEW.created_at) THEN RAISE EXCEPTION 'STYLE_IDENTITY_IMMUTABLE'; END IF;
 IF OLD.status<>'DRAFT' AND (OLD.configuration IS DISTINCT FROM NEW.configuration OR OLD.revision<>NEW.revision OR OLD.activated_at IS DISTINCT FROM NEW.activated_at OR (NEW.status<>OLD.status AND NOT(OLD.status='ACTIVE' AND NEW.status='ARCHIVED'))) THEN RAISE EXCEPTION 'PUBLISHED_STYLE_IMMUTABLE'; END IF;
 IF NEW.status='ACTIVE' AND OLD.status='DRAFT' THEN
   IF coalesce(NEW.configuration->>'tone','') NOT IN ('WARM','DIRECT','REASSURING','NEUTRAL','CUSTOM') OR coalesce(NEW.configuration->>'detail','') NOT IN ('CONCISE','BALANCED','DETAILED') OR coalesce(NEW.configuration->>'approach','') NOT IN ('CONVERSATIONAL','STRUCTURED','REFLECTIVE','CUSTOM') OR jsonb_typeof(NEW.configuration->'preferredExpressions') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.configuration->'avoidExpressions') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.configuration->'instructions') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_STYLE_CONFIGURATION'; END IF;
   IF jsonb_array_length(NEW.configuration->'preferredExpressions')>30 OR jsonb_array_length(NEW.configuration->'avoidExpressions')>30 OR length(NEW.configuration->>'instructions')>4000 OR EXISTS(SELECT 1 FROM jsonb_array_elements((NEW.configuration->'preferredExpressions') || (NEW.configuration->'avoidExpressions')) a WHERE jsonb_typeof(a) IS DISTINCT FROM 'string' OR length(trim(a #>> '{}')) NOT BETWEEN 1 AND 300) THEN RAISE EXCEPTION 'INVALID_STYLE_CONFIGURATION'; END IF;
   IF (NEW.configuration->>'tone'='CUSTOM' OR NEW.configuration->>'approach'='CUSTOM') AND length(trim(NEW.configuration->>'instructions'))=0 THEN RAISE EXCEPTION 'CUSTOM_STYLE_GUIDANCE_REQUIRED'; END IF;
   IF NOT EXISTS(SELECT 1 FROM seller_profiles WHERE organization_id=NEW.organization_id AND store_id=NEW.store_id) THEN RAISE EXCEPTION 'SELLER_PROFILE_REQUIRED'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_published_style BEFORE INSERT OR UPDATE OR DELETE ON style_profile_versions FOR EACH ROW EXECUTE FUNCTION protect_style_version();
--> statement-breakpoint
CREATE FUNCTION check_active_style_pointer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p style_profiles%ROWTYPE; target uuid;
BEGIN
 IF TG_TABLE_NAME='style_profiles' THEN target:=NEW.id; ELSIF TG_OP='DELETE' THEN target:=OLD.style_profile_id; ELSE target:=NEW.style_profile_id; END IF;
 SELECT * INTO p FROM style_profiles WHERE id=target;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF p.active_version_id IS NULL THEN
   IF EXISTS(SELECT 1 FROM style_profile_versions WHERE style_profile_id=p.id AND status='ACTIVE') THEN RAISE EXCEPTION 'ACTIVE_STYLE_POINTER_REQUIRED'; END IF;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM style_profile_versions WHERE id=p.active_version_id AND style_profile_id=p.id AND status='ACTIVE') THEN RAISE EXCEPTION 'ACTIVE_STYLE_POINTER_INVALID'; END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER style_pointer_consistent AFTER INSERT OR UPDATE ON style_profiles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_active_style_pointer();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER style_version_pointer_consistent AFTER INSERT OR UPDATE OR DELETE ON style_profile_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_active_style_pointer();
--> statement-breakpoint
CREATE FUNCTION protect_previous_work() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'PREVIOUS_WORK_IMMUTABLE';
END $$;
--> statement-breakpoint
CREATE TRIGGER previous_work_immutable BEFORE UPDATE ON style_sources FOR EACH ROW EXECUTE FUNCTION protect_previous_work();
