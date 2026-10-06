ALTER TABLE "production_queue" DROP CONSTRAINT "production_queue_waiting";--> statement-breakpoint
ALTER TABLE "production_queue" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "production_queue" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "production_queue" ADD COLUMN "claim_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "production_queue" ADD COLUMN "scheduling_ordinal" bigint;--> statement-breakpoint
ALTER TABLE "production_queue" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "production_queue" ADD COLUMN "resolution_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX "production_claim_token_unique" ON "production_queue" USING btree ("claim_token") WHERE "production_queue"."claim_token" is not null;--> statement-breakpoint
CREATE INDEX "production_waiting_scan" ON "production_queue" USING btree ("state","claim_expires_at");--> statement-breakpoint
ALTER TABLE "production_queue" ADD CONSTRAINT "production_claim_metadata" CHECK ((
    ("production_queue"."state"='QUEUED' and "production_queue"."claim_token" is null and "production_queue"."claimed_at" is null and "production_queue"."claim_expires_at" is null and "production_queue"."scheduling_ordinal" is null and "production_queue"."resolved_at" is null and "production_queue"."resolution_code" is null)
    or ("production_queue"."state"='CLAIMED' and "production_queue"."claim_token" is not null and "production_queue"."claimed_at" is not null and "production_queue"."claim_expires_at" is not null and "production_queue"."claim_expires_at">"production_queue"."claimed_at" and "production_queue"."scheduling_ordinal" is not null and "production_queue"."scheduling_ordinal">0 and "production_queue"."resolved_at" is null and "production_queue"."resolution_code" is null)
    or ("production_queue"."state"='SKIPPED' and "production_queue"."claim_token" is null and "production_queue"."claim_expires_at" is null and "production_queue"."resolved_at" is not null and "production_queue"."resolution_code" is not null and "production_queue"."scheduling_ordinal" is not null and "production_queue"."scheduling_ordinal">0)
  ));--> statement-breakpoint
ALTER TABLE "production_queue" ADD CONSTRAINT "production_queue_waiting" CHECK ("production_queue"."state" in ('QUEUED','CLAIMED','SKIPPED'));
--> statement-breakpoint
-- Keep waiting policy immutable; add only claim/terminal transition guards.
CREATE FUNCTION guard_production_claim_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'QUEUED' THEN RAISE EXCEPTION 'ADMIT_WAITING_WORK_FIRST'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.state='SKIPPED' THEN RAISE EXCEPTION 'RESOLVED_PRODUCTION_IMMUTABLE'; END IF;
  IF NEW.state='QUEUED' THEN RAISE EXCEPTION 'CLAIM_CANNOT_RESET_TO_QUEUED'; END IF;
  IF NEW.state='CLAIMED' THEN
    IF OLD.state='CLAIMED' AND (NEW.claimed_at<OLD.claim_expires_at OR NEW.claim_token=OLD.claim_token OR NEW.scheduling_ordinal<=OLD.scheduling_ordinal) THEN
      RAISE EXCEPTION 'ACTIVE_CLAIM_CANNOT_BE_STOLEN';
    END IF;
  ELSIF NEW.state='SKIPPED' THEN
    IF NEW.claimed_at IS DISTINCT FROM OLD.claimed_at OR NEW.scheduling_ordinal<=COALESCE(OLD.scheduling_ordinal,0) THEN RAISE EXCEPTION 'RETAIN_CLAIM_HISTORY_AND_ADVANCE_TURN'; END IF;
  ELSE RAISE EXCEPTION 'INVALID_PRODUCTION_TRANSITION'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER production_claim_transition BEFORE INSERT OR UPDATE ON production_queue FOR EACH ROW EXECUTE FUNCTION guard_production_claim_transition();
