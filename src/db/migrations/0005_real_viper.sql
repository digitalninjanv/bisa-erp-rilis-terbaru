ALTER TABLE "accounts" ADD COLUMN "section" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "cash_flow_group" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "description" text;--> statement-breakpoint
UPDATE "accounts" SET "section" = CASE
  WHEN "type" = 'asset' AND "code" < '1500' THEN 'current_asset'
  WHEN "type" = 'asset' THEN 'non_current_asset'
  WHEN "type" = 'liability' AND "code" < '2500' THEN 'current_liability'
  WHEN "type" = 'liability' THEN 'non_current_liability'
  WHEN "type" = 'equity' THEN 'equity'
  WHEN "type" = 'revenue' AND "code" IN ('4030', '9000') THEN 'other_income'
  WHEN "type" = 'revenue' THEN 'revenue'
  WHEN "type" = 'cogs' THEN 'cogs'
  WHEN "type" = 'expense' AND "code" IN ('8000', '8001', '9001') THEN 'other_expense'
  WHEN "type" = 'expense' THEN 'operating_expense'
  ELSE NULL
END;--> statement-breakpoint
UPDATE "accounts" SET "cash_flow_group" = CASE
  WHEN "type" = 'revenue' OR "type" = 'cogs' OR "type" = 'expense' THEN 'operating'
  WHEN "type" = 'asset' AND "code" >= '1500' THEN 'investing'
  WHEN "type" = 'equity' THEN 'financing'
  WHEN "type" = 'liability' AND "code" >= '2500' THEN 'financing'
  WHEN "type" = 'liability' THEN 'operating'
  ELSE NULL
END;
