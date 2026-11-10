ALTER TABLE "expenses" ALTER COLUMN "payment_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "paid_amount" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "payment_status" text DEFAULT 'paid' NOT NULL;--> statement-breakpoint
ALTER TABLE "party_payments" ADD COLUMN "expense_id" uuid;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD COLUMN "tax_rate" numeric(7, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_payments" ADD CONSTRAINT "party_payments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_company_supplier_idx" ON "expenses" USING btree ("company_id","supplier_id","payment_status");