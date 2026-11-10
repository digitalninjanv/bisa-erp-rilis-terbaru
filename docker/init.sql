-- Runs once on a fresh Postgres volume.
-- ⚠️ KEAMANAN (SIM-2 S6 / SEC-03): sandi 'appdev' untuk peran app_user
-- di bawah adalah kredensial DEV yang terpublikasi di repo. Wajib
-- diganti sebelum pemakaian produksi (ALTER ROLE app_user PASSWORD
-- '...') dan diselaraskan dengan DATABASE_URL aplikasi.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'appdev' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

ALTER DEFAULT PRIVILEGES FOR ROLE erp IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE erp IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
