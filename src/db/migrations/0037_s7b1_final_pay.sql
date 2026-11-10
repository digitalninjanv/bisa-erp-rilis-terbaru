DROP INDEX "payroll_runs_company_period_uq";--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "kind" text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_final_employee_uq" ON "payroll_runs" USING btree ("company_id","employee_id") WHERE "payroll_runs"."status" <> 'void' and "payroll_runs"."kind" = 'final';--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_company_period_uq" ON "payroll_runs" USING btree ("company_id","period") WHERE "payroll_runs"."status" <> 'void' and "payroll_runs"."kind" = 'regular';