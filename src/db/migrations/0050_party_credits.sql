CREATE TABLE "party_credits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"party_type" text NOT NULL,
	"party_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"used_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"origin_payment_id" uuid,
	"origin_label" text,
	"journal_id" uuid,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "party_payments" ADD COLUMN "credit_id" uuid;--> statement-breakpoint
ALTER TABLE "party_credits" ADD CONSTRAINT "party_credits_journal_id_journal_entries_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "party_credits_company_number_uq" ON "party_credits" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "party_credits_company_party_status_idx" ON "party_credits" USING btree ("company_id","party_type","party_id","status");--> statement-breakpoint
ALTER TABLE "party_payments" ADD CONSTRAINT "party_payments_credit_id_party_credits_id_fk" FOREIGN KEY ("credit_id") REFERENCES "public"."party_credits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A-21 (R3-02) manual additions, same file by design (pattern of
-- 0027/0033/0038/0046): tenant RLS + grant for the new table.
ALTER TABLE "party_credits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "party_credits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "party_credits"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "party_credits" TO app_user;
