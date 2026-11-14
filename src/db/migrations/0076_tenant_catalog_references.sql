-- IDs tetap ber-primary-key global. Key komposit ini menjadi target FK
-- agar perusahaan parent-child juga wajib sama.
CREATE UNIQUE INDEX "categories_company_id_id_uq" ON "categories" USING btree ("company_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_company_id_id_uq" ON "suppliers" USING btree ("company_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "units_company_id_id_uq" ON "units" USING btree ("company_id", "id");
--> statement-breakpoint
-- NOT VALID melewati scan data lama pada deploy ini, tetapi constraint
-- tetap menolak referensi silang pada INSERT/UPDATE baru. Validasi data
-- historis dipisahkan setelah audit/backfill pada database staging.
ALTER TABLE "products" ADD CONSTRAINT "products_company_category_fk"
  FOREIGN KEY ("company_id", "category_id") REFERENCES "public"."categories"("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_unit_fk"
  FOREIGN KEY ("company_id", "unit_id") REFERENCES "public"."units"("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_supplier_fk"
  FOREIGN KEY ("company_id", "supplier_id") REFERENCES "public"."suppliers"("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_category_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_unit_id_units_id_fk";
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_supplier_id_suppliers_id_fk";
