ALTER TABLE "purchase_order_lines" ADD COLUMN "product_name" text;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "product_sku" text;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD COLUMN "product_name" text;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD COLUMN "product_sku" text;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD COLUMN "product_name" text;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD COLUMN "product_sku" text;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD COLUMN "product_name" text;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD COLUMN "product_sku" text;--> statement-breakpoint
-- SIM-2 S7 (REM-02) backfill: baris yang sudah ada dibekukan pada nama/SKU
-- master SAAT migrasi ini berjalan (aproksimasi terbaik yang tersedia —
-- nama historis sebelum titik ini memang tidak pernah disimpan). Sesudah
-- ini snapshot hanya ditulis saat dokumen dibuat dan tidak pernah diubah.
UPDATE "purchase_order_lines" l SET "product_name" = p."name", "product_sku" = p."sku" FROM "products" p WHERE p."id" = l."product_id";--> statement-breakpoint
UPDATE "stock_receipt_lines" l SET "product_name" = p."name", "product_sku" = p."sku" FROM "products" p WHERE p."id" = l."product_id";--> statement-breakpoint
UPDATE "stock_document_lines" l SET "product_name" = p."name", "product_sku" = p."sku" FROM "products" p WHERE p."id" = l."product_id";--> statement-breakpoint
UPDATE "supplier_return_lines" l SET "product_name" = p."name", "product_sku" = p."sku" FROM "products" p WHERE p."id" = l."product_id";