ALTER TABLE "products" ADD COLUMN "is_tax_exempt" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
GRANT INSERT, UPDATE, DELETE ON "pos_promotions" TO "app_user";
