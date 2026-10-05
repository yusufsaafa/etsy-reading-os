CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"generation_id" uuid,
	"attempt_number" integer NOT NULL,
	"command_key" uuid NOT NULL,
	"command_hash" text NOT NULL,
	"parent_request_id" uuid,
	"operation" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"resolved_model" text,
	"provider_request_id" text,
	"status" text DEFAULT 'CLAIMED' NOT NULL,
	"failure_code" text,
	"ambiguous" boolean DEFAULT false NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"reasoning_tokens" integer,
	"cached_tokens" integer,
	"duration_ms" integer,
	"pricing" jsonb NOT NULL,
	"reserved_nanos" bigint NOT NULL,
	"estimated_nanos" bigint,
	"actual_nanos" bigint,
	"cost_state" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ai_request_owned_identity" UNIQUE("organization_id","store_id","id"),
	CONSTRAINT "ai_command_unique" UNIQUE("organization_id","store_id","command_key"),
	CONSTRAINT "generation_attempt_number" UNIQUE("organization_id","store_id","generation_id","attempt_number"),
	CONSTRAINT "ai_request_status" CHECK ("ai_requests"."status" in ('CLAIMED','RUNNING','SUCCEEDED','FAILED')),
	CONSTRAINT "ai_cost_state" CHECK ("ai_requests"."cost_state" in ('estimated','known_zero','unknown') and (("ai_requests"."cost_state"='unknown')=("ai_requests"."estimated_nanos" is null))),
	CONSTRAINT "ai_nonnegative" CHECK ("ai_requests"."attempt_number">0 and "ai_requests"."reserved_nanos">=0 and "ai_requests"."estimated_nanos">=0 and "ai_requests"."actual_nanos">=0 and "ai_requests"."duration_ms">=0 and "ai_requests"."input_tokens">=0 and "ai_requests"."output_tokens">=0 and "ai_requests"."total_tokens">=0 and "ai_requests"."reasoning_tokens">=0 and "ai_requests"."cached_tokens">=0)
);
--> statement-breakpoint
CREATE TABLE "generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"product_version_id" uuid NOT NULL,
	"style_version_id" uuid NOT NULL,
	"seller_profile_id" uuid NOT NULL,
	"customer_revision" integer NOT NULL,
	"context" jsonb NOT NULL,
	"context_hash" text NOT NULL,
	"status" text DEFAULT 'PROCESSING' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "generation_owned_identity" UNIQUE("organization_id","store_id","id"),
	CONSTRAINT "generation_status" CHECK ("generations"."status" in ('PROCESSING','SUCCEEDED','FAILED')),
	CONSTRAINT "generation_success_result" CHECK (("generations"."status"='SUCCEEDED')=("generations"."result" is not null)),
	CONSTRAINT "generation_context_hash" CHECK ("generations"."context_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"ai_request_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"amount_nanos" bigint,
	"currency" text DEFAULT 'USD' NOT NULL,
	"cost_state" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_usage_per_request" UNIQUE("organization_id","store_id","ai_request_id"),
	CONSTRAINT "usage_cost" CHECK ("usage_events"."currency"='USD' and "usage_events"."cost_state" in ('estimated','known_zero','unknown') and (("usage_events"."cost_state"='unknown')=("usage_events"."amount_nanos" is null)) and "usage_events"."amount_nanos">=0)
);
--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_organization_id_store_id_stores_organization_id_id_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_organization_id_store_id_generation_id_generations_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","generation_id") REFERENCES "public"."generations"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_organization_id_store_id_parent_request_id_ai_requests_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","parent_request_id") REFERENCES "public"."ai_requests"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_organization_id_store_id_unit_id_fulfillment_units_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","unit_id") REFERENCES "public"."fulfillment_units"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_organization_id_store_id_product_version_id_product_versions_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","product_version_id") REFERENCES "public"."product_versions"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_organization_id_store_id_style_version_id_style_profile_versions_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","style_version_id") REFERENCES "public"."style_profile_versions"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_organization_id_store_id_seller_profile_id_seller_profiles_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","seller_profile_id") REFERENCES "public"."seller_profiles"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_organization_id_store_id_unit_id_customer_revision_customer_inputs_organization_id_store_id_unit_id_revision_fk" FOREIGN KEY ("organization_id","store_id","unit_id","customer_revision") REFERENCES "public"."customer_inputs"("organization_id","store_id","unit_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organization_id_store_id_ai_request_id_ai_requests_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","ai_request_id") REFERENCES "public"."ai_requests"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_request_per_generation" ON "ai_requests" USING btree ("organization_id","store_id","generation_id") WHERE "ai_requests"."status" in ('CLAIMED','RUNNING');--> statement-breakpoint
CREATE UNIQUE INDEX "one_processing_generation_per_reading" ON "generations" USING btree ("organization_id","store_id","unit_id") WHERE "generations"."status"='PROCESSING';
--> statement-breakpoint
-- Application snapshots and published results cannot be silently rewritten.
CREATE FUNCTION protect_generation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u fulfillment_units%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO u FROM fulfillment_units WHERE id=NEW.unit_id AND organization_id=NEW.organization_id AND store_id=NEW.store_id;
  IF u.product_version_id IS DISTINCT FROM NEW.product_version_id OR NEW.context->>'unitId' IS DISTINCT FROM NEW.unit_id::text OR NEW.context#>>'{product,id}' IS DISTINCT FROM NEW.product_version_id::text OR NEW.context#>>'{style,id}' IS DISTINCT FROM NEW.style_version_id::text OR NEW.context#>>'{seller,id}' IS DISTINCT FROM NEW.seller_profile_id::text OR (NEW.context#>>'{customer,revision}')::integer IS DISTINCT FROM NEW.customer_revision THEN RAISE EXCEPTION 'GENERATION_BINDING_INVALID'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'GENERATION_HISTORY_IMMUTABLE'; END IF;
 IF ROW(OLD.id,OLD.organization_id,OLD.store_id,OLD.unit_id,OLD.product_version_id,OLD.style_version_id,OLD.seller_profile_id,OLD.customer_revision,OLD.context,OLD.context_hash,OLD.created_at) IS DISTINCT FROM ROW(NEW.id,NEW.organization_id,NEW.store_id,NEW.unit_id,NEW.product_version_id,NEW.style_version_id,NEW.seller_profile_id,NEW.customer_revision,NEW.context,NEW.context_hash,NEW.created_at) OR OLD.status='SUCCEEDED' THEN RAISE EXCEPTION 'GENERATION_HISTORY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER generation_immutable BEFORE INSERT OR UPDATE OR DELETE ON generations FOR EACH ROW EXECUTE FUNCTION protect_generation();
--> statement-breakpoint
CREATE FUNCTION protect_ai_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'AI_HISTORY_IMMUTABLE'; END IF;
 IF ROW(OLD.id,OLD.organization_id,OLD.store_id,OLD.generation_id,OLD.attempt_number,OLD.command_key,OLD.command_hash,OLD.parent_request_id,OLD.operation,OLD.provider,OLD.model,OLD.pricing,OLD.reserved_nanos,OLD.created_at) IS DISTINCT FROM ROW(NEW.id,NEW.organization_id,NEW.store_id,NEW.generation_id,NEW.attempt_number,NEW.command_key,NEW.command_hash,NEW.parent_request_id,NEW.operation,NEW.provider,NEW.model,NEW.pricing,NEW.reserved_nanos,NEW.created_at) OR OLD.status IN ('SUCCEEDED','FAILED') THEN RAISE EXCEPTION 'AI_HISTORY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ai_attempt_immutable BEFORE UPDATE OR DELETE ON ai_requests FOR EACH ROW EXECUTE FUNCTION protect_ai_attempt();
--> statement-breakpoint
CREATE FUNCTION check_ai_accounting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a ai_requests%ROWTYPE; target uuid;
BEGIN
 IF TG_TABLE_NAME='ai_requests' THEN target:=NEW.id; ELSE target:=NEW.ai_request_id; END IF;
 SELECT * INTO a FROM ai_requests WHERE id=target;
 IF NOT EXISTS(SELECT 1 FROM usage_events WHERE ai_request_id=a.id AND organization_id=a.organization_id AND store_id=a.store_id AND operation=a.operation AND cost_state=a.cost_state AND amount_nanos IS NOT DISTINCT FROM a.estimated_nanos) THEN RAISE EXCEPTION 'AI_ACCOUNTING_REQUIRED'; END IF;
 IF a.parent_request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_requests WHERE id=a.parent_request_id AND organization_id=a.organization_id AND store_id=a.store_id AND generation_id IS NOT DISTINCT FROM a.generation_id AND attempt_number=a.attempt_number-1) THEN RAISE EXCEPTION 'AI_RETRY_PARENT_INVALID'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER request_accounting_required AFTER INSERT OR UPDATE ON ai_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ai_accounting();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER usage_accounting_consistent AFTER INSERT OR UPDATE ON usage_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ai_accounting();
--> statement-breakpoint
CREATE FUNCTION protect_usage_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'USAGE_HISTORY_IMMUTABLE'; END IF;
 IF ROW(OLD.id,OLD.organization_id,OLD.store_id,OLD.ai_request_id,OLD.operation,OLD.currency,OLD.created_at) IS DISTINCT FROM ROW(NEW.id,NEW.organization_id,NEW.store_id,NEW.ai_request_id,NEW.operation,NEW.currency,NEW.created_at) OR OLD.cost_state<>'unknown' THEN RAISE EXCEPTION 'USAGE_HISTORY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER usage_history_immutable BEFORE UPDATE OR DELETE ON usage_events FOR EACH ROW EXECUTE FUNCTION protect_usage_history();
