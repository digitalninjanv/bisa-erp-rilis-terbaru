ALTER TABLE "stock_receipts" ADD COLUMN "price_variance_reason" text;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD COLUMN "invoice_credit_amount" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD COLUMN "price_variance_amount" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE INDEX "supplier_return_lines_company_receipt_line_idx" ON "supplier_return_lines" USING btree ("company_id","receipt_line_id");