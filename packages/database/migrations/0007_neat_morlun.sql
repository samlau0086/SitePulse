CREATE TABLE "notification_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"destination" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone,
	"token_hash" text,
	"token_expires_at" timestamp with time zone,
	"last_mail_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"include_members" boolean DEFAULT true NOT NULL,
	"mail_window_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mail_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "endpoint_id" uuid;--> statement-breakpoint
UPDATE notification_deliveries d SET organization_id = s.organization_id
FROM incidents i JOIN sites s ON s.id = i.site_id WHERE d.incident_id = i.id;--> statement-breakpoint
ALTER TABLE "notification_endpoints" ADD CONSTRAINT "notification_endpoints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_endpoints_active_email_unique" ON "notification_endpoints" USING btree ("organization_id","destination") WHERE "notification_endpoints"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_endpoint_id_notification_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."notification_endpoints"("id") ON DELETE no action ON UPDATE no action;
