\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('app.company_id', '01900000-0000-7000-8000-000000000001', true);
INSERT INTO products (company_id, sku, name, barcode)
SELECT current_setting('app.company_id'), 'AUD-' || n, 'Audit catalog product ' || n, 'AUD-BAR-' || n
FROM generate_series(1, 50000) AS n;
ANALYZE products;
ANALYZE product_packagings;
SET LOCAL ROLE app_user;
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON)
SELECT p.id, p.sku, p.barcode, p.name, p.category_id, c.name, p.sale_price, p.cost_price, u.code,
       p.track_stock, p.track_serial,
       coalesce((SELECT soh.qty FROM stock_on_hand soh WHERE soh.company_id = p.company_id
          AND soh.product_id = p.id AND soh.warehouse_id =
            (SELECT w.id FROM warehouses w WHERE w.company_id = p.company_id AND w.is_default LIMIT 1)), 0)
FROM products p LEFT JOIN units u ON p.unit_id = u.id LEFT JOIN categories c ON p.category_id = c.id
WHERE p.company_id = current_setting('app.company_id') AND p.is_active
  AND (p.barcode = 'AUD-BAR-31999' OR p.sku = 'AUD-BAR-31999' OR EXISTS (
    SELECT 1 FROM product_packagings pp WHERE pp.company_id = p.company_id AND pp.product_id = p.id
      AND pp.barcode = 'AUD-BAR-31999' AND pp.is_active))
ORDER BY CASE WHEN p.barcode = 'AUD-BAR-31999' THEN 0 WHEN p.sku = 'AUD-BAR-31999' THEN 2
   WHEN EXISTS (SELECT 1 FROM product_packagings pp WHERE pp.company_id = p.company_id
      AND pp.product_id = p.id AND pp.barcode = 'AUD-BAR-31999' AND pp.is_active) THEN 1 ELSE 3 END,
   p.name
LIMIT 20;
ROLLBACK;
