CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"field_group" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"effective_date" date NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_parameters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date
);
--> statement-breakpoint
CREATE TABLE "job_positions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "position_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "manager_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "contract_start" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "contract_end" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "employment_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "termination_date" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "termination_reason" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "termination_note" text;--> statement-breakpoint
ALTER TABLE "employee_history" ADD CONSTRAINT "employee_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_company_code_uq" ON "departments" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "employee_history_company_employee_idx" ON "employee_history" USING btree ("company_id","employee_id","effective_date");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_parameters_company_key_from_uq" ON "hr_parameters" USING btree ("company_id","key","effective_from");--> statement-breakpoint
CREATE INDEX "hr_parameters_company_idx" ON "hr_parameters" USING btree ("company_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "job_positions_company_code_uq" ON "job_positions" USING btree ("company_id","code");--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_position_id_job_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."job_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;-- SIM-2 S7B-1 manual additions, same file by design (pattern of 0027):
-- tenant RLS for the new tables, mirroring employee_advances.
ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "departments"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "departments" TO app_user;--> statement-breakpoint
ALTER TABLE "job_positions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_positions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "job_positions"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "job_positions" TO app_user;--> statement-breakpoint
ALTER TABLE "employee_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employee_history" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "employee_history"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_history" TO app_user;--> statement-breakpoint
ALTER TABLE "hr_parameters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hr_parameters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "hr_parameters"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_parameters" TO app_user;
