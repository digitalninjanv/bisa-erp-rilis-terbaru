ALTER TABLE "customer_groups" ADD COLUMN "rounding_step" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_groups" ADD COLUMN "rounding_direction" text DEFAULT 'down' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_groups" ADD COLUMN "round_cash_total" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_groups" ADD COLUMN "discount_account_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_groups" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_group_discounts" DROP COLUMN "is_active";