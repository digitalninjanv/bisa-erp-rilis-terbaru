CREATE TABLE "bank_statement_imports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"imported_by" text,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"inserted_rows" integer DEFAULT 0 NOT NULL,
	"skipped_rows" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"import_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"debit" numeric(19, 4) DEFAULT '0' NOT NULL,
	"credit" numeric(19, 4) DEFAULT '0' NOT NULL,
	"fingerprint" text NOT NULL,
	"matched_journal_line_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_import_id_bank_statement_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."bank_statement_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_matched_journal_line_id_journal_lines_id_fk" FOREIGN KEY ("matched_journal_line_id") REFERENCES "public"."journal_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_statement_imports_company_account_idx" ON "bank_statement_imports" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_statement_lines_company_fingerprint_uq" ON "bank_statement_lines" USING btree ("company_id","fingerprint");--> statement-breakpoint
CREATE INDEX "bank_statement_lines_company_account_idx" ON "bank_statement_lines" USING btree ("company_id","account_id","date");--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "bank_statement_imports";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bank_statement_imports"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "bank_statement_imports" TO app_user;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "bank_statement_lines";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bank_statement_lines"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "bank_statement_lines" TO app_user;