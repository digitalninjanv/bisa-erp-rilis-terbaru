CREATE TABLE "product_packagings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"isi" numeric(19, 4) NOT NULL,
	"buy_price" numeric(19, 4),
	"sale_price" numeric(19, 4),
	"barcode" text,
	"is_default_purchase" boolean DEFAULT false NOT NULL,
	"is_default_sale" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_packagings" ADD CONSTRAINT "product_packagings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_packagings_company_product_name_uq" ON "product_packagings" USING btree ("company_id","product_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "product_packagings_company_barcode_uq" ON "product_packagings" USING btree ("company_id","barcode");--> statement-breakpoint
CREATE INDEX "product_packagings_company_product_idx" ON "product_packagings" USING btree ("company_id","product_id");
--> statement-breakpoint
-- Program Satuan Kemasan S1 manual additions, same file by design
-- (pattern of 0060): tenant RLS + grants for the new table. No
-- pre-tenant lookup policy — packagings are only ever resolved inside
-- a tenant transaction (withCompany), barcode resolution included.
ALTER TABLE "product_packagings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_packagings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "product_packagings"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "product_packagings" TO app_user;