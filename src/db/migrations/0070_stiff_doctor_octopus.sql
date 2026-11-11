DROP INDEX IF EXISTS "idempotency_keys_company_key_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_company_scope_key_uq" ON "idempotency_keys" USING btree ("company_id","scope","key");
