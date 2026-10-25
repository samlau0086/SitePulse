ALTER TABLE "organizations" DROP CONSTRAINT "organizations_plan_valid";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "site_limit_override" integer;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_site_limit_valid" CHECK ("organizations"."site_limit_override" between 0 and 1000);--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_valid" CHECK ("organizations"."plan_code" in ('free', 'pro', 'agency', 'agency_plus'));