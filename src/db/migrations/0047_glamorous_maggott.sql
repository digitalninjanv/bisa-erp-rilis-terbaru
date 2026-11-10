ALTER TABLE "bank_transfers" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transfers_company_idem_uq" ON "bank_transfers" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_company_idem_uq" ON "expenses" USING btree ("company_id","idempotency_key");