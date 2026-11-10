CREATE TABLE "overtime_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"day_type" text NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_component_drafts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"basis_snapshot" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"consumed_run_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_component_drafts" ADD CONSTRAINT "payroll_component_drafts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "overtime_requests_company_employee_idx" ON "overtime_requests" USING btree ("company_id","employee_id","date");--> statement-breakpoint
CREATE INDEX "overtime_requests_company_status_idx" ON "overtime_requests" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "payroll_component_drafts_company_period_idx" ON "payroll_component_drafts" USING btree ("company_id","period","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_component_drafts_active_uq" ON "payroll_component_drafts" USING btree ("company_id","employee_id","kind","period") WHERE "payroll_component_drafts"."status" = 'draft';-- SIM-2 S7B-1 manual additions, same file by design (pattern of 0027):
-- tenant RLS for the new tables, mirroring employee_advances.
ALTER TABLE "overtime_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "overtime_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "overtime_requests"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "overtime_requests" TO app_user;--> statement-breakpoint
ALTER TABLE "payroll_component_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_component_drafts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payroll_component_drafts"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_component_drafts" TO app_user;
