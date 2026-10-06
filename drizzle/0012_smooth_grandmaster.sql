ALTER TABLE "ai_requests" ADD COLUMN "provider_http_status" integer;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD COLUMN "google_error_status" text;