CREATE TABLE "company_roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "company_roles_company_key_uq" ON "company_roles" USING btree ("company_id","key");--> statement-breakpoint
CREATE INDEX "company_roles_company_idx" ON "company_roles" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "company_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "company_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "company_roles";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "company_roles"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "company_roles" TO app_user;
