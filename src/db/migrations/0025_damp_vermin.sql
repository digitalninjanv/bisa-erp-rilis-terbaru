CREATE TABLE "employee_advance_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"advance_id" uuid NOT NULL,
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
CREATE TABLE "employee_advances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"remaining_amount" numeric(19, 4) NOT NULL,
	"account_id" uuid NOT NULL,
	"plan_mode" text DEFAULT 'full' NOT NULL,
	"plan_value" numeric(19, 4),
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"journal_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_items" ADD COLUMN "advance_deduction" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "total_advance_deductions" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_advance_entries" ADD CONSTRAINT "employee_advance_entries_advance_id_employee_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."employee_advances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_advance_entries_advance_idx" ON "employee_advance_entries" USING btree ("advance_id");--> statement-breakpoint
CREATE INDEX "employee_advance_entries_company_employee_idx" ON "employee_advance_entries" USING btree ("company_id","advance_id");--> statement-breakpoint
CREATE INDEX "employee_advance_entries_run_idx" ON "employee_advance_entries" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_advances_company_number_uq" ON "employee_advances" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "employee_advances_company_employee_idx" ON "employee_advances" USING btree ("company_id","employee_id","status");--> statement-breakpoint
CREATE INDEX "employee_advances_company_date_idx" ON "employee_advances" USING btree ("company_id","date");--> statement-breakpoint
-- A-11 (D-22) manual additions, same file by design (pattern of 0024):
-- tenant RLS for the two new tables, mirroring supplier_returns.
ALTER TABLE "employee_advances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employee_advances" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "employee_advances";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "employee_advances"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_advances" TO app_user;--> statement-breakpoint
ALTER TABLE "employee_advance_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employee_advance_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "employee_advance_entries";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "employee_advance_entries"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_advance_entries" TO app_user;--> statement-breakpoint
-- A-11 (D-22): every EXISTING company gains the "Piutang Karyawan" asset
-- account (code 1220, right after Kredit Pemasok 1210 in the seed COA)
-- and the `employee_receivable` account mapping pointing at it, so
-- posting an employee advance never has to guess an account. Companies
-- that already mapped the key are untouched; a company that already owns
-- an asset account named "Piutang Karyawan" is mapped to that account
-- instead of gaining a duplicate; if code 1220 is taken by an unrelated
-- account the new account falls back to code 1220-KP.
DO $$
DECLARE
  comp text;
  acct_id uuid;
BEGIN
  FOR comp IN SELECT company_id FROM company_settings LOOP
    IF EXISTS (
      SELECT 1 FROM account_mappings
      WHERE company_id = comp AND key = 'employee_receivable'
    ) THEN
      CONTINUE;
    END IF;
    SELECT id INTO acct_id FROM accounts
      WHERE company_id = comp AND name = 'Piutang Karyawan' AND type = 'asset'
      ORDER BY created_at
      LIMIT 1;
    IF acct_id IS NULL THEN
      INSERT INTO accounts (company_id, code, name, type, normal_balance)
      VALUES (
        comp,
        CASE WHEN EXISTS (
          SELECT 1 FROM accounts WHERE company_id = comp AND code = '1220'
        ) THEN '1220-KP' ELSE '1220' END,
        'Piutang Karyawan',
        'asset',
        'debit'
      )
      RETURNING id INTO acct_id;
    END IF;
    INSERT INTO account_mappings (company_id, key, account_id)
    VALUES (comp, 'employee_receivable', acct_id);
  END LOOP;
END $$;
