ALTER TABLE "sale_lines" ADD COLUMN "packaging_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "qty_input" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "isi_snapshot" numeric(19, 4) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD COLUMN "sale_line_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD COLUMN "packaging_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD COLUMN "qty_input" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD COLUMN "isi_snapshot" numeric(19, 4) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_packaging_id_product_packagings_id_fk" FOREIGN KEY ("packaging_id") REFERENCES "public"."product_packagings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_sale_line_id_sale_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "public"."sale_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_packaging_id_product_packagings_id_fk" FOREIGN KEY ("packaging_id") REFERENCES "public"."product_packagings"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Program Satuan Kemasan S4 manual additions, same file by design
-- (pattern of 0063/0064): baris lama adalah baris satuan dasar —
-- qty_input mereka adalah qty dasarnya sendiri dan isi_snapshot 1
-- (bawaan kolom); sale_line_id baris retur lama tetap null (penjualan
-- pra-S4 satu baris per produk, jadi atribusi produk tetap tunggal).
-- Backfill dulu, baru qty_input dikunci NOT NULL sesuai skema.
UPDATE "sale_lines" SET "qty_input" = "qty" WHERE "qty_input" IS NULL;--> statement-breakpoint
UPDATE "sale_return_lines" SET "qty_input" = "qty" WHERE "qty_input" IS NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ALTER COLUMN "qty_input" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ALTER COLUMN "qty_input" SET NOT NULL;
