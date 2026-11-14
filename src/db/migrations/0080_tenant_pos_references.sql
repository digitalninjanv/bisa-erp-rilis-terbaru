-- Constrain POS documents and their detail rows to a single company.
-- Install parent keys and NOT VALID constraints before replacing legacy
-- ID-only foreign keys; existing history is validated in a separate audit.
CREATE UNIQUE INDEX "sales_company_id_id_uq"
  ON "sales" USING btree ("company_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sale_lines_company_id_id_uq"
  ON "sale_lines" USING btree ("company_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sale_returns_company_id_id_uq"
  ON "sale_returns" USING btree ("company_id", "id");
--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_company_sale_fk"
  FOREIGN KEY ("company_id", "sale_id")
  REFERENCES "public"."sales" ("company_id", "id")
  ON DELETE cascade ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_company_product_fk"
  FOREIGN KEY ("company_id", "product_id")
  REFERENCES "public"."products" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_company_packaging_fk"
  FOREIGN KEY ("company_id", "packaging_id")
  REFERENCES "public"."product_packagings" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_company_sale_fk"
  FOREIGN KEY ("company_id", "sale_id")
  REFERENCES "public"."sales" ("company_id", "id")
  ON DELETE cascade ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_company_return_fk"
  FOREIGN KEY ("company_id", "return_id")
  REFERENCES "public"."sale_returns" ("company_id", "id")
  ON DELETE cascade ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_company_sale_line_fk"
  FOREIGN KEY ("company_id", "sale_line_id")
  REFERENCES "public"."sale_lines" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_company_product_fk"
  FOREIGN KEY ("company_id", "product_id")
  REFERENCES "public"."products" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_company_packaging_fk"
  FOREIGN KEY ("company_id", "packaging_id")
  REFERENCES "public"."product_packagings" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_company_sale_fk"
  FOREIGN KEY ("company_id", "sale_id")
  REFERENCES "public"."sales" ("company_id", "id")
  ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_sale_id_sales_id_fk";
--> statement-breakpoint
ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_packaging_id_product_packagings_id_fk";
--> statement-breakpoint
ALTER TABLE "sale_payments" DROP CONSTRAINT "sale_payments_sale_id_sales_id_fk";
--> statement-breakpoint
ALTER TABLE "sale_return_lines" DROP CONSTRAINT "sale_return_lines_return_id_sale_returns_id_fk";
--> statement-breakpoint
ALTER TABLE "sale_return_lines" DROP CONSTRAINT "sale_return_lines_sale_line_id_sale_lines_id_fk";
--> statement-breakpoint
ALTER TABLE "sale_return_lines" DROP CONSTRAINT "sale_return_lines_packaging_id_product_packagings_id_fk";
--> statement-breakpoint
CREATE INDEX "sale_lines_company_product_idx"
  ON "sale_lines" USING btree ("company_id", "product_id");
--> statement-breakpoint
CREATE INDEX "sale_return_lines_company_product_idx"
  ON "sale_return_lines" USING btree ("company_id", "product_id");
