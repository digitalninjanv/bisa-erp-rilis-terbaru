CREATE TABLE "supplier_return_allocations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"return_id" uuid NOT NULL,
	"receipt_id" uuid,
	"opening_id" uuid,
	"amount" numeric(19, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_return_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"return_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(19, 4) NOT NULL,
	"unit_cost" numeric(19, 4) DEFAULT '0' NOT NULL,
	"line_total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"batch_id" uuid,
	"receipt_line_id" uuid,
	"replaced_qty" numeric(19, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_return_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"return_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"account_id" uuid,
	"return_line_id" uuid,
	"qty" numeric(19, 4),
	"note" text,
	"journal_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_returns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason_category" text NOT NULL,
	"reason_detail" text NOT NULL,
	"resolution_type" text NOT NULL,
	"resolution_note" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_value" numeric(19, 4) DEFAULT '0' NOT NULL,
	"payable_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"credit_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"resolved_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"closed_with_remainder" boolean DEFAULT false NOT NULL,
	"close_note" text,
	"created_by" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_return_allocations" ADD CONSTRAINT "supplier_return_allocations_return_id_supplier_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."supplier_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_allocations" ADD CONSTRAINT "supplier_return_allocations_opening_id_party_opening_balances_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."party_opening_balances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_return_id_supplier_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."supplier_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_receipt_line_id_stock_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."stock_receipt_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_resolutions" ADD CONSTRAINT "supplier_return_resolutions_return_id_supplier_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."supplier_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_resolutions" ADD CONSTRAINT "supplier_return_resolutions_return_line_id_supplier_return_lines_id_fk" FOREIGN KEY ("return_line_id") REFERENCES "public"."supplier_return_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_resolutions" ADD CONSTRAINT "supplier_return_resolutions_journal_id_journal_entries_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_return_allocations_return_idx" ON "supplier_return_allocations" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "supplier_return_allocations_receipt_idx" ON "supplier_return_allocations" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "supplier_return_allocations_opening_idx" ON "supplier_return_allocations" USING btree ("opening_id");--> statement-breakpoint
CREATE INDEX "supplier_return_lines_return_idx" ON "supplier_return_lines" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "supplier_return_resolutions_return_idx" ON "supplier_return_resolutions" USING btree ("return_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_returns_company_number_uq" ON "supplier_returns" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "supplier_returns_company_supplier_idx" ON "supplier_returns" USING btree ("company_id","supplier_id","status");--> statement-breakpoint
CREATE INDEX "supplier_returns_company_date_idx" ON "supplier_returns" USING btree ("company_id","date");--> statement-breakpoint
-- A-9 (D-20) manual additions, same file by design (pattern of 0016):
-- tenant RLS for the four new tables, mirroring party_opening_balances.
ALTER TABLE "supplier_returns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_returns" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "supplier_returns";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "supplier_returns"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier_returns" TO app_user;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "supplier_return_lines";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "supplier_return_lines"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier_return_lines" TO app_user;--> statement-breakpoint
ALTER TABLE "supplier_return_resolutions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_return_resolutions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "supplier_return_resolutions";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "supplier_return_resolutions"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier_return_resolutions" TO app_user;--> statement-breakpoint
ALTER TABLE "supplier_return_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_return_allocations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "supplier_return_allocations";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "supplier_return_allocations"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier_return_allocations" TO app_user;--> statement-breakpoint
-- A-9 (D-20): every EXISTING company gains the "Kredit Pemasok" asset
-- account (code 1210, right after Piutang Usaha 1200 in the seed COA)
-- and the `supplier_credit` account mapping pointing at it, so posting a
-- supplier return never has to guess an account. Companies that already
-- mapped the key are untouched; a company that already owns an asset
-- account named "Kredit Pemasok" is mapped to that account instead of
-- gaining a duplicate; if code 1210 is taken by an unrelated account the
-- new account falls back to code 1210-KP.
DO $$
DECLARE
  comp text;
  acct_id uuid;
BEGIN
  FOR comp IN SELECT company_id FROM company_settings LOOP
    IF EXISTS (
      SELECT 1 FROM account_mappings
      WHERE company_id = comp AND key = 'supplier_credit'
    ) THEN
      CONTINUE;
    END IF;
    SELECT id INTO acct_id FROM accounts
      WHERE company_id = comp AND name = 'Kredit Pemasok' AND type = 'asset'
      ORDER BY created_at
      LIMIT 1;
    IF acct_id IS NULL THEN
      INSERT INTO accounts (company_id, code, name, type, normal_balance)
      VALUES (
        comp,
        CASE WHEN EXISTS (
          SELECT 1 FROM accounts WHERE company_id = comp AND code = '1210'
        ) THEN '1210-KP' ELSE '1210' END,
        'Kredit Pemasok',
        'asset',
        'debit'
      )
      RETURNING id INTO acct_id;
    END IF;
    INSERT INTO account_mappings (company_id, key, account_id)
    VALUES (comp, 'supplier_credit', acct_id);
  END LOOP;
END $$;