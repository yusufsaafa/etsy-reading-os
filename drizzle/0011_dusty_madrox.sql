ALTER TABLE "style_analysis_versions" DROP CONSTRAINT "analysis_lifecycle";--> statement-breakpoint
ALTER TABLE "ai_requests" ADD COLUMN "style_analysis_version_id" uuid;--> statement-breakpoint
ALTER TABLE "style_analysis_versions" ADD COLUMN "command_key" uuid;--> statement-breakpoint
ALTER TABLE "style_analysis_versions" ADD COLUMN "command_hash" text;--> statement-breakpoint
ALTER TABLE "style_analysis_versions" ADD COLUMN "input_manifest" jsonb;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "request_owned_analysis_fk" FOREIGN KEY ("organization_id","store_id","style_analysis_version_id") REFERENCES "public"."style_analysis_versions"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_request_per_style_analysis" ON "ai_requests" USING btree ("organization_id","store_id","style_analysis_version_id") WHERE "ai_requests"."style_analysis_version_id" is not null;--> statement-breakpoint
ALTER TABLE "style_analysis_versions" ADD CONSTRAINT "analysis_command_unique" UNIQUE("organization_id","store_id","command_key");--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "analysis_request_attribution" CHECK ("ai_requests"."style_analysis_version_id" is null or ("ai_requests"."operation"='style-analysis/v1' and "ai_requests"."generation_id" is null and "ai_requests"."attempt_number"=1 and "ai_requests"."parent_request_id" is null));--> statement-breakpoint
ALTER TABLE "style_analysis_versions" ADD CONSTRAINT "analysis_execution_metadata" CHECK (("style_analysis_versions"."command_key" is null and "style_analysis_versions"."command_hash" is null and "style_analysis_versions"."input_manifest" is null) or ("style_analysis_versions"."command_key" is not null and "style_analysis_versions"."command_hash" is not null and "style_analysis_versions"."command_hash" ~ '^[a-f0-9]{64}$' and "style_analysis_versions"."input_manifest" is not null));--> statement-breakpoint
ALTER TABLE "style_analysis_versions" ADD CONSTRAINT "analysis_lifecycle" CHECK ("style_analysis_versions"."status" in ('DRAFT','PENDING','ANALYZING','READY','FAILED') and
 (("style_analysis_versions"."status" in ('READY','FAILED'))=("style_analysis_versions"."completed_at" is not null)) and
 (("style_analysis_versions"."status"='READY')=("style_analysis_versions"."payload" is not null)) and (("style_analysis_versions"."status"='FAILED')=("style_analysis_versions"."failure_code" is not null)) and
 ("style_analysis_versions"."status"<>'ANALYZING' or "style_analysis_versions"."started_at" is not null) and
 ("style_analysis_versions"."failure_code" is null or "style_analysis_versions"."failure_code" in ('INVALID_RESULT','PROVIDER_FAILURE','CANCELED','INTERNAL_FAILURE','POLICY_REJECTED','BUDGET_REJECTED','AMBIGUOUS_EXECUTION')));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_style_analysis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.status<>'DRAFT' OR NEW.ai_request_id IS NOT NULL OR NEW.started_at IS NOT NULL THEN RAISE EXCEPTION 'CREATE_ANALYSIS_SHELL_FIRST'; END IF;
   RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ANALYSIS_HISTORY_IMMUTABLE'; END IF;
 IF OLD.status IN ('READY','FAILED') THEN RAISE EXCEPTION 'TERMINAL_ANALYSIS_IMMUTABLE'; END IF;
 IF ROW(OLD.id,OLD.organization_id,OLD.store_id,OLD.style_profile_id,OLD.version_number,OLD.contract_version,OLD.operation_version,OLD.created_at,OLD.command_key,OLD.command_hash,OLD.input_manifest) IS DISTINCT FROM ROW(NEW.id,NEW.organization_id,NEW.store_id,NEW.style_profile_id,NEW.version_number,NEW.contract_version,NEW.operation_version,NEW.created_at,NEW.command_key,NEW.command_hash,NEW.input_manifest) THEN RAISE EXCEPTION 'ANALYSIS_IDENTITY_IMMUTABLE'; END IF;
 IF NOT ((OLD.status='DRAFT' AND NEW.status='PENDING') OR (OLD.status='PENDING' AND NEW.status IN ('ANALYZING','READY','FAILED')) OR (OLD.status='ANALYZING' AND NEW.status IN ('READY','FAILED'))) THEN RAISE EXCEPTION 'INVALID_ANALYSIS_TRANSITION'; END IF;
 IF OLD.started_at IS NOT NULL AND OLD.started_at IS DISTINCT FROM NEW.started_at THEN RAISE EXCEPTION 'ANALYSIS_START_IMMUTABLE'; END IF;
 IF NEW.status='PENDING' AND (NEW.started_at IS NOT NULL OR NEW.ai_request_id IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_PENDING_ANALYSIS'; END IF;
 IF OLD.input_manifest IS NOT NULL AND OLD.ai_request_id IS NOT NULL AND OLD.ai_request_id IS DISTINCT FROM NEW.ai_request_id THEN RAISE EXCEPTION 'ANALYSIS_REQUEST_IMMUTABLE'; END IF;
 IF NEW.input_manifest IS NOT NULL AND NEW.status IN ('ANALYZING','READY') AND NEW.ai_request_id IS NULL THEN RAISE EXCEPTION 'ANALYSIS_ACCOUNTING_REQUIRED'; END IF;
 IF NEW.ai_request_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ai_requests r WHERE r.id=NEW.ai_request_id AND r.organization_id=NEW.organization_id AND r.store_id=NEW.store_id AND r.operation=NEW.operation_version AND (NEW.input_manifest IS NULL OR r.style_analysis_version_id=NEW.id) AND (NEW.status<>'READY' OR r.status='SUCCEEDED') AND (NEW.input_manifest IS NULL OR NEW.status<>'FAILED' OR r.status='FAILED')) THEN RAISE EXCEPTION 'INVALID_ANALYSIS_AI_PROVENANCE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- Immutable analysis attribution supplements the pre-existing AI attempt history guard.
CREATE FUNCTION protect_ai_analysis_attribution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.style_analysis_version_id IS DISTINCT FROM NEW.style_analysis_version_id THEN RAISE EXCEPTION 'AI_ANALYSIS_ATTRIBUTION_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ai_analysis_attribution_immutable BEFORE UPDATE ON ai_requests FOR EACH ROW EXECUTE FUNCTION protect_ai_analysis_attribution();
--> statement-breakpoint
CREATE FUNCTION valid_analysis_input_manifest(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s jsonb; n integer:=0; total integer:=0;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT (p ?& ARRAY['policyVersion','promptVersion','requestHash','inputBytes','maxOutputTokens','sources']) OR (p - ARRAY['policyVersion','promptVersion','requestHash','inputBytes','maxOutputTokens','sources'])<>'{}'::jsonb THEN RETURN false; END IF;
 IF p->>'policyVersion' IS DISTINCT FROM 'style-analysis-input/v1' OR p->>'promptVersion' IS DISTINCT FROM 'style-analysis-prompt/v1' OR coalesce(p->>'requestHash','') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p->'inputBytes') IS DISTINCT FROM 'number' OR (p->>'inputBytes')::integer NOT BETWEEN 1 AND 192000 OR p->'maxOutputTokens' IS DISTINCT FROM '8192'::jsonb OR jsonb_typeof(p->'sources') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(p->'sources') NOT BETWEEN 1 AND 6 THEN RETURN false; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p->'sources') LOOP
  n:=n+1;
  IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR NOT (s ?& ARRAY['sourceId','contentHash','ordinal','originalLength','includedLength','truncated','includedHash']) OR (s - ARRAY['sourceId','contentHash','ordinal','originalLength','includedLength','truncated','includedHash'])<>'{}'::jsonb THEN RETURN false; END IF;
  IF jsonb_typeof(s->'sourceId') IS DISTINCT FROM 'string' OR coalesce(s->>'sourceId','') !~ '^[a-f0-9-]{36}$' OR coalesce(s->>'contentHash','') !~ '^[a-f0-9]{64}$' OR coalesce(s->>'includedHash','') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(s->'ordinal') IS DISTINCT FROM 'number' OR s->'ordinal' IS DISTINCT FROM to_jsonb(n) OR jsonb_typeof(s->'originalLength') IS DISTINCT FROM 'number' OR jsonb_typeof(s->'includedLength') IS DISTINCT FROM 'number' OR (s->>'originalLength')::integer NOT BETWEEN 1 AND 50000 OR (s->>'includedLength')::integer NOT BETWEEN 1 AND 6000 OR (s->>'includedLength')::integer>(s->>'originalLength')::integer OR s->'truncated' IS DISTINCT FROM to_jsonb((s->>'includedLength')::integer<(s->>'originalLength')::integer) THEN RETURN false; END IF;
  total:=total+(s->>'includedLength')::integer;
 END LOOP;
 RETURN total<=24000 AND (SELECT count(DISTINCT value->>'sourceId') FROM jsonb_array_elements(p->'sources'))=n;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
ALTER TABLE style_analysis_versions ADD CONSTRAINT analysis_input_manifest_valid CHECK (input_manifest IS NULL OR valid_analysis_input_manifest(input_manifest));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_analysis_source_set() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v style_analysis_versions%ROWTYPE; n integer; included jsonb; src style_sources%ROWTYPE;
BEGIN
 SELECT * INTO v FROM style_analysis_versions WHERE id=NEW.id;
 SELECT count(*) INTO n FROM style_analysis_sources WHERE analysis_version_id=v.id AND organization_id=v.organization_id AND store_id=v.store_id;
 IF v.status='DRAFT' OR n NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'ANALYSIS_SOURCE_SET_REQUIRED'; END IF;
 IF v.input_manifest IS NOT NULL THEN
  IF n<>jsonb_array_length(v.input_manifest->'sources') THEN RAISE EXCEPTION 'ANALYSIS_MANIFEST_PROVENANCE_MISMATCH'; END IF;
  FOR included IN SELECT value FROM jsonb_array_elements(v.input_manifest->'sources') LOOP
   SELECT s.* INTO src FROM style_sources s JOIN style_analysis_sources m ON m.source_id=s.id AND m.organization_id=s.organization_id AND m.store_id=s.store_id WHERE m.analysis_version_id=v.id AND m.organization_id=v.organization_id AND m.store_id=v.store_id AND s.id=(included->>'sourceId')::uuid;
   IF NOT FOUND OR src.content_hash IS DISTINCT FROM included->>'contentHash' OR length(src.source_text)<>(included->>'originalLength')::integer OR encode(sha256(convert_to(substring(src.source_text from 1 for (included->>'includedLength')::integer),'UTF8')),'hex') IS DISTINCT FROM included->>'includedHash' THEN RAISE EXCEPTION 'ANALYSIS_MANIFEST_PROVENANCE_MISMATCH'; END IF;
  END LOOP;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION check_style_analysis_request_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v style_analysis_versions%ROWTYPE; r ai_requests%ROWTYPE;
BEGIN
 SELECT * INTO r FROM ai_requests WHERE id=NEW.id;
 IF r.style_analysis_version_id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO v FROM style_analysis_versions WHERE id=r.style_analysis_version_id AND organization_id=r.organization_id AND store_id=r.store_id;
 IF NOT FOUND OR v.ai_request_id IS DISTINCT FROM r.id OR v.command_key IS DISTINCT FROM r.command_key OR v.command_hash IS DISTINCT FROM r.command_hash OR v.input_manifest IS NULL OR v.operation_version IS DISTINCT FROM r.operation THEN RAISE EXCEPTION 'ANALYSIS_REQUEST_BINDING_INVALID'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER analysis_request_binding AFTER INSERT OR UPDATE ON ai_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_style_analysis_request_binding();
