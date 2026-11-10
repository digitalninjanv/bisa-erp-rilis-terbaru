ALTER TABLE "company_settings" ADD COLUMN "adjustment_approval_threshold" numeric(19, 4);--> statement-breakpoint
ALTER TABLE "stock_documents" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "stock_documents" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_documents" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;