CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid,
	"event_key" text NOT NULL,
	"event_type" text NOT NULL,
	"recipient" text NOT NULL,
	"site_name" text NOT NULL,
	"site_url" text NOT NULL,
	"monitor_type" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"provider_message_id" text,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notification_deliveries_event_key_unique" UNIQUE("event_key"),
	CONSTRAINT "notification_deliveries_event_valid" CHECK ("notification_deliveries"."event_type" in ('opened', 'recovered')),
	CONSTRAINT "notification_deliveries_status_valid" CHECK ("notification_deliveries"."status" in ('queued', 'sending', 'sent', 'failed')),
	CONSTRAINT "notification_deliveries_attempts_valid" CHECK ("notification_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_due_idx" ON "notification_deliveries" USING btree ("status","next_attempt_at");