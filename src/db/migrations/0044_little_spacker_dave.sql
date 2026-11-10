ALTER TABLE "company_settings" ADD COLUMN "reservation_default_expiry_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_document_lines" ADD COLUMN "received_qty" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_documents" ADD COLUMN "difference_reason" text;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "date" date DEFAULT (now() at time zone 'Asia/Jakarta')::date NOT NULL;--> statement-breakpoint
CREATE INDEX "stock_movements_company_date_idx" ON "stock_movements" USING btree ("company_id","date");--> statement-breakpoint
-- FIX-GDG Tahap 2 (GDG3-03): backfill tanggal bisnis baris lama dari
-- waktu postingnya (created_at, WIB). Ini pendekatan terbaik yang
-- tersedia untuk riwayat: dokumen yang tanggalnya dimundurkan DAN
-- sudah terposting sebelum migrasi ini tetap membawa tanggal posting
-- (bukan tanggal dokumennya), jadi rekonstruksi as-of masa lampau
-- untuk baris pra-migrasi bersifat perkiraan; baris baru selalu diisi
-- tanggal dokumen persis oleh domain. Trigger append-only dimatikan
-- sesaat khusus untuk backfill ini (preseden migrasi 0031).
ALTER TABLE "stock_movements" DISABLE TRIGGER "stock_movements_append_only";--> statement-breakpoint
UPDATE "stock_movements" SET "date" = ("created_at" AT TIME ZONE 'Asia/Jakarta')::date;--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE TRIGGER "stock_movements_append_only";