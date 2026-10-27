ALTER TABLE "notification_deliveries" ADD COLUMN "channel" text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_endpoints" ADD COLUMN "type" text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_endpoints" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "notification_endpoints" ADD COLUMN "encrypted_key" text;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel_valid" CHECK ("notification_deliveries"."channel" in ('email', 'bark'));--> statement-breakpoint
ALTER TABLE "notification_endpoints" ADD CONSTRAINT "notification_endpoints_type_valid" CHECK ("notification_endpoints"."type" in ('email', 'bark'));--> statement-breakpoint
ALTER TABLE "notification_endpoints" ADD CONSTRAINT "notification_endpoints_bark_key_required" CHECK ("notification_endpoints"."type" <> 'bark' or "notification_endpoints"."deleted_at" is not null or ("notification_endpoints"."encrypted_key" is not null and "notification_endpoints"."label" is not null));