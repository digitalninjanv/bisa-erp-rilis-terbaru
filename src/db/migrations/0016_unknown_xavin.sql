CREATE TABLE "party_opening_balances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"party_type" text NOT NULL,
	"party_id" uuid NOT NULL,
	"date" date NOT NULL,
	"due_date" date,
	"amount" numeric(19, 4) NOT NULL,
	"paid_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"journal_id" uuid,
	"reference" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "party_payments" ADD COLUMN "opening_id" uuid;--> statement-breakpoint
ALTER TABLE "party_opening_balances" ADD CONSTRAINT "party_opening_balances_journal_id_journal_entries_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "party_opening_balances_company_number_uq" ON "party_opening_balances" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "party_opening_balances_company_kind_idx" ON "party_opening_balances" USING btree ("company_id","kind","status");--> statement-breakpoint
ALTER TABLE "party_payments" ADD CONSTRAINT "party_payments_opening_id_party_opening_balances_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."party_opening_balances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_opening_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "party_opening_balances" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "party_opening_balances";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "party_opening_balances"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "party_opening_balances" TO app_user;