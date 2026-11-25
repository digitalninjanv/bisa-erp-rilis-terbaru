ALTER TABLE "customers" ADD COLUMN "credit_limit_unlimited" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "serial_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD COLUMN "serial_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL;