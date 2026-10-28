CREATE TABLE "platform_branding" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text DEFAULT 'SitePulse' NOT NULL,
	"logo_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_branding_singleton" CHECK ("platform_branding"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_brand_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_logo_url" text;