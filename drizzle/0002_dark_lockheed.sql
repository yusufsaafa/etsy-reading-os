ALTER TABLE "app_users" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_email_unique" UNIQUE("email");