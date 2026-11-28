ALTER TABLE "company_settings" ADD COLUMN "journal_approval_threshold" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "approval_status" text DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "approval_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "approval_note" text;