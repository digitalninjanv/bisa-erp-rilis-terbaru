CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" numeric(8, 2) NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"days_per_year" numeric(8, 2),
	"is_paid" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_requests_company_employee_idx" ON "leave_requests" USING btree ("company_id","employee_id","start_date");--> statement-breakpoint
CREATE INDEX "leave_requests_company_status_idx" ON "leave_requests" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_company_code_uq" ON "leave_types" USING btree ("company_id","code");--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE no action ON UPDATE no action;-- SIM-2 S7B-1 manual additions, same file by design (pattern of 0027):
-- tenant RLS for the new tables, mirroring employee_advances.
ALTER TABLE "leave_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leave_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "leave_types"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "leave_types" TO app_user;--> statement-breakpoint
ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leave_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "leave_requests"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "leave_requests" TO app_user;
