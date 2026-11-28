ALTER TABLE "bank_statement_imports" ADD COLUMN "statement_ending_balance" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD COLUMN "statement_end_date" date;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD COLUMN "reconciled_by" text;