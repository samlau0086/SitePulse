CREATE TABLE "pairing_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"challenge_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pairing_challenges_challenge_hash_unique" UNIQUE("challenge_hash")
);
--> statement-breakpoint
CREATE TABLE "site_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"credential_hash" text NOT NULL,
	"secret_version" integer DEFAULT 1 NOT NULL,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_credentials_site_id_unique" UNIQUE("site_id"),
	CONSTRAINT "site_credentials_credential_hash_unique" UNIQUE("credential_hash"),
	CONSTRAINT "site_credential_sequence_valid" CHECK ("site_credentials"."last_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"canonical_url" text NOT NULL,
	"hostname" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"connector_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sites_status_valid" CHECK ("sites"."status" in ('pending', 'active', 'degraded', 'disconnected'))
);
--> statement-breakpoint
ALTER TABLE "pairing_challenges" ADD CONSTRAINT "pairing_challenges_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_credentials" ADD CONSTRAINT "site_credentials_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pairing_site_idx" ON "pairing_challenges" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "sites_org_idx" ON "sites" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_org_url_unique" ON "sites" USING btree ("organization_id","canonical_url") WHERE "sites"."deleted_at" is null;