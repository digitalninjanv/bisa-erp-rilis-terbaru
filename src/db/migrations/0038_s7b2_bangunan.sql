CREATE TABLE "employee_loan_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"loan_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"account_id" uuid,
	"journal_id" uuid,
	"payroll_run_id" uuid,
	"reversal_of_id" uuid,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_loans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"remaining_amount" numeric(19, 4) NOT NULL,
	"account_id" uuid NOT NULL,
	"plan_mode" text DEFAULT 'tenor' NOT NULL,
	"plan_value" numeric(19, 4),
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"journal_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_asset_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"default_useful_life_months" integer,
	"default_residual_percent" numeric(7, 4),
	"asset_account_id" uuid,
	"accumulated_account_id" uuid,
	"expense_account_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_asset_depreciation_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"period" text NOT NULL,
	"total_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"asset_count" integer DEFAULT 0 NOT NULL,
	"journal_id" uuid,
	"status" text DEFAULT 'posted' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_asset_depreciations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"period" text NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"accumulated_after" numeric(19, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid,
	"acquisition_date" date NOT NULL,
	"cost" numeric(19, 4) NOT NULL,
	"residual_value" numeric(19, 4) DEFAULT '0' NOT NULL,
	"useful_life_months" integer NOT NULL,
	"method" text DEFAULT 'straight_line' NOT NULL,
	"source_account_id" uuid,
	"journal_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"disposal_date" date,
	"disposal_proceeds" numeric(19, 4),
	"disposal_account_id" uuid,
	"disposal_journal_id" uuid,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_request_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" text,
	"product_sku" text,
	"qty" numeric(19, 4) NOT NULL,
	"estimated_price" numeric(19, 4) DEFAULT '0' NOT NULL,
	"line_total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "purchase_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"requester_employee_id" uuid,
	"department_id" uuid,
	"date" date NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"total_estimate" numeric(19, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"converted_po_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reimbursement_claims" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"expense_account_id" uuid NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"approved_amount" numeric(19, 4),
	"description" text NOT NULL,
	"attachment_name" text,
	"attachment_note" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"payment_account_id" uuid,
	"paid_date" date,
	"journal_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(19, 4) NOT NULL,
	"date" date NOT NULL,
	"expires_at" timestamp with time zone,
	"reason" text,
	"status" text DEFAULT 'active' NOT NULL,
	"released_by" text,
	"released_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_serial_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"serial_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"warehouse_id" uuid,
	"reference_type" text,
	"reference_id" uuid,
	"reference_number" text,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_serials" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid,
	"serial_number" text NOT NULL,
	"status" text DEFAULT 'in_stock' NOT NULL,
	"receipt_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "pos_offline_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "transfer_two_step_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "pr_approval_threshold" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "payroll_items" ADD COLUMN "loan_deduction" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "total_loan_deductions" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "track_serial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_documents" ADD COLUMN "received_by" text;--> statement-breakpoint
ALTER TABLE "stock_documents" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employee_loan_entries" ADD CONSTRAINT "employee_loan_entries_loan_id_employee_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."employee_loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_categories" ADD CONSTRAINT "fixed_asset_categories_asset_account_id_accounts_id_fk" FOREIGN KEY ("asset_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_categories" ADD CONSTRAINT "fixed_asset_categories_accumulated_account_id_accounts_id_fk" FOREIGN KEY ("accumulated_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_categories" ADD CONSTRAINT "fixed_asset_categories_expense_account_id_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_depreciations" ADD CONSTRAINT "fixed_asset_depreciations_run_id_fixed_asset_depreciation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."fixed_asset_depreciation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_depreciations" ADD CONSTRAINT "fixed_asset_depreciations_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_category_id_fixed_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."fixed_asset_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_source_account_id_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_disposal_account_id_accounts_id_fk" FOREIGN KEY ("disposal_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_request_id_purchase_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_requester_employee_id_employees_id_fk" FOREIGN KEY ("requester_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_converted_po_id_purchase_orders_id_fk" FOREIGN KEY ("converted_po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_expense_account_id_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_serial_movements" ADD CONSTRAINT "stock_serial_movements_serial_id_stock_serials_id_fk" FOREIGN KEY ("serial_id") REFERENCES "public"."stock_serials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_serial_movements" ADD CONSTRAINT "stock_serial_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_serial_movements" ADD CONSTRAINT "stock_serial_movements_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_loan_entries_loan_idx" ON "employee_loan_entries" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "employee_loan_entries_run_idx" ON "employee_loan_entries" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_loans_company_number_uq" ON "employee_loans" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "employee_loans_company_employee_idx" ON "employee_loans" USING btree ("company_id","employee_id","status");--> statement-breakpoint
CREATE INDEX "employee_loans_company_date_idx" ON "employee_loans" USING btree ("company_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_asset_categories_company_code_uq" ON "fixed_asset_categories" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_asset_depr_runs_company_period_uq" ON "fixed_asset_depreciation_runs" USING btree ("company_id","period") WHERE "fixed_asset_depreciation_runs"."status" <> 'void';--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_asset_depreciations_asset_period_uq" ON "fixed_asset_depreciations" USING btree ("company_id","asset_id","period");--> statement-breakpoint
CREATE INDEX "fixed_asset_depreciations_run_idx" ON "fixed_asset_depreciations" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_assets_company_number_uq" ON "fixed_assets" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "fixed_assets_company_status_idx" ON "fixed_assets" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "purchase_request_lines_request_idx" ON "purchase_request_lines" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_requests_company_number_uq" ON "purchase_requests" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "purchase_requests_company_status_idx" ON "purchase_requests" USING btree ("company_id","status","date");--> statement-breakpoint
CREATE UNIQUE INDEX "reimbursement_claims_company_number_uq" ON "reimbursement_claims" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "reimbursement_claims_company_employee_idx" ON "reimbursement_claims" USING btree ("company_id","employee_id","status");--> statement-breakpoint
CREATE INDEX "reimbursement_claims_company_status_idx" ON "reimbursement_claims" USING btree ("company_id","status","date");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_reservations_company_number_uq" ON "stock_reservations" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "stock_reservations_company_avail_idx" ON "stock_reservations" USING btree ("company_id","warehouse_id","product_id","status");--> statement-breakpoint
CREATE INDEX "stock_serial_movements_serial_idx" ON "stock_serial_movements" USING btree ("serial_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_serial_movements_company_product_idx" ON "stock_serial_movements" USING btree ("company_id","product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_serials_company_product_serial_uq" ON "stock_serials" USING btree ("company_id","product_id","serial_number");--> statement-breakpoint
CREATE INDEX "stock_serials_company_product_status_idx" ON "stock_serials" USING btree ("company_id","product_id","status");--> statement-breakpoint
CREATE INDEX "stock_serials_company_warehouse_idx" ON "stock_serials" USING btree ("company_id","warehouse_id","status");-- SIM-2 S7B-2 manual additions, same file by design (pattern of 0027/0033):
-- tenant RLS for the new tables, mirroring employee_advances.
ALTER TABLE "employee_loans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employee_loans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "employee_loans"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_loans" TO app_user;--> statement-breakpoint
ALTER TABLE "employee_loan_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employee_loan_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "employee_loan_entries"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_loan_entries" TO app_user;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "reimbursement_claims"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "reimbursement_claims" TO app_user;--> statement-breakpoint
ALTER TABLE "fixed_asset_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fixed_asset_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "fixed_asset_categories"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "fixed_asset_categories" TO app_user;--> statement-breakpoint
ALTER TABLE "fixed_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fixed_assets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "fixed_assets"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "fixed_assets" TO app_user;--> statement-breakpoint
ALTER TABLE "fixed_asset_depreciation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fixed_asset_depreciation_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "fixed_asset_depreciation_runs"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "fixed_asset_depreciation_runs" TO app_user;--> statement-breakpoint
ALTER TABLE "fixed_asset_depreciations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fixed_asset_depreciations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "fixed_asset_depreciations"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "fixed_asset_depreciations" TO app_user;--> statement-breakpoint
ALTER TABLE "purchase_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "purchase_requests"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_requests" TO app_user;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "purchase_request_lines"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_request_lines" TO app_user;--> statement-breakpoint
ALTER TABLE "stock_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_reservations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "stock_reservations"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_reservations" TO app_user;--> statement-breakpoint
ALTER TABLE "stock_serials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_serials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "stock_serials"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_serials" TO app_user;--> statement-breakpoint
ALTER TABLE "stock_serial_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_serial_movements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "stock_serial_movements"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_serial_movements" TO app_user;
