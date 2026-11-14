-- Health readiness compares the applied Drizzle journal with the
-- migration bundled by the running application. Keep runtime access
-- read-only and limited to the journal table.
GRANT USAGE ON SCHEMA drizzle TO app_user;--> statement-breakpoint
GRANT SELECT ON TABLE drizzle.__drizzle_migrations TO app_user;
