CREATE TABLE "performance_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"strategy" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"report" jsonb,
	CONSTRAINT "performance_checks_strategy_valid" CHECK ("performance_checks"."strategy" in ('mobile', 'desktop'))
);
--> statement-breakpoint
CREATE TABLE "performance_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"strategy" text NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"error_code" text,
	"report" jsonb,
	CONSTRAINT "performance_jobs_strategy_valid" CHECK ("performance_jobs"."strategy" in ('mobile', 'desktop'))
);
--> statement-breakpoint
ALTER TABLE "performance_checks" ADD CONSTRAINT "performance_checks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_jobs" ADD CONSTRAINT "performance_jobs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "performance_checks_site_time_idx" ON "performance_checks" USING btree ("site_id","checked_at");--> statement-breakpoint
CREATE INDEX "performance_checks_time_idx" ON "performance_checks" USING btree ("checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "performance_jobs_site_strategy_unique" ON "performance_jobs" USING btree ("site_id","strategy");--> statement-breakpoint
CREATE INDEX "performance_jobs_due_idx" ON "performance_jobs" USING btree ("next_run_at");