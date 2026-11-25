-- Nilai stok (DPP) per baris penerimaan; NULL untuk baris lama.
ALTER TABLE "stock_receipt_lines" ADD COLUMN "stock_unit_cost" numeric(19, 4);
--> statement-breakpoint
-- Nilai barang retur, terpisah dari nilai voucher kredit; NULL untuk baris lama.
ALTER TABLE "sale_returns" ADD COLUMN "goods_total" numeric(19, 4);
