ALTER TABLE "bank_transfers" ADD COLUMN "status" text DEFAULT 'posted' NOT NULL;--> statement-breakpoint
ALTER TABLE "party_payments" ADD COLUMN "status" text DEFAULT 'posted' NOT NULL;