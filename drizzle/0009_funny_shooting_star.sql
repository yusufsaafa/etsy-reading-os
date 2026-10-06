CREATE TABLE "production_tick" (
	"id" text PRIMARY KEY NOT NULL,
	"token" uuid,
	"expires_at" timestamp with time zone,
	CONSTRAINT "production_tick_singleton" CHECK ("production_tick"."id"='production'),
	CONSTRAINT "production_tick_owner" CHECK (("production_tick"."token" is null)=("production_tick"."expires_at" is null))
);
--> statement-breakpoint
ALTER TABLE "production_queue" DROP CONSTRAINT "production_queue_waiting";--> statement-breakpoint
ALTER TABLE "production_queue" DROP CONSTRAINT "production_execution_binding";--> statement-breakpoint
ALTER TABLE "production_queue" DROP CONSTRAINT "production_claim_metadata";--> statement-breakpoint
ALTER TABLE "production_queue" ADD COLUMN "execution_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "production_queue" ADD COLUMN "retry_command_key" uuid;--> statement-breakpoint
ALTER TABLE "production_queue" ADD COLUMN "available_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "production_retry_command_unique" ON "production_queue" USING btree ("retry_command_key") WHERE "production_queue"."retry_command_key" is not null;--> statement-breakpoint
CREATE INDEX "production_recovery_scan" ON "production_queue" USING btree ("state","updated_at","id");--> statement-breakpoint
CREATE INDEX "production_retry_due" ON "production_queue" USING btree ("state","available_at");--> statement-breakpoint
ALTER TABLE "production_queue" ADD CONSTRAINT "production_available_time" CHECK (("production_queue"."state"='RETRY_WAIT')=("production_queue"."available_at" is not null));--> statement-breakpoint
ALTER TABLE "production_queue" ADD CONSTRAINT "production_queue_waiting" CHECK ("production_queue"."state" in ('QUEUED','CLAIMED','SKIPPED','EXECUTING','COMPLETED','ATTENTION','RETRY_WAIT'));--> statement-breakpoint
ALTER TABLE "production_queue" ADD CONSTRAINT "production_execution_binding" CHECK ((
    ("production_queue"."generation_command_key" is null and "production_queue"."state" in ('QUEUED','CLAIMED','SKIPPED') and "production_queue"."generation_id" is null and "production_queue"."execution_started_at" is null)
    or ("production_queue"."generation_command_key"="production_queue"."id" and "production_queue"."generation_command_key" is not null and "production_queue"."execution_started_at" is not null)
  ) and "production_queue"."execution_attempt" between 1 and 3 and (("production_queue"."execution_attempt"=1 and "production_queue"."retry_command_key" is null) or ("production_queue"."execution_attempt">1 and "production_queue"."retry_command_key" is not null and "production_queue"."retry_command_key"<>"production_queue"."id" and "production_queue"."generation_id" is not null)));--> statement-breakpoint
ALTER TABLE "production_queue" ADD CONSTRAINT "production_claim_metadata" CHECK ((
    ("production_queue"."state"='QUEUED' and "production_queue"."claim_token" is null and "production_queue"."claimed_at" is null and "production_queue"."claim_expires_at" is null and "production_queue"."scheduling_ordinal" is null and "production_queue"."resolved_at" is null and "production_queue"."resolution_code" is null)
    or ("production_queue"."state" in ('CLAIMED','EXECUTING') and "production_queue"."claim_token" is not null and "production_queue"."claimed_at" is not null and "production_queue"."claim_expires_at" is not null and "production_queue"."claim_expires_at">"production_queue"."claimed_at" and "production_queue"."scheduling_ordinal" is not null and "production_queue"."scheduling_ordinal">0 and "production_queue"."resolved_at" is null and "production_queue"."resolution_code" is null)
    or ("production_queue"."state" in ('COMPLETED','ATTENTION','RETRY_WAIT') and "production_queue"."claim_token" is not null and "production_queue"."claimed_at" is not null and "production_queue"."claim_expires_at" is null and "production_queue"."resolved_at" is not null and "production_queue"."resolution_code" is not null and "production_queue"."scheduling_ordinal" is not null and "production_queue"."scheduling_ordinal">0 and ("production_queue"."state"<>'COMPLETED' or "production_queue"."generation_id" is not null))
    or ("production_queue"."state"='SKIPPED'  and "production_queue"."claim_token" is null and "production_queue"."claim_expires_at" is null and "production_queue"."resolved_at" is not null and "production_queue"."resolution_code" is not null and "production_queue"."scheduling_ordinal" is not null and "production_queue"."scheduling_ordinal">0)
  ));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_production_claim_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a ai_requests%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'QUEUED' OR NEW.execution_attempt<>1 OR NEW.retry_command_key IS NOT NULL THEN RAISE EXCEPTION 'ADMIT_WAITING_WORK_FIRST'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.state IN ('SKIPPED','COMPLETED') THEN RAISE EXCEPTION 'RESOLVED_PRODUCTION_IMMUTABLE'; END IF;
 IF OLD.generation_command_key IS NOT NULL AND (NEW.generation_command_key IS DISTINCT FROM OLD.generation_command_key OR NEW.execution_started_at IS DISTINCT FROM OLD.execution_started_at) THEN RAISE EXCEPTION 'EXECUTION_BINDING_IMMUTABLE'; END IF;
 IF OLD.generation_id IS NOT NULL AND NEW.generation_id IS DISTINCT FROM OLD.generation_id THEN RAISE EXCEPTION 'GENERATION_BINDING_IMMUTABLE'; END IF;
 IF NEW.state<>'RETRY_WAIT' AND (NEW.execution_attempt<>OLD.execution_attempt OR NEW.retry_command_key IS DISTINCT FROM OLD.retry_command_key) THEN RAISE EXCEPTION 'RETRY_IDENTITY_IMMUTABLE'; END IF;
 IF NEW.state='CLAIMED' THEN
  IF OLD.state NOT IN ('QUEUED','CLAIMED','RETRY_WAIT') OR (OLD.state='CLAIMED' AND NEW.claimed_at<OLD.claim_expires_at) OR (OLD.state='RETRY_WAIT' AND NEW.claimed_at<OLD.available_at) OR (OLD.state IN ('CLAIMED','RETRY_WAIT') AND (NEW.claim_token=OLD.claim_token OR NEW.scheduling_ordinal<=OLD.scheduling_ordinal)) THEN RAISE EXCEPTION 'ACTIVE_CLAIM_CANNOT_BE_STOLEN'; END IF;
 ELSIF NEW.state='SKIPPED' THEN
  IF OLD.state NOT IN ('QUEUED','CLAIMED','RETRY_WAIT') OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at OR NEW.scheduling_ordinal<COALESCE(OLD.scheduling_ordinal,0) THEN RAISE EXCEPTION 'RETAIN_CLAIM_HISTORY'; END IF;
 ELSIF NEW.state IN ('EXECUTING','COMPLETED','ATTENTION','RETRY_WAIT') THEN
  IF NEW.claim_token IS DISTINCT FROM OLD.claim_token OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at OR NEW.scheduling_ordinal IS DISTINCT FROM OLD.scheduling_ordinal THEN RAISE EXCEPTION 'EXECUTION_TOKEN_FENCE'; END IF;
  IF NEW.state='EXECUTING' THEN
   IF OLD.state='CLAIMED' THEN
    IF OLD.claim_expires_at<=clock_timestamp() OR NEW.claim_expires_at IS DISTINCT FROM OLD.claim_expires_at THEN RAISE EXCEPTION 'EXECUTION_REQUIRES_ACTIVE_CLAIM'; END IF;
   ELSIF OLD.state='EXECUTING' THEN
    IF NEW.claim_expires_at IS DISTINCT FROM OLD.claim_expires_at THEN RAISE EXCEPTION 'EXECUTION_CANNOT_RENEW'; END IF;
   ELSE RAISE EXCEPTION 'INVALID_PRODUCTION_TRANSITION'; END IF;
  ELSIF NEW.state='RETRY_WAIT' THEN
   IF OLD.state NOT IN ('EXECUTING','ATTENTION') THEN RAISE EXCEPTION 'INVALID_RETRY_TRANSITION'; END IF;
   IF NEW.generation_id IS NULL THEN
    IF NEW.execution_attempt<>1 OR EXISTS(SELECT 1 FROM ai_requests WHERE organization_id=NEW.organization_id AND store_id=NEW.store_id AND command_key=NEW.generation_command_key) THEN RAISE EXCEPTION 'RETRY_SAFETY_NOT_PROVEN'; END IF;
   ELSE
    SELECT * INTO a FROM ai_requests WHERE organization_id=NEW.organization_id AND store_id=NEW.store_id AND generation_id=NEW.generation_id ORDER BY attempt_number DESC LIMIT 1;
    IF NOT FOUND OR a.ambiguous OR a.failure_code IN ('TIMEOUT','NETWORK') THEN RAISE EXCEPTION 'AMBIGUOUS_RETRY_FORBIDDEN'; END IF;
    IF a.status='CLAIMED' AND a.started_at IS NULL THEN
     IF NEW.execution_attempt<>a.attempt_number OR COALESCE(NEW.retry_command_key,NEW.generation_command_key)<>a.command_key THEN RAISE EXCEPTION 'RESUME_IDENTITY_REQUIRED'; END IF;
    ELSIF a.status='FAILED' AND a.failure_code IN ('RATE_LIMIT','ADMISSION_CHANGED','BLOCKED') THEN
     IF NEW.execution_attempt<>a.attempt_number+1 OR NEW.retry_command_key IS NULL THEN RAISE EXCEPTION 'NEW_RETRY_IDENTITY_REQUIRED'; END IF;
    ELSE RAISE EXCEPTION 'RETRY_SAFETY_NOT_PROVEN'; END IF;
   END IF;
  ELSIF NEW.state IN ('COMPLETED','ATTENTION') AND OLD.state NOT IN ('EXECUTING','ATTENTION','RETRY_WAIT') THEN RAISE EXCEPTION 'INVALID_PRODUCTION_TRANSITION'; END IF;
 ELSE RAISE EXCEPTION 'INVALID_PRODUCTION_TRANSITION'; END IF;
 IF NEW.generation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM generations g WHERE g.id=NEW.generation_id AND g.organization_id=NEW.organization_id AND g.store_id=NEW.store_id AND g.unit_id=NEW.unit_id AND g.product_version_id=NEW.product_version_id AND (NEW.state<>'COMPLETED' OR g.status='SUCCEEDED')) THEN RAISE EXCEPTION 'INVALID_PRODUCTION_GENERATION_BINDING'; END IF;
 RETURN NEW;
END $$;
