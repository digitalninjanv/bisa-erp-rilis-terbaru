-- A-28 UI-2 (UX-D01): pengaturan cetak SATU PINTU. Saklar warisan yang
-- hidup (Kasir, Pajak) DIPINDAH namanya ke mesin cetak — nilai &
-- bawaan terpelihara persis lewat RENAME. Nilai Footer nota lama
-- dimigrasikan satu kali menjadi teks kaki mesin cetak bila teks
-- kaki masih kosong, sesudah itu kolom warisan berhenti ada.
ALTER TABLE "company_settings" RENAME COLUMN "receipt_show_cashier" TO "print_show_cashier";--> statement-breakpoint
ALTER TABLE "company_settings" RENAME COLUMN "receipt_show_tax" TO "print_show_tax";--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "print_show_customer" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "print_show_session" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "print_show_branding" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "print_signature_labels" jsonb;--> statement-breakpoint
UPDATE "company_settings" SET "print_footer_text" = "receipt_footer" WHERE ("print_footer_text" IS NULL OR btrim("print_footer_text") = '') AND "receipt_footer" IS NOT NULL AND btrim("receipt_footer") <> '';--> statement-breakpoint
ALTER TABLE "company_settings" DROP COLUMN "receipt_header";--> statement-breakpoint
ALTER TABLE "company_settings" DROP COLUMN "receipt_footer";--> statement-breakpoint
ALTER TABLE "company_settings" DROP COLUMN "receipt_show_logo";
