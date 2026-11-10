ALTER TABLE "stock_receipt_lines" ADD COLUMN "discount_type" text;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD COLUMN "discount_value" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD COLUMN "discount_amount" numeric(19, 4) DEFAULT '0' NOT NULL;