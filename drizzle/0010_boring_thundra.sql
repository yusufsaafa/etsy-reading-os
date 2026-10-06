CREATE TABLE "style_analysis_sources" (
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"analysis_version_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	CONSTRAINT "analysis_source_unique" UNIQUE("organization_id","store_id","analysis_version_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "style_analysis_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"style_profile_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"contract_version" text NOT NULL,
	"operation_version" text NOT NULL,
	"payload" jsonb,
	"ai_request_id" uuid,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "analysis_owned_identity" UNIQUE("organization_id","store_id","id"),
	CONSTRAINT "analysis_profile_version_number" UNIQUE("organization_id","store_id","style_profile_id","version_number"),
	CONSTRAINT "analysis_version_positive" CHECK ("style_analysis_versions"."version_number">0),
	CONSTRAINT "analysis_contract" CHECK ("style_analysis_versions"."contract_version"='style-intelligence/v1' and "style_analysis_versions"."operation_version"='style-analysis/v1'),
	CONSTRAINT "analysis_lifecycle" CHECK ("style_analysis_versions"."status" in ('DRAFT','PENDING','ANALYZING','READY','FAILED') and
 (("style_analysis_versions"."status" in ('READY','FAILED'))=("style_analysis_versions"."completed_at" is not null)) and
 (("style_analysis_versions"."status"='READY')=("style_analysis_versions"."payload" is not null)) and (("style_analysis_versions"."status"='FAILED')=("style_analysis_versions"."failure_code" is not null)) and
 ("style_analysis_versions"."status"<>'ANALYZING' or "style_analysis_versions"."started_at" is not null) and
 ("style_analysis_versions"."failure_code" is null or "style_analysis_versions"."failure_code" in ('INVALID_RESULT','PROVIDER_FAILURE','CANCELED','INTERNAL_FAILURE')))
);
--> statement-breakpoint
ALTER TABLE "style_analysis_sources" ADD CONSTRAINT "analysis_source_owned_version_fk" FOREIGN KEY ("organization_id","store_id","analysis_version_id") REFERENCES "public"."style_analysis_versions"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_analysis_sources" ADD CONSTRAINT "analysis_source_owned_source_fk" FOREIGN KEY ("organization_id","store_id","source_id") REFERENCES "public"."style_sources"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_analysis_versions" ADD CONSTRAINT "analysis_owned_profile_fk" FOREIGN KEY ("organization_id","store_id","style_profile_id") REFERENCES "public"."style_profiles"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_analysis_versions" ADD CONSTRAINT "analysis_owned_request_fk" FOREIGN KEY ("organization_id","store_id","ai_request_id") REFERENCES "public"."ai_requests"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_source_reverse_lookup" ON "style_analysis_sources" USING btree ("organization_id","store_id","source_id");--> statement-breakpoint
CREATE INDEX "analysis_latest_attempt" ON "style_analysis_versions" USING btree ("organization_id","store_id","style_profile_id","version_number");--> statement-breakpoint
CREATE INDEX "analysis_latest_usable" ON "style_analysis_versions" USING btree ("organization_id","store_id","style_profile_id","version_number") WHERE "style_analysis_versions"."status"='READY';--> statement-breakpoint
-- Handwritten invariants: retain these guards in subsequent migrations.
CREATE FUNCTION valid_style_intelligence(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; a jsonb; item jsonb;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT (p ?& ARRAY['contractVersion','voiceSummary','tone','structure','diction','sentenceAndParagraph','personalization','uncertainty','formatting','preferredPatterns','avoidedPatterns','generationGuidance']) OR
 (p - ARRAY['contractVersion','voiceSummary','tone','structure','diction','sentenceAndParagraph','personalization','uncertainty','formatting','preferredPatterns','avoidedPatterns','generationGuidance']) <> '{}'::jsonb THEN RETURN false; END IF;
 IF p->>'contractVersion' IS DISTINCT FROM 'style-intelligence/v1' OR jsonb_typeof(p->'voiceSummary') IS DISTINCT FROM 'string' OR length(trim(p->>'voiceSummary')) NOT BETWEEN 1 AND 600 THEN RETURN false; END IF;
 IF jsonb_typeof(p->'structure') IS DISTINCT FROM 'object' OR NOT ((p->'structure') ?& ARRAY['opening','development','transitions','closing']) OR ((p->'structure') - ARRAY['opening','development','transitions','closing']) <> '{}'::jsonb THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['tone','diction','sentenceAndParagraph','personalization','uncertainty','formatting','preferredPatterns','avoidedPatterns','opening','development','transitions','closing','generationGuidance'] LOOP
   IF k IN ('opening','development','transitions','closing') THEN a:=p->'structure'->k; ELSE a:=p->k; END IF;
   IF jsonb_typeof(a) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
   IF k='generationGuidance' THEN
     IF jsonb_array_length(a) NOT BETWEEN 1 AND 8 THEN RETURN false; END IF;
   ELSIF jsonb_array_length(a)>6 THEN RETURN false; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(a) LOOP
     IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR length(trim(item #>> '{}')) NOT BETWEEN 1 AND (CASE WHEN k='generationGuidance' THEN 300 ELSE 240 END) THEN RETURN false; END IF;
   END LOOP;
 END LOOP;
 RETURN true;
END $$;
--> statement-breakpoint
ALTER TABLE style_analysis_versions ADD CONSTRAINT analysis_payload_valid CHECK (payload IS NULL OR valid_style_intelligence(payload));
--> statement-breakpoint
CREATE FUNCTION protect_style_analysis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.status<>'DRAFT' OR NEW.ai_request_id IS NOT NULL OR NEW.started_at IS NOT NULL THEN RAISE EXCEPTION 'CREATE_ANALYSIS_SHELL_FIRST'; END IF;
   RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ANALYSIS_HISTORY_IMMUTABLE'; END IF;
 IF OLD.status IN ('READY','FAILED') THEN RAISE EXCEPTION 'TERMINAL_ANALYSIS_IMMUTABLE'; END IF;
 IF ROW(OLD.id,OLD.organization_id,OLD.store_id,OLD.style_profile_id,OLD.version_number,OLD.contract_version,OLD.operation_version,OLD.created_at) IS DISTINCT FROM ROW(NEW.id,NEW.organization_id,NEW.store_id,NEW.style_profile_id,NEW.version_number,NEW.contract_version,NEW.operation_version,NEW.created_at) THEN RAISE EXCEPTION 'ANALYSIS_IDENTITY_IMMUTABLE'; END IF;
 IF NOT ((OLD.status='DRAFT' AND NEW.status='PENDING') OR (OLD.status='PENDING' AND NEW.status IN ('ANALYZING','READY','FAILED')) OR (OLD.status='ANALYZING' AND NEW.status IN ('READY','FAILED'))) THEN RAISE EXCEPTION 'INVALID_ANALYSIS_TRANSITION'; END IF;
 IF OLD.started_at IS NOT NULL AND OLD.started_at IS DISTINCT FROM NEW.started_at THEN RAISE EXCEPTION 'ANALYSIS_START_IMMUTABLE'; END IF;
 IF NEW.status='PENDING' AND (NEW.started_at IS NOT NULL OR NEW.ai_request_id IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_PENDING_ANALYSIS'; END IF;
 IF NEW.ai_request_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ai_requests r WHERE r.id=NEW.ai_request_id AND r.organization_id=NEW.organization_id AND r.store_id=NEW.store_id AND r.operation=NEW.operation_version AND (NEW.status<>'READY' OR r.status='SUCCEEDED')) THEN RAISE EXCEPTION 'INVALID_ANALYSIS_AI_PROVENANCE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_style_analysis BEFORE INSERT OR UPDATE OR DELETE ON style_analysis_versions FOR EACH ROW EXECUTE FUNCTION protect_style_analysis();
--> statement-breakpoint
CREATE FUNCTION protect_analysis_source_set() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'ANALYSIS_SOURCES_IMMUTABLE'; END IF;
 SELECT status INTO s FROM style_analysis_versions WHERE id=NEW.analysis_version_id AND organization_id=NEW.organization_id AND store_id=NEW.store_id FOR UPDATE;
 IF s IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'ANALYSIS_SOURCES_FROZEN'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_analysis_sources BEFORE INSERT OR UPDATE OR DELETE ON style_analysis_sources FOR EACH ROW EXECUTE FUNCTION protect_analysis_source_set();
--> statement-breakpoint
CREATE FUNCTION check_analysis_source_set() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v style_analysis_versions%ROWTYPE; n integer;
BEGIN
 SELECT * INTO v FROM style_analysis_versions WHERE id=NEW.id;
 SELECT count(*) INTO n FROM style_analysis_sources WHERE analysis_version_id=v.id AND organization_id=v.organization_id AND store_id=v.store_id;
 IF v.status='DRAFT' OR n NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'ANALYSIS_SOURCE_SET_REQUIRED'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER analysis_sources_sealed AFTER INSERT OR UPDATE ON style_analysis_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_analysis_source_set();
