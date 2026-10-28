CREATE TABLE "site_management" (
	"site_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"secret_version" integer NOT NULL,
	"polled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "software_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"command" jsonb NOT NULL,
	"reason" text NOT NULL,
	"fingerprint" text NOT NULL,
	"secret_version" integer NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"token" text,
	"result_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "software_operations_status_valid" CHECK ("software_operations"."status" in ('preview', 'queued', 'running', 'succeeded', 'failed', 'unknown', 'cancelled', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "site_management" ADD CONSTRAINT "site_management_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software_operations" ADD CONSTRAINT "software_operations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software_operations" ADD CONSTRAINT "software_operations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "software_operations_site_idx" ON "software_operations" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "software_operations_batch_idx" ON "software_operations" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "software_operations_busy_unique" ON "software_operations" USING btree ("site_id") WHERE "software_operations"."status" in ('queued', 'running', 'unknown');