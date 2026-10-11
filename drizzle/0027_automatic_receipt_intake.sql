CREATE TABLE "etsy_automatic_intake" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"epoch" integer NOT NULL,
	"cutoff" integer NOT NULL,
	"cursor" integer NOT NULL,
	"window_end" integer,
	"offset" integer DEFAULT 0 NOT NULL,
	"claim" uuid,
	"lease_until" timestamp with time zone,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"last_success_at" timestamp with time zone,
	CONSTRAINT "automatic_intake_store_epoch" UNIQUE("organization_id","store_id","epoch"),
	CONSTRAINT "automatic_intake_bounds" CHECK ("etsy_automatic_intake"."epoch">=0 and "etsy_automatic_intake"."cutoff">=946684800 and "etsy_automatic_intake"."cursor">="etsy_automatic_intake"."cutoff" and "etsy_automatic_intake"."offset" between 0 and 10000 and "etsy_automatic_intake"."attempts" between 0 and 5 and ("etsy_automatic_intake"."window_end" is null or "etsy_automatic_intake"."window_end">="etsy_automatic_intake"."cursor")),
	CONSTRAINT "automatic_intake_claim" CHECK (("etsy_automatic_intake"."claim" is null)=("etsy_automatic_intake"."lease_until" is null))
);
--> statement-breakpoint
CREATE TABLE "etsy_automatic_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"epoch" integer NOT NULL,
	"receipt_id" text NOT NULL,
	"source_modified" integer NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claim" uuid,
	"lease_until" timestamp with time zone,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_code" text,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automatic_receipt_identity" UNIQUE("organization_id","store_id","epoch","receipt_id","source_modified"),
	CONSTRAINT "automatic_receipt_bounds" CHECK ("etsy_automatic_receipts"."receipt_id" ~ '^[1-9][0-9]{0,18}$' and "etsy_automatic_receipts"."source_modified">=946684800 and "etsy_automatic_receipts"."attempts" between 0 and 5),
	CONSTRAINT "automatic_receipt_status" CHECK ("etsy_automatic_receipts"."status" in ('PENDING','PROCESSING','SUCCEEDED','ATTENTION')),
	CONSTRAINT "automatic_receipt_claim" CHECK (("etsy_automatic_receipts"."status"='PROCESSING')=("etsy_automatic_receipts"."claim" is not null and "etsy_automatic_receipts"."lease_until" is not null))
);
--> statement-breakpoint
ALTER TABLE "etsy_automatic_intake" ADD CONSTRAINT "etsy_automatic_intake_organization_id_store_id_stores_organization_id_id_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etsy_automatic_receipts" ADD CONSTRAINT "etsy_automatic_receipts_organization_id_store_id_epoch_etsy_automatic_intake_organization_id_store_id_epoch_fk" FOREIGN KEY ("organization_id","store_id","epoch") REFERENCES "public"."etsy_automatic_intake"("organization_id","store_id","epoch") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automatic_intake_due" ON "etsy_automatic_intake" USING btree ("next_at");--> statement-breakpoint
CREATE INDEX "automatic_receipts_due" ON "etsy_automatic_receipts" USING btree ("status","next_at");
--> statement-breakpoint
-- Existing connected shops start at deployment, never at an old historical connection date.
-- Attribute only to the persisted OAuth actor who still has owner permission.
INSERT INTO etsy_automatic_intake (organization_id,store_id,actor_id,epoch,cutoff,cursor)
SELECT s.organization_id,s.id,a.actor_id,c.epoch,
 greatest(floor(extract(epoch from now()))::int,floor(extract(epoch from s.import_since))::int),
 greatest(floor(extract(epoch from now()))::int,floor(extract(epoch from s.import_since))::int)
FROM stores s JOIN etsy_connections c ON c.organization_id=s.organization_id AND c.store_id=s.id
JOIN LATERAL (SELECT actor_id FROM audit_logs WHERE organization_id=s.organization_id AND store_id=s.id AND action='etsy_connected' ORDER BY created_at DESC,id DESC LIMIT 1) a ON true
JOIN memberships m ON m.organization_id=s.organization_id AND m.user_id=a.actor_id AND m.role='owner'
WHERE s.source='etsy' AND c.status='connected' AND c.encrypted_tokens IS NOT NULL AND 'transactions_r'=ANY(c.scopes)
ON CONFLICT DO NOTHING;
