ALTER TABLE "production_queue" DROP CONSTRAINT "production_queue_waiting";--> statement-breakpoint
ALTER TABLE "production_queue" DROP CONSTRAINT "production_claim_metadata";--> statement-breakpoint
ALTER TABLE "production_queue" ADD COLUMN "generation_command_key" uuid;--> statement-breakpoint
ALTER TABLE "production_queue" ADD COLUMN "generation_id" uuid;--> statement-breakpoint
ALTER TABLE "production_queue" ADD COLUMN "execution_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "production_queue" ADD CONSTRAINT "production_queue_organization_id_store_id_generation_id_generations_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","generation_id") REFERENCES "public"."generations"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_queue" ADD CONSTRAINT "production_command_identity" UNIQUE("organization_id","store_id","generation_command_key");--> statement-breakpoint
ALTER TABLE "production_queue" ADD CONSTRAINT "production_execution_binding" CHECK ((
    ("production_queue"."state" in ('QUEUED','CLAIMED','SKIPPED') and "production_queue"."generation_command_key" is null and "production_queue"."generation_id" is null and "production_queue"."execution_started_at" is null)
    or ("production_queue"."state" in ('EXECUTING','COMPLETED','ATTENTION') and "production_queue"."generation_command_key" is not null and "production_queue"."generation_command_key"="production_queue"."id" and "production_queue"."execution_started_at" is not null)
  ));--> statement-breakpoint
ALTER TABLE "production_queue" ADD CONSTRAINT "production_queue_waiting" CHECK ("production_queue"."state" in ('QUEUED','CLAIMED','SKIPPED','EXECUTING','COMPLETED','ATTENTION'));--> statement-breakpoint
ALTER TABLE "production_queue" ADD CONSTRAINT "production_claim_metadata" CHECK ((
    ("production_queue"."state"='QUEUED' and "production_queue"."claim_token" is null and "production_queue"."claimed_at" is null and "production_queue"."claim_expires_at" is null and "production_queue"."scheduling_ordinal" is null and "production_queue"."resolved_at" is null and "production_queue"."resolution_code" is null)
    or ("production_queue"."state" in ('CLAIMED','EXECUTING') and "production_queue"."claim_token" is not null and "production_queue"."claimed_at" is not null and "production_queue"."claim_expires_at" is not null and "production_queue"."claim_expires_at">"production_queue"."claimed_at" and "production_queue"."scheduling_ordinal" is not null and "production_queue"."scheduling_ordinal">0 and "production_queue"."resolved_at" is null and "production_queue"."resolution_code" is null)
    or ("production_queue"."state" in ('COMPLETED','ATTENTION') and "production_queue"."claim_token" is not null and "production_queue"."claimed_at" is not null and "production_queue"."claim_expires_at" is null and "production_queue"."resolved_at" is not null and "production_queue"."resolution_code" is not null and "production_queue"."scheduling_ordinal" is not null and "production_queue"."scheduling_ordinal">0 and ("production_queue"."state"<>'COMPLETED' or "production_queue"."generation_id" is not null))
    or ("production_queue"."state"='SKIPPED'  and "production_queue"."claim_token" is null and "production_queue"."claim_expires_at" is null and "production_queue"."resolved_at" is not null and "production_queue"."resolution_code" is not null and "production_queue"."scheduling_ordinal" is not null and "production_queue"."scheduling_ordinal">0)
  ));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_production_claim_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'QUEUED' THEN RAISE EXCEPTION 'ADMIT_WAITING_WORK_FIRST'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.state IN ('SKIPPED','COMPLETED','ATTENTION') THEN RAISE EXCEPTION 'RESOLVED_PRODUCTION_IMMUTABLE'; END IF;
 IF NEW.state='CLAIMED' THEN
  IF OLD.state NOT IN ('QUEUED','CLAIMED') OR (OLD.state='CLAIMED' AND (NEW.claimed_at<OLD.claim_expires_at OR NEW.claim_token=OLD.claim_token OR NEW.scheduling_ordinal<=OLD.scheduling_ordinal)) THEN RAISE EXCEPTION 'ACTIVE_CLAIM_CANNOT_BE_STOLEN'; END IF;
 ELSIF NEW.state='SKIPPED' THEN
  IF OLD.state NOT IN ('QUEUED','CLAIMED') OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at OR NEW.scheduling_ordinal<COALESCE(OLD.scheduling_ordinal,0) THEN RAISE EXCEPTION 'RETAIN_CLAIM_HISTORY'; END IF;
 ELSIF NEW.state IN ('EXECUTING','COMPLETED','ATTENTION') THEN
  IF NEW.claim_token IS DISTINCT FROM OLD.claim_token OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at OR NEW.scheduling_ordinal IS DISTINCT FROM OLD.scheduling_ordinal THEN RAISE EXCEPTION 'EXECUTION_TOKEN_FENCE'; END IF;
  IF OLD.state='CLAIMED' THEN
   IF NEW.state<>'EXECUTING' OR OLD.claim_expires_at<=clock_timestamp() OR NEW.claim_expires_at IS DISTINCT FROM OLD.claim_expires_at THEN RAISE EXCEPTION 'EXECUTION_REQUIRES_ACTIVE_CLAIM'; END IF;
  ELSIF OLD.state='EXECUTING' THEN
   IF NEW.generation_command_key IS DISTINCT FROM OLD.generation_command_key OR NEW.execution_started_at IS DISTINCT FROM OLD.execution_started_at OR (OLD.generation_id IS NOT NULL AND NEW.generation_id IS DISTINCT FROM OLD.generation_id) THEN RAISE EXCEPTION 'EXECUTION_BINDING_IMMUTABLE'; END IF;
   IF NEW.state='EXECUTING' AND NEW.claim_expires_at IS DISTINCT FROM OLD.claim_expires_at THEN RAISE EXCEPTION 'EXECUTION_CANNOT_RENEW'; END IF;
  ELSE RAISE EXCEPTION 'INVALID_PRODUCTION_TRANSITION'; END IF;
  IF NEW.generation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM generations g WHERE g.id=NEW.generation_id AND g.organization_id=NEW.organization_id AND g.store_id=NEW.store_id AND g.unit_id=NEW.unit_id AND g.product_version_id=NEW.product_version_id AND (NEW.state<>'COMPLETED' OR g.status='SUCCEEDED')) THEN RAISE EXCEPTION 'INVALID_PRODUCTION_GENERATION_BINDING'; END IF;
 ELSE RAISE EXCEPTION 'INVALID_PRODUCTION_TRANSITION'; END IF;
 RETURN NEW;
END $$;
