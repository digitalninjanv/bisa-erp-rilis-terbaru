CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"check_in" time,
	"check_out" time,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"leave_request_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_shift_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_shifts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"work_days" jsonb NOT NULL,
	"crosses_midnight" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_shift_assignments" ADD CONSTRAINT "employee_shift_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_shift_assignments" ADD CONSTRAINT "employee_shift_assignments_shift_id_work_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."work_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_records_company_employee_date_uq" ON "attendance_records" USING btree ("company_id","employee_id","date");--> statement-breakpoint
CREATE INDEX "attendance_records_company_date_idx" ON "attendance_records" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "employee_shift_assignments_company_employee_idx" ON "employee_shift_assignments" USING btree ("company_id","employee_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "work_shifts_company_code_uq" ON "work_shifts" USING btree ("company_id","code");-- SIM-2 S7B-1 manual additions, same file by design (pattern of 0027):
-- tenant RLS for the new tables, mirroring employee_advances.
ALTER TABLE "work_shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_shifts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "work_shifts"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "work_shifts" TO app_user;--> statement-breakpoint
ALTER TABLE "employee_shift_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employee_shift_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "employee_shift_assignments"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_shift_assignments" TO app_user;--> statement-breakpoint
ALTER TABLE "attendance_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendance_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "attendance_records"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "attendance_records" TO app_user;
