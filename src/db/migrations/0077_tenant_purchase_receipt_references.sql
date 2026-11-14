-- Inventory receipts and purchase orders must not reference another
-- company's warehouse, supplier, order, or payment account. Keep the old
-- ID-only constraints until the replacement constraints are installed.
CREATE UNIQUE INDEX "warehouses_company_id_id_uq"
  ON "warehouses" USING btree ("company_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_company_id_id_uq"
  ON "accounts" USING btree ("company_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_company_id_id_uq"
  ON "purchase_orders" USING btree ("company_id", "id");
--> statement-breakpoint
-- NOT VALID skips scanning legacy rows during rollout, while PostgreSQL
-- still enforces the tenant pair on new inserts and updates.
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_supplier_fk"
  FOREIGN KEY ("company_id", "supplier_id")
  REFERENCES "public"."suppliers" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_company_warehouse_fk"
  FOREIGN KEY ("company_id", "warehouse_id")
  REFERENCES "public"."warehouses" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_company_purchase_order_fk"
  FOREIGN KEY ("company_id", "purchase_order_id")
  REFERENCES "public"."purchase_orders" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_company_supplier_fk"
  FOREIGN KEY ("company_id", "supplier_id")
  REFERENCES "public"."suppliers" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_company_payment_account_fk"
  FOREIGN KEY ("company_id", "payment_account_id")
  REFERENCES "public"."accounts" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_receipts" DROP CONSTRAINT "stock_receipts_warehouse_id_warehouses_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_receipts" DROP CONSTRAINT "stock_receipts_purchase_order_id_purchase_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_receipts" DROP CONSTRAINT "stock_receipts_supplier_id_suppliers_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_receipts" DROP CONSTRAINT "stock_receipts_payment_account_id_accounts_id_fk";
