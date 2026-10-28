CREATE TABLE "site_security_assessments" (
	"site_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"vulnerabilities" jsonb,
	"coverage" text DEFAULT 'unknown' NOT NULL,
	"error_code" text,
	"checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"inventory_updated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_inventory_snapshots" ADD COLUMN "installed_plugins" jsonb;--> statement-breakpoint
ALTER TABLE "site_inventory_snapshots" ADD COLUMN "installed_themes" jsonb;--> statement-breakpoint
ALTER TABLE "site_inventory_snapshots" ADD COLUMN "environment" jsonb;--> statement-breakpoint
ALTER TABLE "site_inventory_snapshots" ADD COLUMN "local_security_scan" jsonb;--> statement-breakpoint
ALTER TABLE "site_security_assessments" ADD CONSTRAINT "site_security_assessments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_security_due_idx" ON "site_security_assessments" USING btree ("next_check_at");