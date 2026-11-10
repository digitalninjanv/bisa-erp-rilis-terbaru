-- D-15 (pengecualian tercatat aturan "migrasi tidak diedit"): indeks trigram
-- di berkas ini membutuhkan ekstensi pg_trgm yang tidak pernah dibuat
-- migrasi mana pun — instalasi baru selalu gagal di pernyataan ke-99.
-- Pernyataan di bawah idempoten dan tidak mengubah skema pada instalasi
-- yang sudah berjalan (ekstensi sudah ada di sana).
CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_mappings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"key" text NOT NULL,
	"account_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"normal_balance" text NOT NULL,
	"parent_id" uuid,
	"is_postable" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transfers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"from_account_id" uuid NOT NULL,
	"to_account_id" uuid NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"fee" numeric(19, 4) DEFAULT '0' NOT NULL,
	"net_amount" numeric(19, 4) NOT NULL,
	"reference" text,
	"description" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"branch_id" uuid,
	"user_id" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"opening_cash" numeric(19, 4) DEFAULT '0' NOT NULL,
	"expected_cash" numeric(19, 4),
	"counted_cash" numeric(19, 4),
	"difference" numeric(19, 4),
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"company_id" text PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"tax_id" text,
	"address" text,
	"phone" text,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"timezone" text DEFAULT 'Asia/Jakarta' NOT NULL,
	"locale" text DEFAULT 'id-ID' NOT NULL,
	"default_warehouse_id" uuid,
	"rounding_mode" text DEFAULT 'none' NOT NULL,
	"receipt_header" text DEFAULT '' NOT NULL,
	"receipt_footer" text DEFAULT 'Terima kasih telah berbelanja' NOT NULL,
	"receipt_width_mm" integer DEFAULT 58 NOT NULL,
	"receipt_show_logo" boolean DEFAULT true NOT NULL,
	"receipt_show_cashier" boolean DEFAULT true NOT NULL,
	"receipt_show_tax" boolean DEFAULT true NOT NULL,
	"qris_image" text,
	"allow_negative_stock" boolean DEFAULT false NOT NULL,
	"tax_rate" numeric(7, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"discount_type" text DEFAULT 'percent' NOT NULL,
	"discount_value" numeric(19, 4) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"address" text,
	"group_id" uuid,
	"credit_limit" numeric(19, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"company_id" text NOT NULL,
	"doc_type" text NOT NULL,
	"fiscal_year" integer NOT NULL,
	"prefix" text NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "document_sequences_company_id_doc_type_fiscal_year_pk" PRIMARY KEY("company_id","doc_type","fiscal_year")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"position" text,
	"base_salary" numeric(19, 4) DEFAULT '0' NOT NULL,
	"allowances" numeric(19, 4) DEFAULT '0' NOT NULL,
	"deductions" numeric(19, 4) DEFAULT '0' NOT NULL,
	"joined_at" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"expense_account_id" uuid NOT NULL,
	"payment_account_id" uuid NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_periods" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"key" text NOT NULL,
	"scope" text NOT NULL,
	"result_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"entity" text NOT NULL,
	"file_name" text NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"success_rows" integer DEFAULT 0 NOT NULL,
	"failed_rows" integer DEFAULT 0 NOT NULL,
	"mapping" jsonb,
	"summary" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"job_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"data" jsonb,
	"status" text NOT NULL,
	"error" text,
	"entity_id" uuid
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" uuid,
	"status" text DEFAULT 'posted' NOT NULL,
	"reversal_of_id" uuid,
	"idempotency_key" text,
	"created_by" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(19, 4) DEFAULT '0' NOT NULL,
	"credit" numeric(19, 4) DEFAULT '0' NOT NULL,
	"description" text,
	"party_type" text,
	"party_id" uuid,
	"line_no" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"type" text NOT NULL,
	"party_type" text NOT NULL,
	"party_id" uuid NOT NULL,
	"sale_id" uuid,
	"receipt_id" uuid,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"account_id" uuid NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'cash' NOT NULL,
	"account_id" uuid,
	"instructions" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"base_salary" numeric(19, 4) NOT NULL,
	"allowances" numeric(19, 4) NOT NULL,
	"deductions" numeric(19, 4) NOT NULL,
	"net" numeric(19, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"total_gross" numeric(19, 4) NOT NULL,
	"total_deductions" numeric(19, 4) NOT NULL,
	"total_net" numeric(19, 4) NOT NULL,
	"created_by" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"name" text NOT NULL,
	"category_id" uuid,
	"unit_id" uuid,
	"supplier_id" uuid,
	"cost_price" numeric(19, 4) DEFAULT '0' NOT NULL,
	"sale_price" numeric(19, 4) DEFAULT '0' NOT NULL,
	"min_stock" numeric(19, 4) DEFAULT '0' NOT NULL,
	"track_stock" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"image_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"sale_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"line_no" integer DEFAULT 0 NOT NULL,
	"qty" numeric(19, 4) NOT NULL,
	"unit_price" numeric(19, 4) NOT NULL,
	"discount_type" text,
	"discount_value" numeric(19, 4) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"line_total" numeric(19, 4) NOT NULL,
	"unit_cost" numeric(19, 4) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(7, 4) DEFAULT '0' NOT NULL,
	"product_name" text NOT NULL,
	"product_sku" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"sale_id" uuid NOT NULL,
	"method_id" uuid NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"tendered" numeric(19, 4) DEFAULT '0' NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_return_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"return_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(19, 4) NOT NULL,
	"unit_price" numeric(19, 4) NOT NULL,
	"unit_cost" numeric(19, 4) DEFAULT '0' NOT NULL,
	"line_total" numeric(19, 4) NOT NULL,
	"product_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_returns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"sale_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"type" text DEFAULT 'return' NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"refund_method" text DEFAULT 'cash' NOT NULL,
	"total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"cost_total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"reason" text NOT NULL,
	"created_by" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"branch_id" uuid,
	"warehouse_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"cashier_id" text NOT NULL,
	"session_id" uuid,
	"customer_id" uuid,
	"customer_group_id" uuid,
	"status" text DEFAULT 'completed' NOT NULL,
	"subtotal" numeric(19, 4) DEFAULT '0' NOT NULL,
	"discount_total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"tax_total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"rounding_adjustment" numeric(19, 4) DEFAULT '0' NOT NULL,
	"total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"cost_total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"paid_total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"change_total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"payment_status" text DEFAULT 'paid' NOT NULL,
	"held_label" text,
	"notes" text,
	"idempotency_key" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "stock_document_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(19, 4) NOT NULL,
	"system_qty" numeric(19, 4),
	"unit_cost" numeric(19, 4) DEFAULT '0' NOT NULL,
	"line_total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "stock_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"type" text NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"warehouse_id" uuid,
	"to_warehouse_id" uuid,
	"supplier_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"reason" text,
	"refund_method" text,
	"total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_by" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"movement_type" text NOT NULL,
	"qty" numeric(19, 4) NOT NULL,
	"unit_cost" numeric(19, 4) DEFAULT '0' NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"reference_number" text,
	"reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_on_hand" (
	"company_id" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(19, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_on_hand_company_id_warehouse_id_product_id_pk" PRIMARY KEY("company_id","warehouse_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "stock_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"receipt_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(19, 4) NOT NULL,
	"unit_cost" numeric(19, 4) NOT NULL,
	"line_total" numeric(19, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"notes" text,
	"created_by" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"address" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"two_factor_enabled" boolean DEFAULT false,
	"role" text,
	"banned" boolean,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"branch_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'warehouse' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_return_id_sale_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sale_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD CONSTRAINT "stock_document_lines_document_id_stock_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."stock_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD CONSTRAINT "stock_receipt_lines_receipt_id_stock_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."stock_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_mappings_company_key_uq" ON "account_mappings" USING btree ("company_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_company_code_uq" ON "accounts" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "audit_log_company_created_idx" ON "audit_log" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_company_entity_idx" ON "audit_log" USING btree ("company_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transfers_company_number_uq" ON "bank_transfers" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_company_code_uq" ON "branches" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "cash_movements_session_idx" ON "cash_movements" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "cash_sessions_company_status_idx" ON "cash_sessions" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_company_name_uq" ON "categories" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_groups_company_name_uq" ON "customer_groups" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_company_code_uq" ON "customers" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "customers_company_name_idx" ON "customers" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_company_code_uq" ON "employees" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_company_number_uq" ON "expenses" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_periods_company_period_uq" ON "fiscal_periods" USING btree ("company_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_company_key_uq" ON "idempotency_keys" USING btree ("company_id","key");--> statement-breakpoint
CREATE INDEX "import_jobs_company_created_idx" ON "import_jobs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "import_rows_job_idx" ON "import_rows" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "invitation_org_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_company_number_uq" ON "journal_entries" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_company_idem_uq" ON "journal_entries" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "journal_entries_company_date_idx" ON "journal_entries" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "journal_entries_company_source_idx" ON "journal_entries" USING btree ("company_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_company_account_idx" ON "journal_lines" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_org_user_uq" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "member_user_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("processed_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "party_payments_company_number_uq" ON "party_payments" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_company_code_uq" ON "payment_methods" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "payroll_items_run_idx" ON "payroll_items" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_company_number_uq" ON "payroll_runs" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "products_company_sku_uq" ON "products" USING btree ("company_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "products_company_barcode_uq" ON "products" USING btree ("company_id","barcode");--> statement-breakpoint
CREATE INDEX "products_company_name_trgm_idx" ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "products_company_active_idx" ON "products" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE INDEX "sale_lines_sale_idx" ON "sale_lines" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_payments_sale_idx" ON "sale_payments" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_return_lines_return_idx" ON "sale_return_lines" USING btree ("return_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_returns_company_number_uq" ON "sale_returns" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "sale_returns_company_date_idx" ON "sale_returns" USING btree ("company_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_company_number_uq" ON "sales" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_company_idem_uq" ON "sales" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "sales_company_date_idx" ON "sales" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "sales_company_status_idx" ON "sales" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "sales_company_customer_idx" ON "sales" USING btree ("company_id","customer_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stock_document_lines_doc_idx" ON "stock_document_lines" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_documents_company_number_uq" ON "stock_documents" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "stock_documents_company_type_date_idx" ON "stock_documents" USING btree ("company_id","type","date");--> statement-breakpoint
CREATE INDEX "stock_movements_company_product_idx" ON "stock_movements" USING btree ("company_id","product_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_company_warehouse_idx" ON "stock_movements" USING btree ("company_id","warehouse_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_company_ref_idx" ON "stock_movements" USING btree ("company_id","reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "stock_on_hand_company_product_idx" ON "stock_on_hand" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_receipt_lines_receipt_idx" ON "stock_receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_receipts_company_number_uq" ON "stock_receipts" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "stock_receipts_company_date_idx" ON "stock_receipts" USING btree ("company_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_company_code_uq" ON "suppliers" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "suppliers_company_name_idx" ON "suppliers" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "two_factor_user_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_company_code_uq" ON "units" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_company_code_uq" ON "warehouses" USING btree ("company_id","code");