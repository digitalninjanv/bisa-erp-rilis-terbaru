ALTER TABLE "company_settings" ADD COLUMN "withholding_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "party_payments" ADD COLUMN "withholding_type" text;--> statement-breakpoint
ALTER TABLE "party_payments" ADD COLUMN "withholding_rate" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "party_payments" ADD COLUMN "withholding_amount" numeric(19, 4) DEFAULT '0' NOT NULL;