ALTER TABLE "company_settings" ADD COLUMN "print_template" text DEFAULT 'modern' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "print_logo_url" text;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "print_accent_color" text DEFAULT '#111827' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "print_font" text DEFAULT 'sans' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "print_header_text" text;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "print_footer_text" text;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "print_show_signature" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "print_show_qr" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "print_receipt_paper" text DEFAULT 'thermal80' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "print_document_paper" text DEFAULT 'a4' NOT NULL;