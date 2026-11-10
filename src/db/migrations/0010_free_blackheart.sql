CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(19, 4) NOT NULL,
	"unit_cost" numeric(19, 4) NOT NULL,
	"received_qty" numeric(19, 4) DEFAULT '0' NOT NULL,
	"line_total" numeric(19, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"date" date NOT NULL,
	"expected_date" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"total" numeric(19, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_by" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD COLUMN "purchase_order_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_lines_order_idx" ON "purchase_order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_company_number_uq" ON "purchase_orders" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "purchase_orders_company_supplier_idx" ON "purchase_orders" USING btree ("company_id","supplier_id","status");--> statement-breakpoint
CREATE INDEX "purchase_orders_company_date_idx" ON "purchase_orders" USING btree ("company_id","date");--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "purchase_orders";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "purchase_orders"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_orders" TO app_user;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "purchase_order_lines";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "purchase_order_lines"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_order_lines" TO app_user;