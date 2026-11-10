ALTER TABLE "company_settings" ADD COLUMN "writeoff_max_amount" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "party_payments" ADD COLUMN "writeoff_reason" text;