ALTER TABLE "stock_receipts" ALTER COLUMN "supplier_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD COLUMN "source" text DEFAULT 'purchase' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD COLUMN "payment_account_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD COLUMN "supplier_invoice_number" text;