CREATE TABLE "customer_group_discounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"group_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"discount_type" text DEFAULT 'percent' NOT NULL,
	"discount_value" numeric(19, 4) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "rounding_mode" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_group_discounts" ADD CONSTRAINT "customer_group_discounts_group_id_customer_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."customer_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_group_discounts" ADD CONSTRAINT "customer_group_discounts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_group_discounts_uq" ON "customer_group_discounts" USING btree ("company_id","group_id","product_id");--> statement-breakpoint
CREATE INDEX "customer_group_discounts_group_idx" ON "customer_group_discounts" USING btree ("company_id","group_id");--> statement-breakpoint
ALTER TABLE "customer_group_discounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_group_discounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "customer_group_discounts";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "customer_group_discounts"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "customer_group_discounts" TO app_user;
