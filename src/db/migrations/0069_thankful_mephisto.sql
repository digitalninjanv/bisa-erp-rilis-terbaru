ALTER TABLE "purchase_advances" ALTER COLUMN "payment_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_advances" ADD COLUMN "origin_type" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_advances" ADD COLUMN "origin_return_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_advances" ADD CONSTRAINT "purchase_advances_origin_return_id_supplier_returns_id_fk" FOREIGN KEY ("origin_return_id") REFERENCES "public"."supplier_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_advances_origin_return_uq" ON "purchase_advances" USING btree ("origin_return_id");