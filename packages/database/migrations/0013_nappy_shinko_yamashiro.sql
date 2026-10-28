ALTER TABLE "site_management" ADD COLUMN "inventory_request_id" uuid;--> statement-breakpoint
ALTER TABLE "site_management" ADD COLUMN "inventory_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_management" ADD COLUMN "inventory_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_management" ADD COLUMN "inventory_error" text;