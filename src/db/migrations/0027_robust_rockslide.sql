CREATE TABLE "employee_statutory_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"program" text NOT NULL,
	"is_enrolled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_item_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"basis_amount" numeric(19, 4),
	"deductible_annual" boolean DEFAULT false NOT NULL,
	"basis_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_minimum_wages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"region_code" text NOT NULL,
	"region_name" text NOT NULL,
	"year" integer NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"decree_ref" text
);
--> statement-breakpoint
CREATE TABLE "payroll_overtime_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"day_type" text NOT NULL,
	"hour_from" integer NOT NULL,
	"hour_to" integer,
	"multiplier" numeric(7, 4) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date
);
--> statement-breakpoint
CREATE TABLE "payroll_ptkp_statuses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"annual_amount" numeric(19, 4) NOT NULL,
	"ter_category" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date
);
--> statement-breakpoint
CREATE TABLE "payroll_statutory_parameters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"key" text NOT NULL,
	"value" numeric(19, 4) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date
);
--> statement-breakpoint
CREATE TABLE "payroll_statutory_programs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"program" text NOT NULL,
	"risk_class" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"employer_rate" numeric(7, 4) NOT NULL,
	"employee_rate" numeric(7, 4) NOT NULL,
	"wage_cap" numeric(19, 4),
	"wage_floor" numeric(19, 4),
	"adds_to_tax_gross" boolean DEFAULT false NOT NULL,
	"employee_deductible_annual" boolean DEFAULT false NOT NULL,
	"counts_as_employer_cost" boolean DEFAULT true NOT NULL,
	"funding_note" text,
	"effective_from" date NOT NULL,
	"effective_to" date
);
--> statement-breakpoint
CREATE TABLE "payroll_statutory_settings" (
	"company_id" text PRIMARY KEY NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"pph21_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_tax_brackets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"lower_bound" numeric(19, 4) NOT NULL,
	"upper_bound" numeric(19, 4),
	"rate" numeric(7, 4) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date
);
--> statement-breakpoint
CREATE TABLE "payroll_ter_brackets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"category" text NOT NULL,
	"lower_bound" numeric(19, 4) NOT NULL,
	"upper_bound" numeric(19, 4),
	"rate" numeric(7, 4) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date
);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "tax_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "nik" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "npwp" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "ptkp_status" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "contract_type" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "jkk_risk_class" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "work_region_code" text;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "total_pph21" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "total_statutory_employee" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "total_employer_contributions" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_statutory_enrollments" ADD CONSTRAINT "employee_statutory_enrollments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_item_lines" ADD CONSTRAINT "payroll_item_lines_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_item_lines" ADD CONSTRAINT "payroll_item_lines_item_id_payroll_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."payroll_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_enrollments_company_employee_program_uq" ON "employee_statutory_enrollments" USING btree ("company_id","employee_id","program");--> statement-breakpoint
CREATE INDEX "employee_enrollments_company_employee_idx" ON "employee_statutory_enrollments" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_item_lines_run_idx" ON "payroll_item_lines" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "payroll_item_lines_company_employee_idx" ON "payroll_item_lines" USING btree ("company_id","employee_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_min_wages_company_region_year_uq" ON "payroll_minimum_wages" USING btree ("company_id","region_code","year");--> statement-breakpoint
CREATE INDEX "payroll_min_wages_company_idx" ON "payroll_minimum_wages" USING btree ("company_id","region_code");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_overtime_company_type_from_uq" ON "payroll_overtime_rules" USING btree ("company_id","day_type","hour_from","effective_from");--> statement-breakpoint
CREATE INDEX "payroll_overtime_company_idx" ON "payroll_overtime_rules" USING btree ("company_id","day_type");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_ptkp_company_code_from_uq" ON "payroll_ptkp_statuses" USING btree ("company_id","code","effective_from");--> statement-breakpoint
CREATE INDEX "payroll_ptkp_company_idx" ON "payroll_ptkp_statuses" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_params_company_key_from_uq" ON "payroll_statutory_parameters" USING btree ("company_id","key","effective_from");--> statement-breakpoint
CREATE INDEX "payroll_params_company_idx" ON "payroll_statutory_parameters" USING btree ("company_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_programs_company_program_risk_from_uq" ON "payroll_statutory_programs" USING btree ("company_id","program","risk_class","effective_from");--> statement-breakpoint
CREATE INDEX "payroll_programs_company_idx" ON "payroll_statutory_programs" USING btree ("company_id","program");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_tax_brackets_company_lower_from_uq" ON "payroll_tax_brackets" USING btree ("company_id","lower_bound","effective_from");--> statement-breakpoint
CREATE INDEX "payroll_tax_brackets_company_idx" ON "payroll_tax_brackets" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_ter_company_cat_lower_from_uq" ON "payroll_ter_brackets" USING btree ("company_id","category","lower_bound","effective_from");--> statement-breakpoint
CREATE INDEX "payroll_ter_company_idx" ON "payroll_ter_brackets" USING btree ("company_id","category");-- SIM-2 S2 manual additions, same file by design (pattern of 0024/0025):
-- tenant RLS for the new tables, mirroring employee_advances.
ALTER TABLE "payroll_statutory_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_statutory_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payroll_statutory_settings"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_statutory_settings" TO app_user;--> statement-breakpoint
ALTER TABLE "payroll_ptkp_statuses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_ptkp_statuses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payroll_ptkp_statuses"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_ptkp_statuses" TO app_user;--> statement-breakpoint
ALTER TABLE "payroll_ter_brackets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_ter_brackets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payroll_ter_brackets"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_ter_brackets" TO app_user;--> statement-breakpoint
ALTER TABLE "payroll_tax_brackets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_tax_brackets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payroll_tax_brackets"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_tax_brackets" TO app_user;--> statement-breakpoint
ALTER TABLE "payroll_statutory_programs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_statutory_programs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payroll_statutory_programs"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_statutory_programs" TO app_user;--> statement-breakpoint
ALTER TABLE "payroll_statutory_parameters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_statutory_parameters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payroll_statutory_parameters"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_statutory_parameters" TO app_user;--> statement-breakpoint
ALTER TABLE "payroll_overtime_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_overtime_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payroll_overtime_rules"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_overtime_rules" TO app_user;--> statement-breakpoint
ALTER TABLE "payroll_minimum_wages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_minimum_wages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payroll_minimum_wages"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_minimum_wages" TO app_user;--> statement-breakpoint
ALTER TABLE "employee_statutory_enrollments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employee_statutory_enrollments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "employee_statutory_enrollments"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_statutory_enrollments" TO app_user;--> statement-breakpoint
ALTER TABLE "payroll_item_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_item_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payroll_item_lines"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_item_lines" TO app_user;--> statement-breakpoint
-- Audit PPN: saklar eksplisit diisi dari keadaan lama agar perilaku
-- setiap perusahaan tidak berubah oleh migrasi ini (tarif > 0 = aktif).
UPDATE "company_settings" SET "tax_enabled" = ("tax_rate" > 0);--> statement-breakpoint
-- SIM-2 S2: every EXISTING company gains the statutory payroll accounts
-- (2110 Utang PPh 21, 2120 Utang BPJS, 6080 Beban Iuran BPJS Perusahaan)
-- and their account mappings, following the 0025 pattern: a company
-- that already mapped a key is untouched; an existing same-named
-- account of the right type is reused; a taken code falls back to a
-- suffixed code.
DO $$
DECLARE
  comp text;
  acct_id uuid;
  spec RECORD;
BEGIN
  FOR comp IN SELECT company_id FROM company_settings LOOP
    FOR spec IN
      SELECT * FROM (VALUES
        ('pph21_payable', '2110', '2110-PPH', 'Utang PPh 21', 'liability', 'credit'),
        ('bpjs_payable', '2120', '2120-BPJS', 'Utang BPJS', 'liability', 'credit'),
        ('payroll_employer_expense', '6080', '6080-BPJS', 'Beban Iuran BPJS Perusahaan', 'expense', 'debit')
      ) AS t(map_key, code, fallback_code, acct_name, acct_type, normal_bal)
    LOOP
      IF EXISTS (
        SELECT 1 FROM account_mappings
        WHERE company_id = comp AND key = spec.map_key
      ) THEN
        CONTINUE;
      END IF;
      SELECT id INTO acct_id FROM accounts
        WHERE company_id = comp AND name = spec.acct_name AND type = spec.acct_type
        ORDER BY created_at
        LIMIT 1;
      IF acct_id IS NULL THEN
        INSERT INTO accounts (company_id, code, name, type, normal_balance)
        VALUES (
          comp,
          CASE WHEN EXISTS (
            SELECT 1 FROM accounts WHERE company_id = comp AND code = spec.code
          ) THEN spec.fallback_code ELSE spec.code END,
          spec.acct_name,
          spec.acct_type,
          spec.normal_bal
        )
        RETURNING id INTO acct_id;
      END IF;
      INSERT INTO account_mappings (company_id, key, account_id)
      VALUES (comp, spec.map_key, acct_id);
    END LOOP;
  END LOOP;
END $$;--> statement-breakpoint
-- SIM-2 S2: konfigurasi Payroll Indonesia bawaan untuk setiap
-- perusahaan yang ada (saklar utama NONAKTIF — payroll tetap generik
-- sampai admin mengaktifkannya di Pengaturan → Payroll Indonesia).
-- Nilai disemai dari src/lib/payroll-indonesia-defaults.ts.
DO $$
DECLARE
  comp text;
BEGIN
  FOR comp IN SELECT company_id FROM company_settings LOOP
    INSERT INTO payroll_statutory_settings (company_id, is_enabled, pph21_enabled) VALUES (comp, false, true) ON CONFLICT (company_id) DO NOTHING;
    INSERT INTO payroll_ptkp_statuses (company_id, code, annual_amount, ter_category, effective_from) VALUES
      (comp, 'TK/0', 54000000, 'A', '2016-01-01'),
      (comp, 'TK/1', 58500000, 'A', '2016-01-01'),
      (comp, 'K/0', 58500000, 'A', '2016-01-01'),
      (comp, 'TK/2', 63000000, 'B', '2016-01-01'),
      (comp, 'K/1', 63000000, 'B', '2016-01-01'),
      (comp, 'TK/3', 67500000, 'B', '2016-01-01'),
      (comp, 'K/2', 67500000, 'B', '2016-01-01'),
      (comp, 'K/3', 72000000, 'C', '2016-01-01')
      ON CONFLICT DO NOTHING;
    INSERT INTO payroll_ter_brackets (company_id, category, lower_bound, upper_bound, rate, effective_from) VALUES
      (comp, 'A', 0, 5400000, 0, '2024-01-01'),
      (comp, 'A', 5400001, 5650000, 0.25, '2024-01-01'),
      (comp, 'A', 5650001, 5950000, 0.5, '2024-01-01'),
      (comp, 'A', 5950001, 6300000, 0.75, '2024-01-01'),
      (comp, 'A', 6300001, 6750000, 1, '2024-01-01'),
      (comp, 'A', 6750001, 7500000, 1.25, '2024-01-01'),
      (comp, 'A', 7500001, 8550000, 1.5, '2024-01-01'),
      (comp, 'A', 8550001, 9650000, 1.75, '2024-01-01'),
      (comp, 'A', 9650001, 10050000, 2, '2024-01-01'),
      (comp, 'A', 10050001, 10350000, 2.25, '2024-01-01'),
      (comp, 'A', 10350001, 10700000, 2.5, '2024-01-01'),
      (comp, 'A', 10700001, 11050000, 3, '2024-01-01'),
      (comp, 'A', 11050001, 11600000, 3.5, '2024-01-01'),
      (comp, 'A', 11600001, 12500000, 4, '2024-01-01'),
      (comp, 'A', 12500001, 13750000, 5, '2024-01-01'),
      (comp, 'A', 13750001, 15100000, 6, '2024-01-01'),
      (comp, 'A', 15100001, 16950000, 7, '2024-01-01'),
      (comp, 'A', 16950001, 19750000, 8, '2024-01-01'),
      (comp, 'A', 19750001, 24150000, 9, '2024-01-01'),
      (comp, 'A', 24150001, 26450000, 10, '2024-01-01'),
      (comp, 'A', 26450001, 28000000, 11, '2024-01-01'),
      (comp, 'A', 28000001, 30050000, 12, '2024-01-01'),
      (comp, 'A', 30050001, 32400000, 13, '2024-01-01'),
      (comp, 'A', 32400001, 35400000, 14, '2024-01-01'),
      (comp, 'A', 35400001, 39100000, 15, '2024-01-01'),
      (comp, 'A', 39100001, 43850000, 16, '2024-01-01'),
      (comp, 'A', 43850001, 47800000, 17, '2024-01-01'),
      (comp, 'A', 47800001, 51400000, 18, '2024-01-01'),
      (comp, 'A', 51400001, 56300000, 19, '2024-01-01'),
      (comp, 'A', 56300001, 62200000, 20, '2024-01-01'),
      (comp, 'A', 62200001, 68600000, 21, '2024-01-01'),
      (comp, 'A', 68600001, 77500000, 22, '2024-01-01'),
      (comp, 'A', 77500001, 89000000, 23, '2024-01-01'),
      (comp, 'A', 89000001, 103000000, 24, '2024-01-01'),
      (comp, 'A', 103000001, 125000000, 25, '2024-01-01'),
      (comp, 'A', 125000001, 157000000, 26, '2024-01-01'),
      (comp, 'A', 157000001, 206000000, 27, '2024-01-01'),
      (comp, 'A', 206000001, 337000000, 28, '2024-01-01'),
      (comp, 'A', 337000001, 454000000, 29, '2024-01-01'),
      (comp, 'A', 454000001, 550000000, 30, '2024-01-01'),
      (comp, 'A', 550000001, 695000000, 31, '2024-01-01'),
      (comp, 'A', 695000001, 910000000, 32, '2024-01-01'),
      (comp, 'A', 910000001, 1400000000, 33, '2024-01-01'),
      (comp, 'A', 1400000001, NULL, 34, '2024-01-01'),
      (comp, 'B', 0, 6200000, 0, '2024-01-01'),
      (comp, 'B', 6200001, 6500000, 0.25, '2024-01-01'),
      (comp, 'B', 6500001, 6850000, 0.5, '2024-01-01'),
      (comp, 'B', 6850001, 7300000, 0.75, '2024-01-01'),
      (comp, 'B', 7300001, 9200000, 1, '2024-01-01'),
      (comp, 'B', 9200001, 10750000, 1.5, '2024-01-01'),
      (comp, 'B', 10750001, 11250000, 2, '2024-01-01'),
      (comp, 'B', 11250001, 11600000, 2.5, '2024-01-01'),
      (comp, 'B', 11600001, 12600000, 3, '2024-01-01'),
      (comp, 'B', 12600001, 13600000, 4, '2024-01-01'),
      (comp, 'B', 13600001, 14950000, 5, '2024-01-01'),
      (comp, 'B', 14950001, 16400000, 6, '2024-01-01'),
      (comp, 'B', 16400001, 18450000, 7, '2024-01-01'),
      (comp, 'B', 18450001, 21850000, 8, '2024-01-01'),
      (comp, 'B', 21850001, 26000000, 9, '2024-01-01'),
      (comp, 'B', 26000001, 27700000, 10, '2024-01-01'),
      (comp, 'B', 27700001, 29350000, 11, '2024-01-01'),
      (comp, 'B', 29350001, 31450000, 12, '2024-01-01'),
      (comp, 'B', 31450001, 33950000, 13, '2024-01-01'),
      (comp, 'B', 33950001, 37100000, 14, '2024-01-01'),
      (comp, 'B', 37100001, 41100000, 15, '2024-01-01'),
      (comp, 'B', 41100001, 45800000, 16, '2024-01-01'),
      (comp, 'B', 45800001, 49500000, 17, '2024-01-01'),
      (comp, 'B', 49500001, 53800000, 18, '2024-01-01'),
      (comp, 'B', 53800001, 58500000, 19, '2024-01-01'),
      (comp, 'B', 58500001, 64000000, 20, '2024-01-01'),
      (comp, 'B', 64000001, 71000000, 21, '2024-01-01'),
      (comp, 'B', 71000001, 80000000, 22, '2024-01-01'),
      (comp, 'B', 80000001, 93000000, 23, '2024-01-01'),
      (comp, 'B', 93000001, 109000000, 24, '2024-01-01'),
      (comp, 'B', 109000001, 129000000, 25, '2024-01-01'),
      (comp, 'B', 129000001, 163000000, 26, '2024-01-01'),
      (comp, 'B', 163000001, 211000000, 27, '2024-01-01'),
      (comp, 'B', 211000001, 374000000, 28, '2024-01-01'),
      (comp, 'B', 374000001, 459000000, 29, '2024-01-01'),
      (comp, 'B', 459000001, 555000000, 30, '2024-01-01'),
      (comp, 'B', 555000001, 704000000, 31, '2024-01-01'),
      (comp, 'B', 704000001, 957000000, 32, '2024-01-01'),
      (comp, 'B', 957000001, 1405000000, 33, '2024-01-01'),
      (comp, 'B', 1405000001, NULL, 34, '2024-01-01'),
      (comp, 'C', 0, 6600000, 0, '2024-01-01'),
      (comp, 'C', 6600001, 6950000, 0.25, '2024-01-01'),
      (comp, 'C', 6950001, 7350000, 0.5, '2024-01-01'),
      (comp, 'C', 7350001, 7800000, 0.75, '2024-01-01'),
      (comp, 'C', 7800001, 8850000, 1, '2024-01-01'),
      (comp, 'C', 8850001, 9800000, 1.25, '2024-01-01'),
      (comp, 'C', 9800001, 10950000, 1.5, '2024-01-01'),
      (comp, 'C', 10950001, 11200000, 1.75, '2024-01-01'),
      (comp, 'C', 11200001, 12050000, 2, '2024-01-01'),
      (comp, 'C', 12050001, 12950000, 3, '2024-01-01'),
      (comp, 'C', 12950001, 14150000, 4, '2024-01-01'),
      (comp, 'C', 14150001, 15550000, 5, '2024-01-01'),
      (comp, 'C', 15550001, 17050000, 6, '2024-01-01'),
      (comp, 'C', 17050001, 19500000, 7, '2024-01-01'),
      (comp, 'C', 19500001, 22700000, 8, '2024-01-01'),
      (comp, 'C', 22700001, 26600000, 9, '2024-01-01'),
      (comp, 'C', 26600001, 28100000, 10, '2024-01-01'),
      (comp, 'C', 28100001, 30100000, 11, '2024-01-01'),
      (comp, 'C', 30100001, 32600000, 12, '2024-01-01'),
      (comp, 'C', 32600001, 35400000, 13, '2024-01-01'),
      (comp, 'C', 35400001, 38900000, 14, '2024-01-01'),
      (comp, 'C', 38900001, 43000000, 15, '2024-01-01'),
      (comp, 'C', 43000001, 47400000, 16, '2024-01-01'),
      (comp, 'C', 47400001, 51200000, 17, '2024-01-01'),
      (comp, 'C', 51200001, 55800000, 18, '2024-01-01'),
      (comp, 'C', 55800001, 60400000, 19, '2024-01-01'),
      (comp, 'C', 60400001, 66700000, 20, '2024-01-01'),
      (comp, 'C', 66700001, 74500000, 21, '2024-01-01'),
      (comp, 'C', 74500001, 83200000, 22, '2024-01-01'),
      (comp, 'C', 83200001, 95600000, 23, '2024-01-01'),
      (comp, 'C', 95600001, 110000000, 24, '2024-01-01'),
      (comp, 'C', 110000001, 134000000, 25, '2024-01-01'),
      (comp, 'C', 134000001, 169000000, 26, '2024-01-01'),
      (comp, 'C', 169000001, 221000000, 27, '2024-01-01'),
      (comp, 'C', 221000001, 390000000, 28, '2024-01-01'),
      (comp, 'C', 390000001, 463000000, 29, '2024-01-01'),
      (comp, 'C', 463000001, 561000000, 30, '2024-01-01'),
      (comp, 'C', 561000001, 709000000, 31, '2024-01-01'),
      (comp, 'C', 709000001, 965000000, 32, '2024-01-01'),
      (comp, 'C', 965000001, 1419000000, 33, '2024-01-01'),
      (comp, 'C', 1419000001, NULL, 34, '2024-01-01')
      ON CONFLICT DO NOTHING;
    INSERT INTO payroll_tax_brackets (company_id, lower_bound, upper_bound, rate, effective_from) VALUES
      (comp, 0, 60000000, 5, '2022-01-01'),
      (comp, 60000000, 250000000, 15, '2022-01-01'),
      (comp, 250000000, 500000000, 25, '2022-01-01'),
      (comp, 500000000, 5000000000, 30, '2022-01-01'),
      (comp, 5000000000, NULL, 35, '2022-01-01')
      ON CONFLICT DO NOTHING;
    INSERT INTO payroll_statutory_programs (company_id, program, risk_class, is_enabled, employer_rate, employee_rate, wage_cap, wage_floor, adds_to_tax_gross, employee_deductible_annual, counts_as_employer_cost, funding_note, effective_from, effective_to) VALUES
      (comp, 'bpjs_kes', NULL, true, 4, 1, 12000000, NULL, true, false, true, 'Perpres 64/2020 Pasal 30 & 32(1): total 5% dari upah (pokok + tunjangan tetap), dasar dibatasi Rp12.000.000.', '2024-01-01', NULL),
      (comp, 'jht', NULL, true, 3.7, 2, NULL, NULL, false, true, true, 'PP 46/2015 Pasal 16: total 5,7% dari upah sebulan, tanpa batas atas.', '2024-01-01', NULL),
      (comp, 'jkk', 'very_low', true, 0.24, 0, NULL, NULL, true, false, true, 'PP 44/2015 Pasal 16: tarif menurut kelas risiko pekerjaan, ditanggung perusahaan.', '2024-01-01', NULL),
      (comp, 'jkk', 'low', true, 0.54, 0, NULL, NULL, true, false, true, 'PP 44/2015 Pasal 16: tarif menurut kelas risiko pekerjaan, ditanggung perusahaan.', '2024-01-01', NULL),
      (comp, 'jkk', 'medium', true, 0.89, 0, NULL, NULL, true, false, true, 'PP 44/2015 Pasal 16: tarif menurut kelas risiko pekerjaan, ditanggung perusahaan.', '2024-01-01', NULL),
      (comp, 'jkk', 'high', true, 1.27, 0, NULL, NULL, true, false, true, 'PP 44/2015 Pasal 16: tarif menurut kelas risiko pekerjaan, ditanggung perusahaan.', '2024-01-01', NULL),
      (comp, 'jkk', 'very_high', true, 1.74, 0, NULL, NULL, true, false, true, 'PP 44/2015 Pasal 16: tarif menurut kelas risiko pekerjaan, ditanggung perusahaan.', '2024-01-01', NULL),
      (comp, 'jkm', NULL, true, 0.3, 0, NULL, NULL, true, false, true, 'PP 44/2015 Pasal 18: 0,30% dari upah, ditanggung perusahaan.', '2024-01-01', NULL),
      (comp, 'jp', NULL, true, 2, 1, 10547400, NULL, false, true, true, 'PP 45/2015 Pasal 28–29: total 3%; batas upah disesuaikan tahunan mengikuti pertumbuhan PDB (efektif Maret 2025: Rp10.547.400).', '2025-03-01', NULL),
      (comp, 'jkp', NULL, true, 0.46, 0, 5000000, NULL, false, false, false, 'PP 37/2021 Pasal 11: 0,46% — 0,22% Pemerintah Pusat + 0,14% rekomposisi JKK + 0,10% rekomposisi JKM.', '2021-02-02', '2025-02-06'),
      (comp, 'jkp', NULL, true, 0.36, 0, 5000000, NULL, false, false, false, 'PP 6/2025: 0,36% — 0,22% Pemerintah Pusat + 0,14% rekomposisi JKK. Bukan beban kas perusahaan.', '2025-02-07', NULL)
      ON CONFLICT DO NOTHING;
    INSERT INTO payroll_statutory_parameters (company_id, key, value, effective_from) VALUES
      (comp, 'biaya_jabatan_rate', 5, '2024-01-01'),
      (comp, 'biaya_jabatan_cap_year', 6000000, '2024-01-01'),
      (comp, 'biaya_jabatan_cap_month', 500000, '2024-01-01'),
      (comp, 'non_npwp_surcharge_rate', 20, '2024-01-01'),
      (comp, 'thr_min_months', 1, '2024-01-01'),
      (comp, 'thr_full_months', 12, '2024-01-01'),
      (comp, 'overtime_hourly_divisor', 173, '2024-01-01')
      ON CONFLICT DO NOTHING;
    INSERT INTO payroll_overtime_rules (company_id, day_type, hour_from, hour_to, multiplier, effective_from) VALUES
      (comp, 'workday', 1, 1, 1.5, '2021-02-02'),
      (comp, 'workday', 2, NULL, 2, '2021-02-02'),
      (comp, 'rest_5day', 1, 8, 2, '2021-02-02'),
      (comp, 'rest_5day', 9, 9, 3, '2021-02-02'),
      (comp, 'rest_5day', 10, NULL, 4, '2021-02-02'),
      (comp, 'rest_6day', 1, 7, 2, '2021-02-02'),
      (comp, 'rest_6day', 8, 8, 3, '2021-02-02'),
      (comp, 'rest_6day', 9, NULL, 4, '2021-02-02'),
      (comp, 'shortest_day_6day', 1, 5, 2, '2021-02-02'),
      (comp, 'shortest_day_6day', 6, 6, 3, '2021-02-02'),
      (comp, 'shortest_day_6day', 7, NULL, 4, '2021-02-02')
      ON CONFLICT DO NOTHING;
    INSERT INTO payroll_minimum_wages (company_id, region_code, region_name, year, amount, decree_ref) VALUES
      (comp, 'ID-JK', 'DKI Jakarta', 2026, 5729876, 'Kepgub DKI 1142/2025'),
      (comp, 'ID-JB', 'Jawa Barat', 2026, 2317601, NULL)
      ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
