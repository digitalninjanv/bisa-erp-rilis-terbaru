CREATE TABLE "quick_entry_drafts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quick_entry_submissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"kind" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "quick_entry_drafts_company_user_idx" ON "quick_entry_drafts" USING btree ("company_id","user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quick_entry_submissions_company_key_uq" ON "quick_entry_submissions" USING btree ("company_id","idempotency_key");--> statement-breakpoint
-- A-12 (D-23) manual additions, same file by design (pattern of 0024/0025):
-- tenant RLS for the two new tables, mirroring employee_advances.
ALTER TABLE "quick_entry_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quick_entry_drafts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "quick_entry_drafts";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "quick_entry_drafts"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "quick_entry_drafts" TO app_user;--> statement-breakpoint
ALTER TABLE "quick_entry_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quick_entry_submissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "quick_entry_submissions";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "quick_entry_submissions"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "quick_entry_submissions" TO app_user;