CREATE TABLE "purchase_advance_allocations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"advance_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_advances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"remaining_amount" numeric(19, 4) NOT NULL,
	"payment_account_id" uuid NOT NULL,
	"tax_invoice_number" text,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"idempotency_key" text,
	"created_by" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_advance_allocations" ADD CONSTRAINT "purchase_advance_allocations_advance_id_purchase_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."purchase_advances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_advance_allocations" ADD CONSTRAINT "purchase_advance_allocations_receipt_id_stock_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."stock_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_advances" ADD CONSTRAINT "purchase_advances_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_advances" ADD CONSTRAINT "purchase_advances_payment_account_id_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_advance_allocations_advance_receipt_uq" ON "purchase_advance_allocations" USING btree ("company_id","advance_id","receipt_id");--> statement-breakpoint
CREATE INDEX "purchase_advance_allocations_receipt_idx" ON "purchase_advance_allocations" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_advances_company_number_uq" ON "purchase_advances" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_advances_company_idem_uq" ON "purchase_advances" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "purchase_advances_company_supplier_status_idx" ON "purchase_advances" USING btree ("company_id","supplier_id","status");--> statement-breakpoint
CREATE INDEX "purchase_advances_company_date_idx" ON "purchase_advances" USING btree ("company_id","date");--> statement-breakpoint
-- Uang muka pembelian: RLS tenant + grant untuk app_user.
ALTER TABLE "purchase_advances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_advances" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "purchase_advances"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_advances" TO app_user;--> statement-breakpoint
ALTER TABLE "purchase_advance_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_advance_allocations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "purchase_advance_allocations"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_advance_allocations" TO app_user;--> statement-breakpoint
-- Pemetaan baru untuk perusahaan yang sudah punya akun referensi 110302.
INSERT INTO "account_mappings" ("company_id", "key", "account_id")
SELECT a."company_id", 'purchase_advance', a."id"
FROM "accounts" a
WHERE a."code" = '110302'
  AND NOT EXISTS (
    SELECT 1 FROM "account_mappings" m
    WHERE m."company_id" = a."company_id" AND m."key" = 'purchase_advance'
  )
ON CONFLICT ("company_id", "key") DO NOTHING;
