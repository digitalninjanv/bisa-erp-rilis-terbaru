ALTER TABLE "party_payments" ADD COLUMN "fee_amount" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "fee_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "fee_type" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "fee_value" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD COLUMN "fee_amount" numeric(19, 4) DEFAULT '0' NOT NULL;