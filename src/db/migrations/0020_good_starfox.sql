ALTER TABLE "company_settings" ADD COLUMN "enabled_modules" jsonb;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "custom_fields" jsonb;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "attributes" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "attributes" jsonb;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "attributes" jsonb;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;