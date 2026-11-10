-- FIX-P1 Tahap 3 (AK1-01): materialisasi periode fiskal.
-- Sejak perbaikan ini, periode TANPA baris berarti TERTUTUP
-- (assertPeriodOpen menolaknya). Agar perusahaan yang sudah ada tidak
-- terkunci dari operasional berjalan, tahun berjalan & tahun berikutnya
-- dimaterialisasi (12 bulan "open") untuk setiap perusahaan. Baris yang
-- sudah ada — termasuk yang closed/locked — tidak disentuh (DO NOTHING).
-- Tahun di luar jendela ini sengaja TIDAK dibuat: membukanya adalah
-- keputusan eksplisit owner lewat halaman Periode (teraudit).
INSERT INTO "fiscal_periods" ("company_id", "year", "month", "status")
SELECT o."id", y."year", m."month", 'open'
FROM "organization" o
CROSS JOIN (
  VALUES
    (EXTRACT(YEAR FROM CURRENT_DATE)::int),
    (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
) AS y("year")
CROSS JOIN generate_series(1, 12) AS m("month")
ON CONFLICT ("company_id", "year", "month") DO NOTHING;
