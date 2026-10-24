CREATE TABLE "site_inventory_snapshots" (
  "site_id" uuid PRIMARY KEY NOT NULL,
  "wordpress_version" text NOT NULL,
  "php_version" text NOT NULL,
  "active_plugins" jsonb NOT NULL,
  "active_themes" jsonb NOT NULL,
  "update_counts" jsonb NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "site_inventory_snapshots_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action
);
