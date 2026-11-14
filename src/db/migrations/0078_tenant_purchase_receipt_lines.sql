-- Keep purchasing and receipt lines bound to their owning company's
-- document, product, and packaging. Preserve ID-only FKs until replacements
-- are installed so a failed migration cannot leave the tables unguarded.
CREATE UNIQUE INDEX "products_company_id_id_uq"
  ON "products" USING btree ("company_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_packagings_company_id_id_uq"
  ON "product_packagings" USING btree ("company_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_receipts_company_id_id_uq"
  ON "stock_receipts" USING btree ("company_id", "id");
--> statement-breakpoint
-- NOT VALID skips scanning legacy rows while enforcing new writes.
ALTER TABLE "product_packagings" ADD CONSTRAINT "product_packagings_company_product_fk"
  FOREIGN KEY ("company_id", "product_id")
  REFERENCES "public"."products" ("company_id", "id")
  ON DELETE cascade ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_company_order_fk"
  FOREIGN KEY ("company_id", "order_id")
  REFERENCES "public"."purchase_orders" ("company_id", "id")
  ON DELETE cascade ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_company_product_fk"
  FOREIGN KEY ("company_id", "product_id")
  REFERENCES "public"."products" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_company_packaging_fk"
  FOREIGN KEY ("company_id", "packaging_id")
  REFERENCES "public"."product_packagings" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD CONSTRAINT "stock_receipt_lines_company_receipt_fk"
  FOREIGN KEY ("company_id", "receipt_id")
  REFERENCES "public"."stock_receipts" ("company_id", "id")
  ON DELETE cascade ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD CONSTRAINT "stock_receipt_lines_company_product_fk"
  FOREIGN KEY ("company_id", "product_id")
  REFERENCES "public"."products" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD CONSTRAINT "stock_receipt_lines_company_packaging_fk"
  FOREIGN KEY ("company_id", "packaging_id")
  REFERENCES "public"."product_packagings" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "product_packagings" DROP CONSTRAINT "product_packagings_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" DROP CONSTRAINT "purchase_order_lines_order_id_purchase_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" DROP CONSTRAINT "purchase_order_lines_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" DROP CONSTRAINT "purchase_order_lines_packaging_id_product_packagings_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" DROP CONSTRAINT "stock_receipt_lines_receipt_id_stock_receipts_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" DROP CONSTRAINT "stock_receipt_lines_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" DROP CONSTRAINT "stock_receipt_lines_packaging_id_product_packagings_id_fk";
