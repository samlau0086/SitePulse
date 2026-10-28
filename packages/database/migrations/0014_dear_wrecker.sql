CREATE TABLE "software_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"zip_base64" text NOT NULL,
	"scan" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "software_attachments_kind_valid" CHECK ("software_attachments"."kind" in ('plugin','theme')),
	CONSTRAINT "software_attachments_size_valid" CHECK ("software_attachments"."byte_size" > 0 and "software_attachments"."byte_size" <= 8388608)
);
--> statement-breakpoint
ALTER TABLE "site_management" ADD COLUMN "package_support" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "software_attachments" ADD CONSTRAINT "software_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software_attachments" ADD CONSTRAINT "software_attachments_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "software_attachments_org_hash_unique" ON "software_attachments" USING btree ("organization_id","sha256");