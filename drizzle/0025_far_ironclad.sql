CREATE TABLE "order_finances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"receipt_id" text NOT NULL,
	"shop_id" text NOT NULL,
	"source" text DEFAULT 'etsy' NOT NULL,
	"contract" text DEFAULT 'etsy-receipt-finance/v1' NOT NULL,
	"state" text NOT NULL,
	"amount" bigint,
	"divisor" bigint,
	"currency" text,
	"source_updated_at" integer,
	"total_source_updated_at" integer,
	"source_hash" text NOT NULL,
	"total_verified_at" timestamp with time zone,
	"refund_observed_at" timestamp with time zone,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_order_unique" UNIQUE("organization_id","store_id","order_id"),
	CONSTRAINT "finance_source_contract" CHECK ("order_finances"."source"='etsy' and "order_finances"."contract"='etsy-receipt-finance/v1'),
	CONSTRAINT "finance_ids" CHECK ("order_finances"."receipt_id" ~ '^[1-9][0-9]{0,19}$' and "order_finances"."shop_id" ~ '^[1-9][0-9]{0,19}$' and "order_finances"."source_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "finance_state" CHECK ("order_finances"."state" in ('VERIFIED','MISSING','INVALID','UNCERTAIN')),
	CONSTRAINT "finance_money" CHECK (("order_finances"."state"='VERIFIED' and "order_finances"."amount" is not null and "order_finances"."divisor" is not null and "order_finances"."currency" is not null and "order_finances"."source_updated_at" is not null and "order_finances"."amount">=0 and "order_finances"."divisor" between 1 and 1000000000 and 1000000000::bigint % nullif("order_finances"."divisor",0)=0 and "order_finances"."currency" ~ '^[A-Z]{3}$' and "order_finances"."total_verified_at" is not null and "order_finances"."total_source_updated_at" is not null and "order_finances"."source_updated_at">="order_finances"."total_source_updated_at") or ("order_finances"."state"<>'VERIFIED' and "order_finances"."amount" is null and "order_finances"."divisor" is null and "order_finances"."currency" is null and "order_finances"."total_verified_at" is null and "order_finances"."total_source_updated_at" is null)),
	CONSTRAINT "finance_timestamp" CHECK (("order_finances"."source_updated_at" is null or "order_finances"."source_updated_at">=0) and ("order_finances"."total_source_updated_at" is null or "order_finances"."total_source_updated_at">=0))
);
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "order_finance_identity" UNIQUE("organization_id","store_id","id","external_id");
--> statement-breakpoint
ALTER TABLE "order_finances" ADD CONSTRAINT "finance_exact_receipt_fk" FOREIGN KEY ("organization_id","store_id","order_id","receipt_id") REFERENCES "public"."orders"("organization_id","store_id","id","external_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
