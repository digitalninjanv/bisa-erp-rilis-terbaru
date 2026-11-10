CREATE TABLE "pos_desktop_release_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"version" text NOT NULL,
	"rollout_percent" integer DEFAULT 0 NOT NULL,
	"min_version" text,
	"notes" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_desktop_release_settings_company_uq" ON "pos_desktop_release_settings" USING btree ("company_id");
--> statement-breakpoint
-- POS Native Langkah 7 manual additions, same file by design (pattern
-- of 0060): tenant RLS + grants for the new table. The update endpoint
-- resolves the terminal token pre-tenant via the 0060 digest policy,
-- then reads this table inside `withCompanyReadOnly` under the normal
-- tenant policy — no extra pre-tenant policy is needed here.
ALTER TABLE "pos_desktop_release_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos_desktop_release_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pos_desktop_release_settings"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "pos_desktop_release_settings" TO app_user;