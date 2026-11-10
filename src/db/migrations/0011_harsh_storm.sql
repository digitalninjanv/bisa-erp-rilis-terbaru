CREATE TABLE "stock_batches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"batch_number" text,
	"expiry_date" date,
	"qty" numeric(19, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "track_batch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD COLUMN "batch_number" text;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD COLUMN "expiry_date" date;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_batches_identity_uq" ON "stock_batches" USING btree ("company_id","product_id","warehouse_id",coalesce("batch_number", ''),coalesce("expiry_date", 'infinity'::date));--> statement-breakpoint
CREATE INDEX "stock_batches_company_product_idx" ON "stock_batches" USING btree ("company_id","product_id","warehouse_id");--> statement-breakpoint
ALTER TABLE "stock_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_batches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "stock_batches";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "stock_batches"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_batches" TO app_user;