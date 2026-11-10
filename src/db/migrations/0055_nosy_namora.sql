ALTER TABLE "accounts" ADD COLUMN "cash_bank_kind" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "bank_account_number" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "bank_branch" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "bank_account_holder" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "currency" text DEFAULT 'IDR' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A-27 B1 backfill (deterministic): cash/bank class comes ONLY from the
-- existing account_mappings of the same company — never guessed from
-- account names or codes. cash -> 'cash', bank -> 'bank',
-- qris -> 'clearing'. If one account were (aberrantly) mapped by more
-- than one of these keys, the fixed order cash, bank, clearing decides:
-- the first UPDATE wins because later ones only touch rows still NULL.
UPDATE "accounts" AS a SET "cash_bank_kind" = 'cash' FROM "account_mappings" AS m WHERE m."account_id" = a."id" AND m."company_id" = a."company_id" AND m."key" = 'cash' AND a."cash_bank_kind" IS NULL;--> statement-breakpoint
UPDATE "accounts" AS a SET "cash_bank_kind" = 'bank' FROM "account_mappings" AS m WHERE m."account_id" = a."id" AND m."company_id" = a."company_id" AND m."key" = 'bank' AND a."cash_bank_kind" IS NULL;--> statement-breakpoint
UPDATE "accounts" AS a SET "cash_bank_kind" = 'clearing' FROM "account_mappings" AS m WHERE m."account_id" = a."id" AND m."company_id" = a."company_id" AND m."key" = 'qris' AND a."cash_bank_kind" IS NULL;