-- Stock balances/movements and journal lines are tenant-bound at the
-- database boundary. Install the new keys and constraints before removing
-- the old ID-only FKs; legacy rows are intentionally not scanned here.
CREATE UNIQUE INDEX "journal_entries_company_id_id_uq"
  ON "journal_entries" USING btree ("company_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_batches_company_id_id_uq"
  ON "stock_batches" USING btree ("company_id", "id");
--> statement-breakpoint
ALTER TABLE "account_monthly_balances" ADD CONSTRAINT "account_monthly_balances_company_account_fk"
  FOREIGN KEY ("company_id", "account_id")
  REFERENCES "public"."accounts" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_company_entry_fk"
  FOREIGN KEY ("company_id", "entry_id")
  REFERENCES "public"."journal_entries" ("company_id", "id")
  ON DELETE cascade ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_company_account_fk"
  FOREIGN KEY ("company_id", "account_id")
  REFERENCES "public"."accounts" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_company_product_fk"
  FOREIGN KEY ("company_id", "product_id")
  REFERENCES "public"."products" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_company_warehouse_fk"
  FOREIGN KEY ("company_id", "warehouse_id")
  REFERENCES "public"."warehouses" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_warehouse_fk"
  FOREIGN KEY ("company_id", "warehouse_id")
  REFERENCES "public"."warehouses" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_product_fk"
  FOREIGN KEY ("company_id", "product_id")
  REFERENCES "public"."products" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_batch_fk"
  FOREIGN KEY ("company_id", "batch_id")
  REFERENCES "public"."stock_batches" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "stock_on_hand" ADD CONSTRAINT "stock_on_hand_company_warehouse_fk"
  FOREIGN KEY ("company_id", "warehouse_id")
  REFERENCES "public"."warehouses" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "stock_on_hand" ADD CONSTRAINT "stock_on_hand_company_product_fk"
  FOREIGN KEY ("company_id", "product_id")
  REFERENCES "public"."products" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "account_monthly_balances" DROP CONSTRAINT "account_monthly_balances_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "journal_lines" DROP CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk";
--> statement-breakpoint
ALTER TABLE "journal_lines" DROP CONSTRAINT "journal_lines_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_batches" DROP CONSTRAINT "stock_batches_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_batches" DROP CONSTRAINT "stock_batches_warehouse_id_warehouses_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_warehouse_id_warehouses_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_batch_id_stock_batches_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_on_hand" DROP CONSTRAINT "stock_on_hand_warehouse_id_warehouses_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_on_hand" DROP CONSTRAINT "stock_on_hand_product_id_products_id_fk";
