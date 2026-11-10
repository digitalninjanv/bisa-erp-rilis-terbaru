-- ------------------------------------------------------------------
-- Tenant isolation, append-only guards, and grants
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_company_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.company_id', true), '')
$$;

-- Enable RLS on every business table (anything carrying company_id).
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'company_id'
      AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())',
      t
    );
  END LOOP;
END $$;

-- Read-only platform helper for health checks.
CREATE OR REPLACE FUNCTION app_ping() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT true $$;

-- ------------------------------------------------------------------
-- Ledger guards
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION assert_journal_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  total_debit numeric(19,4);
  total_credit numeric(19,4);
BEGIN
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO total_debit, total_credit
    FROM journal_lines
   WHERE entry_id = NEW.id;

  IF total_debit <> total_credit THEN
    RAISE EXCEPTION 'Jurnal % tidak seimbang: debit %, kredit %', NEW.id, total_debit, total_credit
      USING ERRCODE = '23514';
  END IF;

  IF total_debit = 0 THEN
    RAISE EXCEPTION 'Jurnal % tidak memiliki nilai', NEW.id USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS journal_entries_balanced ON journal_entries;
CREATE CONSTRAINT TRIGGER journal_entries_balanced
  AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced();

CREATE OR REPLACE FUNCTION forbid_posted_journal_entry_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'Jurnal yang sudah posted tidak boleh diubah atau dihapus'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS journal_entries_immutable ON journal_entries;
CREATE TRIGGER journal_entries_immutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_posted_journal_entry_mutation();

CREATE OR REPLACE FUNCTION forbid_posted_journal_line_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM journal_entries
     WHERE id = OLD.entry_id AND status = 'posted'
  ) THEN
    RAISE EXCEPTION 'Baris jurnal posted tidak boleh diubah atau dihapus'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS journal_lines_immutable ON journal_lines;
CREATE TRIGGER journal_lines_immutable
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_posted_journal_line_mutation();

-- ------------------------------------------------------------------
-- Append-only operational history
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabel % bersifat append-only', TG_TABLE_NAME USING ERRCODE = '23514';
END $$;

DROP TRIGGER IF EXISTS stock_movements_append_only ON stock_movements;
CREATE TRIGGER stock_movements_append_only
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ------------------------------------------------------------------
-- Grants for the application role
-- ------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

ALTER DEFAULT PRIVILEGES FOR ROLE erp IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE erp IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
