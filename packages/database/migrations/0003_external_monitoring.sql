CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"monitor_type" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"severity" text NOT NULL,
	"fingerprint" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_reason" text,
	CONSTRAINT "incidents_type_valid" CHECK ("incidents"."monitor_type" in ('uptime', 'ssl')),
	CONSTRAINT "incidents_status_valid" CHECK ("incidents"."status" in ('open', 'acknowledged', 'resolved')),
	CONSTRAINT "incidents_severity_valid" CHECK ("incidents"."severity" in ('warning', 'critical'))
);
--> statement-breakpoint
CREATE TABLE "monitor_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"monitor_type" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" text NOT NULL,
	"http_status" integer,
	"latency_ms" integer,
	"ssl_expires_at" timestamp with time zone,
	"error_code" text,
	CONSTRAINT "monitor_checks_type_valid" CHECK ("monitor_checks"."monitor_type" in ('uptime', 'ssl')),
	CONSTRAINT "monitor_checks_result_valid" CHECK ("monitor_checks"."result" in ('up', 'down', 'warning', 'error'))
);
--> statement-breakpoint
CREATE TABLE "monitor_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"monitor_type" text NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"successes" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"last_checked_at" timestamp with time zone,
	CONSTRAINT "monitor_jobs_type_valid" CHECK ("monitor_jobs"."monitor_type" in ('uptime', 'ssl')),
	CONSTRAINT "monitor_jobs_state_valid" CHECK ("monitor_jobs"."state" in ('pending', 'healthy', 'suspected', 'down', 'recovering', 'warning')),
	CONSTRAINT "monitor_jobs_counters_valid" CHECK ("monitor_jobs"."failures" >= 0 and "monitor_jobs"."successes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_checks" ADD CONSTRAINT "monitor_checks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_jobs" ADD CONSTRAINT "monitor_jobs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_active_fingerprint_unique" ON "incidents" USING btree ("fingerprint") WHERE "incidents"."status" <> 'resolved';--> statement-breakpoint
CREATE INDEX "incidents_site_time_idx" ON "incidents" USING btree ("site_id","started_at");--> statement-breakpoint
CREATE INDEX "monitor_checks_site_time_idx" ON "monitor_checks" USING btree ("site_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "monitor_jobs_site_type_unique" ON "monitor_jobs" USING btree ("site_id","monitor_type");--> statement-breakpoint
CREATE INDEX "monitor_jobs_due_idx" ON "monitor_jobs" USING btree ("next_run_at");