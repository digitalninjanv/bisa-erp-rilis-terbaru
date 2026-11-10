ALTER TABLE "stock_document_lines" ADD COLUMN "packaging_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD COLUMN "qty_input" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD COLUMN "isi_snapshot" numeric(19, 4) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD COLUMN "count_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD CONSTRAINT "stock_document_lines_packaging_id_product_packagings_id_fk" FOREIGN KEY ("packaging_id") REFERENCES "public"."product_packagings"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Program Satuan Kemasan S3 manual additions, same file by design
-- (pattern of 0063): baris lama adalah baris satuan dasar — qty_input
-- mereka adalah qty dasarnya sendiri dan isi_snapshot 1 (bawaan kolom).
-- Backfill dulu, baru qty_input dikunci NOT NULL sesuai skema.
UPDATE "stock_document_lines" SET "qty_input" = "qty" WHERE "qty_input" IS NULL;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ALTER COLUMN "qty_input" SET NOT NULL;
