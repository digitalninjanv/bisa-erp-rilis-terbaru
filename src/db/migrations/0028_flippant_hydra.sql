ALTER TABLE "customers" ADD COLUMN "tax_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "payment_term_days" integer;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "tax_id" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "bank_account_number" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "bank_account_name" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "payment_term_days" integer;