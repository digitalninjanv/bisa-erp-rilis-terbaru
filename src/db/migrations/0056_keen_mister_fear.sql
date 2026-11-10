ALTER TABLE "accounts" ADD COLUMN "psak118_category" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "expense_nature" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "expense_function" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "is_contra" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "contra_of" uuid;--> statement-breakpoint
-- A-27 B5 backfill (deterministic): PSAK 118 tags come ONLY from the
-- account's own type/section and from official account_mappings keys of
-- the same company — never guessed from account names or code ranges
-- (rules live in src/lib/akuntansi/psak118.ts; this SQL is the same
-- rules executed over existing data).
-- 1) Category: every income-statement account defaults to 'operating'.
--    Investing/financing/income-tax splits are source-based and are NOT
--    inferred here — the accountant adjusts them in the account form.
UPDATE "accounts" SET "psak118_category" = 'operating' WHERE "type" IN ('revenue', 'cogs', 'expense') AND "psak118_category" IS NULL;--> statement-breakpoint
-- 2) Expense nature/function base by type: cogs = inventory expensed /
--    function cogs; expense = other / function admin (adjustable).
UPDATE "accounts" SET "expense_nature" = 'inventory_expensed', "expense_function" = 'cogs' WHERE "type" = 'cogs' AND "expense_nature" IS NULL;--> statement-breakpoint
UPDATE "accounts" SET "expense_nature" = 'other', "expense_function" = 'admin' WHERE "type" = 'expense' AND "expense_nature" IS NULL;--> statement-breakpoint
-- 3) Nature refinements from mapping keys (key semantics are certain):
--    inventory shrink/damaged = inventory writedown; salary keys =
--    employee benefits; bank fee = bank charges; receivable write-off =
--    impairment (operating by PSAK 118 — trade receivable ECL).
UPDATE "accounts" AS a SET "expense_nature" = 'inventory_writedown' FROM "account_mappings" AS m WHERE m."account_id" = a."id" AND m."company_id" = a."company_id" AND m."key" IN ('inventory_shrink', 'damaged');--> statement-breakpoint
UPDATE "accounts" AS a SET "expense_nature" = 'employee_benefits' FROM "account_mappings" AS m WHERE m."account_id" = a."id" AND m."company_id" = a."company_id" AND m."key" IN ('salary_expense', 'payroll_employer_expense');--> statement-breakpoint
UPDATE "accounts" AS a SET "expense_nature" = 'bank_charges' FROM "account_mappings" AS m WHERE m."account_id" = a."id" AND m."company_id" = a."company_id" AND m."key" = 'bank_fee';--> statement-breakpoint
UPDATE "accounts" AS a SET "expense_nature" = 'impairment' FROM "account_mappings" AS m WHERE m."account_id" = a."id" AND m."company_id" = a."company_id" AND m."key" = 'receivable_writeoff';--> statement-breakpoint
-- 4) Contra markers from mapping keys: sales discount/returns contra
--    the revenue account; accumulated depreciation contra the fixed
--    asset account. The partner is the same company's mapped account;
--    a missing partner mapping leaves contra_of NULL (flag still set),
--    and an aberrant self-mapping sets neither (no self-contra).
UPDATE "accounts" AS a SET "is_contra" = true, "contra_of" = r."account_id" FROM "account_mappings" AS m LEFT JOIN "account_mappings" AS r ON r."company_id" = m."company_id" AND r."key" = 'revenue' WHERE m."account_id" = a."id" AND m."company_id" = a."company_id" AND m."key" IN ('sales_discount', 'sales_return') AND (r."account_id" IS NULL OR r."account_id" <> a."id");--> statement-breakpoint
UPDATE "accounts" AS a SET "is_contra" = true, "contra_of" = r."account_id" FROM "account_mappings" AS m LEFT JOIN "account_mappings" AS r ON r."company_id" = m."company_id" AND r."key" = 'fixed_asset' WHERE m."account_id" = a."id" AND m."company_id" = a."company_id" AND m."key" = 'accumulated_depreciation' AND (r."account_id" IS NULL OR r."account_id" <> a."id");