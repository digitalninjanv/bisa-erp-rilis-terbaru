ALTER TABLE "import_jobs" ADD COLUMN "file_hash" text;--> statement-breakpoint
ALTER TABLE "stock_documents" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_documents_company_idem_uq" ON "stock_documents" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_receipts_company_idem_uq" ON "stock_receipts" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_returns_company_idem_uq" ON "supplier_returns" USING btree ("company_id","idempotency_key");