CREATE TABLE "production_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"product_version_id" uuid NOT NULL,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"priority_class" text NOT NULL,
	"target_completion_minutes" integer,
	"target_deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_queue_one_per_reading" UNIQUE("organization_id","store_id","unit_id"),
	CONSTRAINT "production_queue_waiting" CHECK ("production_queue"."state"='QUEUED'),
	CONSTRAINT "production_queue_urgency" CHECK ("production_queue"."priority_class" in ('STANDARD','EXPRESS') and ("production_queue"."target_completion_minutes" is null or "production_queue"."target_completion_minutes" between 1 and 525600) and (("production_queue"."target_completion_minutes" is null)=("production_queue"."target_deadline" is null)))
);
--> statement-breakpoint
ALTER TABLE "production_queue" ADD CONSTRAINT "production_queue_organization_id_store_id_unit_id_fulfillment_units_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","unit_id") REFERENCES "public"."fulfillment_units"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_queue" ADD CONSTRAINT "production_queue_organization_id_store_id_product_version_id_product_versions_organization_id_store_id_id_fk" FOREIGN KEY ("organization_id","store_id","product_version_id") REFERENCES "public"."product_versions"("organization_id","store_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Bind urgency to the reading's immutable configuration, not just an owned version.
CREATE FUNCTION guard_production_queue_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE config jsonb; purchased_at timestamptz; minutes integer;
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(NEW.organization_id,NEW.store_id,NEW.unit_id,NEW.product_version_id,NEW.priority_class,NEW.target_completion_minutes,NEW.target_deadline,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.organization_id,OLD.store_id,OLD.unit_id,OLD.product_version_id,OLD.priority_class,OLD.target_completion_minutes,OLD.target_deadline,OLD.created_at) THEN
    RAISE EXCEPTION 'Production admission binding is immutable';
  END IF;
  SELECT v.configuration,o.created_at INTO config,purchased_at
    FROM fulfillment_units u JOIN product_versions v ON v.id=u.product_version_id AND v.organization_id=u.organization_id AND v.store_id=u.store_id
    JOIN order_line_items l ON l.id=u.line_item_id AND l.organization_id=u.organization_id AND l.store_id=u.store_id
    JOIN orders o ON o.id=l.order_id AND o.organization_id=l.organization_id AND o.store_id=l.store_id
    WHERE u.id=NEW.unit_id AND u.organization_id=NEW.organization_id AND u.store_id=NEW.store_id AND u.product_version_id=NEW.product_version_id AND v.status<>'DRAFT';
  minutes := (config->'fulfillment'->>'targetCompletionMinutes')::integer;
  IF config IS NULL OR config->>'workflow' IS DISTINCT FROM 'ASSISTED'
    OR NEW.priority_class IS DISTINCT FROM COALESCE(config->'fulfillment'->>'priorityClass','STANDARD')
    OR NEW.target_completion_minutes IS DISTINCT FROM minutes
    OR NEW.target_deadline IS DISTINCT FROM (purchased_at + minutes * interval '1 minute') THEN
    RAISE EXCEPTION 'Production queue policy must match the bound version';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER production_queue_policy BEFORE INSERT OR UPDATE ON production_queue FOR EACH ROW EXECUTE FUNCTION guard_production_queue_policy();
