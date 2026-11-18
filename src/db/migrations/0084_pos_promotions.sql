--POS promosi sederhana untuk terminal desktop (Odoo/Accurate parity).
--Diskon dihitung sebagai diskon baris pada quote, jadi server tetap
--menjadi otoritas harga saat sinkronisasi.
CREATE TABLE IF NOT EXISTS "pos_promotions" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "company_id" text NOT NULL,
  "name" text NOT NULL,
  "type" text NOT NULL DEFAULT 'percent',
  "value" numeric(19,4) NOT NULL DEFAULT '0',
  "min_subtotal" numeric(19,4) NOT NULL DEFAULT '0',
  "product_id" uuid,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "pos_promotions_company_active_idx"
  ON "pos_promotions" ("company_id", "active");
ALTER TABLE "pos_promotions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_promotions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "pos_promotions"
  USING ("company_id" = (select nullif(current_setting('app.company_id', true), '')))
  WITH CHECK ("company_id" = (select nullif(current_setting('app.company_id', true), '')));
GRANT SELECT ON "pos_promotions" TO "app_user";
