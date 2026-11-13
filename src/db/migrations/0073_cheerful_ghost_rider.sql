ALTER TABLE "sale_returns" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD COLUMN "disposition" text DEFAULT 'sellable' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sale_returns_company_idem_uq" ON "sale_returns" USING btree ("company_id","idempotency_key");--> statement-breakpoint
ALTER TABLE sale_returns ADD CONSTRAINT sale_returns_disposition_check
  CHECK (disposition IN ('sellable', 'write_off'));
--> statement-breakpoint
ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_amounts_check
  CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0)) NOT VALID;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_journal_line_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE entry_company text; entry_xmin xid; account_company text;
BEGIN
  SELECT company_id, xmin INTO entry_company, entry_xmin
    FROM journal_entries WHERE id = NEW.entry_id;
  IF entry_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Perusahaan baris jurnal tidak sesuai jurnal asal' USING ERRCODE = '23514';
  END IF;
  IF pg_xact_status(entry_xmin::text::xid8) IS DISTINCT FROM 'in progress' THEN
    RAISE EXCEPTION 'Baris tidak dapat ditambahkan ke jurnal yang sudah selesai diposting' USING ERRCODE = '23514';
  END IF;
  SELECT company_id INTO account_company FROM accounts WHERE id = NEW.account_id;
  IF account_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Akun jurnal tidak berada pada perusahaan yang sama' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER journal_lines_insert_guard BEFORE INSERT ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION guard_journal_line_insert();
--> statement-breakpoint
-- Rebuild only the derived summary. Posted source journals stay immutable.
INSERT INTO account_monthly_balances(company_id, account_id, year_month, total_debit, total_credit)
SELECT jl.company_id, jl.account_id, to_char(je.date, 'YYYY-MM'), sum(jl.debit), sum(jl.credit)
FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
WHERE je.status = 'posted'
GROUP BY jl.company_id, jl.account_id, to_char(je.date, 'YYYY-MM')
ON CONFLICT (company_id, account_id, year_month) DO UPDATE
SET total_debit = excluded.total_debit, total_credit = excluded.total_credit, updated_at = now();
