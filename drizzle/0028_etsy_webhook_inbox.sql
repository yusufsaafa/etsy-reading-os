CREATE TABLE "etsy_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"shop_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"body_hash" text NOT NULL,
	"signed_at" bigint NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid,
	"store_id" uuid,
	"epoch" integer,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claim" uuid,
	"lease_until" timestamp with time zone,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_code" text,
	"result" text,
	"settled_at" timestamp with time zone,
	CONSTRAINT "webhook_event_identity" UNIQUE("event_id"),
	CONSTRAINT "webhook_event_evidence" CHECK ("etsy_webhook_events"."event_id" ~ '^[A-Za-z0-9_-]+$' and length("etsy_webhook_events"."event_id") between 1 and 256 and "etsy_webhook_events"."shop_id" ~ '^[1-9][0-9]{0,19}$' and "etsy_webhook_events"."receipt_id" ~ '^[1-9][0-9]{0,19}$' and "etsy_webhook_events"."body_hash" ~ '^[0-9a-f]{64}$' and "etsy_webhook_events"."signed_at">=0 and "etsy_webhook_events"."event_type" in ('order.paid','order.canceled','order.shipped','order.delivered')),
	CONSTRAINT "webhook_event_binding" CHECK (("etsy_webhook_events"."organization_id" is null and "etsy_webhook_events"."store_id" is null and "etsy_webhook_events"."epoch" is null and "etsy_webhook_events"."status" in ('ATTENTION','SUCCEEDED')) or ("etsy_webhook_events"."organization_id" is not null and "etsy_webhook_events"."store_id" is not null and "etsy_webhook_events"."epoch" is not null and "etsy_webhook_events"."epoch">=0)),
	CONSTRAINT "webhook_event_status" CHECK ("etsy_webhook_events"."status" in ('PENDING','PROCESSING','SUCCEEDED','ATTENTION') and "etsy_webhook_events"."attempts" between 0 and 5),
	CONSTRAINT "webhook_event_claim" CHECK (("etsy_webhook_events"."status"='PROCESSING' and "etsy_webhook_events"."claim" is not null and "etsy_webhook_events"."lease_until" is not null) or ("etsy_webhook_events"."status"<>'PROCESSING' and "etsy_webhook_events"."claim" is null and "etsy_webhook_events"."lease_until" is null))
);
--> statement-breakpoint
ALTER TABLE "etsy_webhook_events" ADD CONSTRAINT "etsy_webhook_events_organization_id_store_id_epoch_etsy_automatic_intake_organization_id_store_id_epoch_fk" FOREIGN KEY ("organization_id","store_id","epoch") REFERENCES "public"."etsy_automatic_intake"("organization_id","store_id","epoch") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_events_due" ON "etsy_webhook_events" USING btree ("status","next_at");--> statement-breakpoint
CREATE INDEX "webhook_events_store" ON "etsy_webhook_events" USING btree ("organization_id","store_id","received_at");
--> statement-breakpoint
-- Processing/retry metadata may change; verified evidence and its initial epoch may not.
CREATE FUNCTION guard_etsy_webhook_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.event_id,NEW.event_type,NEW.shop_id,NEW.receipt_id,NEW.body_hash,NEW.signed_at,NEW.received_at,NEW.organization_id,NEW.store_id,NEW.epoch)
     IS DISTINCT FROM ROW(OLD.id,OLD.event_id,OLD.event_type,OLD.shop_id,OLD.receipt_id,OLD.body_hash,OLD.signed_at,OLD.received_at,OLD.organization_id,OLD.store_id,OLD.epoch) THEN
    RAISE EXCEPTION 'IMMUTABLE_WEBHOOK_EVIDENCE';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER etsy_webhook_evidence_immutable BEFORE UPDATE ON etsy_webhook_events
FOR EACH ROW EXECUTE FUNCTION guard_etsy_webhook_evidence();
