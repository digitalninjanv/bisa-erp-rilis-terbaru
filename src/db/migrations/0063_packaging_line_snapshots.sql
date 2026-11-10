ALTER TABLE "purchase_order_lines" ADD COLUMN "packaging_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "qty_input" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "isi_snapshot" numeric(19, 4) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD COLUMN "packaging_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD COLUMN "qty_input" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD COLUMN "isi_snapshot" numeric(19, 4) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD COLUMN "packaging_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD COLUMN "qty_input" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD COLUMN "isi_snapshot" numeric(19, 4) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_packaging_id_product_packagings_id_fk" FOREIGN KEY ("packaging_id") REFERENCES "public"."product_packagings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD CONSTRAINT "stock_receipt_lines_packaging_id_product_packagings_id_fk" FOREIGN KEY ("packaging_id") REFERENCES "public"."product_packagings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_packaging_id_product_packagings_id_fk" FOREIGN KEY ("packaging_id") REFERENCES "public"."product_packagings"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Program Satuan Kemasan S2 manual additions, same file by design
-- (pattern of 0062): baris lama adalah baris satuan dasar — qty_input
-- mereka adalah qty dasarnya sendiri dan isi_snapshot 1 (bawaan kolom).
-- Backfill dulu, baru qty_input dikunci NOT NULL sesuai skema.
UPDATE "purchase_order_lines" SET "qty_input" = "qty" WHERE "qty_input" IS NULL;--> statement-breakpoint
UPDATE "stock_receipt_lines" SET "qty_input" = "qty" WHERE "qty_input" IS NULL;--> statement-breakpoint
UPDATE "supplier_return_lines" SET "qty_input" = "qty" WHERE "qty_input" IS NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ALTER COLUMN "qty_input" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ALTER COLUMN "qty_input" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ALTER COLUMN "qty_input" SET NOT NULL;
