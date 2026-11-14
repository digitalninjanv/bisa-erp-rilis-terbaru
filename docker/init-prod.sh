#!/bin/bash
# A-24 T5 — runs ONCE on a fresh production Postgres volume (compose db).
# Creates the RLS application role with the operator-generated password
# (APP_USER_PASSWORD from .env.prod) and the same grants + default
# privileges as docker/init.sql / migration 0001, so tables created by
# later migrations are reachable by app_user (runbook trap RT-03).
set -euo pipefail

: "${APP_USER_PASSWORD:?APP_USER_PASSWORD wajib ada (dari .env.prod)}"

psql -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER:-erp}" \
  --dbname "${POSTGRES_DB:-bisa}" \
  -v apppw="$APP_USER_PASSWORD" <<'EOSQL'
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE app_user WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'apppw';

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

ALTER DEFAULT PRIVILEGES FOR ROLE erp IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE erp IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
EOSQL

echo "init-prod: peran app_user siap."
