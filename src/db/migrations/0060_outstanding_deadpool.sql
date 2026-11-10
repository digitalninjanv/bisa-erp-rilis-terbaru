CREATE TABLE "pos_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"terminal_id" uuid NOT NULL,
	"code_digest" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_terminal_session_reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"terminal_id" uuid NOT NULL,
	"client_key" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"cashier_id" text,
	"local_session_id" text NOT NULL,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone NOT NULL,
	"opening_cash" numeric(19, 4) NOT NULL,
	"expected_cash" numeric(19, 4) NOT NULL,
	"counted_cash" numeric(19, 4) NOT NULL,
	"difference" numeric(19, 4) NOT NULL,
	"denominations" jsonb,
	"difference_reason" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_terminals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"warehouse_id" uuid,
	"name" text NOT NULL,
	"user_id" text NOT NULL,
	"token_digest" text,
	"status" text DEFAULT 'active' NOT NULL,
	"paired_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos_pairing_codes" ADD CONSTRAINT "pos_pairing_codes_terminal_id_pos_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."pos_terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_terminal_session_reviews" ADD CONSTRAINT "pos_terminal_session_reviews_terminal_id_pos_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."pos_terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_pairing_codes_terminal_idx" ON "pos_pairing_codes" USING btree ("terminal_id");--> statement-breakpoint
CREATE INDEX "pos_pairing_codes_digest_idx" ON "pos_pairing_codes" USING btree ("code_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_terminal_session_reviews_client_key_uq" ON "pos_terminal_session_reviews" USING btree ("company_id","terminal_id","client_key");--> statement-breakpoint
CREATE INDEX "pos_terminal_session_reviews_company_idx" ON "pos_terminal_session_reviews" USING btree ("company_id","received_at");--> statement-breakpoint
CREATE INDEX "pos_terminals_company_status_idx" ON "pos_terminals" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_terminals_token_digest_uq" ON "pos_terminals" USING btree ("token_digest");
--> statement-breakpoint
-- POS Native Langkah 6 manual additions, same file by design (pattern
-- of 0027/0033/0038/0046/0050/0054): tenant RLS + grants for the new
-- tables, PLUS two deliberately narrow pre-tenant lookup policies.
-- Device authentication resolves a bearer token / pairing code to a
-- company BEFORE any tenant context exists, so `withCompany` cannot
-- run first. The digest policies below let a transaction that sets
-- the transaction-local `app.device_digest` to the SHA-256 hex of the
-- presented secret SELECT exactly the one row whose stored digest
-- matches — nothing else. Presenting the digest requires knowing the
-- secret itself (tokens/codes are high-entropy random), and the
-- setting is transaction-local, set only inside the resolver in
-- src/server/pos/terminals.ts. All writes still go through the
-- tenant policy (the resolver sets app.company_id as soon as the
-- row's company is known, inside the same transaction).
ALTER TABLE "pos_terminals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos_terminals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pos_terminals"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
CREATE POLICY device_digest_lookup ON "pos_terminals"
  FOR SELECT
  USING (
    token_digest IS NOT NULL
    AND token_digest = nullif(current_setting('app.device_digest', true), '')
  );--> statement-breakpoint
ALTER TABLE "pos_pairing_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos_pairing_codes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pos_pairing_codes"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
CREATE POLICY pairing_digest_lookup ON "pos_pairing_codes"
  FOR SELECT
  USING (
    code_digest = nullif(current_setting('app.device_digest', true), '')
  );--> statement-breakpoint
ALTER TABLE "pos_terminal_session_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos_terminal_session_reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pos_terminal_session_reviews"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "pos_terminals" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "pos_pairing_codes" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "pos_terminal_session_reviews" TO app_user;