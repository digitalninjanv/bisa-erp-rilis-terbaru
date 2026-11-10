import postgres from "postgres";

/**
 * SIM-2 S4 — generator data sintetis benchmark (mandat §10).
 *
 * Membangun perusahaan benchmark yang sepenuhnya terpisah di DB dev agar
 * operasi laporan/POS/payroll bisa diukur pada volume besar. Data volume
 * (penjualan, jurnal, pergerakan stok historis) dimasukkan dengan SQL
 * langsung (generate_series) — BUKAN lewat domain — karena tujuannya
 * volume ukur; kebenaran perilaku domain sudah dibuktikan S1. Angka acak
 * memakai setseed tetap agar dataset dapat direproduksi.
 *
 * Perusahaan benchmark dapat dihapus bersih dengan cleanup.ts (semua
 * barisnya membawa satu company_id; tidak menyentuh perusahaan lain).
 *
 * Jalan:  pnpm tsx --env-file=.env.local scripts/sim2-gen/generate.ts --scale=A
 *         pnpm tsx --env-file=.env.local scripts/sim2-gen/generate.ts --scale=B
 */

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL/DATABASE_URL tidak ter-set");
const sql = postgres(url, { max: 1 });

type Scale = {
  tag: string;
  companyId: string;
  name: string;
  products: number;
  sales: number;
  customers: number;
  suppliers: number;
  employees: number;
  purchasesPerProduct: number;
  journalEntries: number;
  expenses: number;
  receipts: number;
  openingBalances: number;
};

const SCALES: Record<"A" | "B", Scale> = {
  A: {
    tag: "A",
    companyId: "01900000-0000-7000-8000-00000000bea1",
    name: "Benchmark Skala A (SIM-2 S4)",
    products: 10_000,
    sales: 40_000,
    customers: 500,
    suppliers: 50,
    employees: 300,
    purchasesPerProduct: 2,
    journalEntries: 45_000,
    expenses: 5_000,
    receipts: 2_000,
    openingBalances: 300,
  },
  B: {
    tag: "B",
    companyId: "01900000-0000-7000-8000-00000000bea2",
    name: "Benchmark Skala B (SIM-2 S4)",
    products: 100_000,
    sales: 400_000,
    customers: 2_000,
    suppliers: 200,
    employees: 300,
    purchasesPerProduct: 40,
    journalEntries: 500_000,
    expenses: 20_000,
    receipts: 8_000,
    openingBalances: 1_000,
  },
};

const ACCOUNT_SEEDS: Array<[string, string, string, "debit" | "credit"]> = [
  ["1000", "Kas", "asset", "debit"],
  ["1010", "Kas Kecil", "asset", "debit"],
  ["1100", "Bank BCA", "asset", "debit"],
  ["1110", "QRIS Clearing", "asset", "debit"],
  ["1200", "Piutang Usaha", "asset", "debit"],
  ["1210", "Kredit Pemasok", "asset", "debit"],
  ["1220", "Piutang Karyawan", "asset", "debit"],
  ["1300", "Persediaan Barang Dagang", "asset", "debit"],
  ["1400", "Perlengkapan", "asset", "debit"],
  ["1500", "Peralatan Toko", "asset", "debit"],
  ["1510", "Akumulasi Penyusutan Peralatan", "asset", "credit"],
  ["2000", "Utang Usaha", "liability", "credit"],
  ["2100", "Utang Gaji", "liability", "credit"],
  ["2110", "Utang PPh 21", "liability", "credit"],
  ["2120", "Utang BPJS", "liability", "credit"],
  ["2200", "PPN Keluaran", "liability", "credit"],
  ["2300", "Kredit Pelanggan", "liability", "credit"],
  ["3000", "Modal Pemilik", "equity", "credit"],
  ["3100", "Laba Ditahan", "equity", "credit"],
  ["4000", "Penjualan", "revenue", "credit"],
  ["4010", "Diskon Penjualan", "revenue", "debit"],
  ["4020", "Retur Penjualan", "revenue", "debit"],
  ["4030", "Pendapatan Lain-lain", "revenue", "credit"],
  ["5000", "Harga Pokok Penjualan", "cogs", "debit"],
  ["5010", "Selisih Persediaan", "cogs", "debit"],
  ["5020", "Barang Rusak dan Kedaluwarsa", "cogs", "debit"],
  ["6000", "Beban Gaji Karyawan", "expense", "debit"],
  ["6010", "Beban Sewa", "expense", "debit"],
  ["6020", "Beban Listrik dan Air", "expense", "debit"],
  ["6030", "Beban Telepon dan Internet", "expense", "debit"],
  ["6040", "Beban Transportasi", "expense", "debit"],
  ["6050", "Beban Perlengkapan", "expense", "debit"],
  ["6060", "Beban Administrasi Bank", "expense", "debit"],
  ["6070", "Beban Lain-lain", "expense", "debit"],
  ["6080", "Beban Iuran BPJS Perusahaan", "expense", "debit"],
  ["8000", "Selisih Kas Kurang", "expense", "debit"],
  ["8001", "Selisih Kas Lebih", "revenue", "credit"],
  ["9000", "Pembulatan Penjualan (Laba)", "revenue", "credit"],
  ["9001", "Selisih Pembulatan (Rugi)", "expense", "debit"],
];

const MAPPING_KEYS: Record<string, string> = {
  cash: "1000",
  bank: "1100",
  qris: "1110",
  receivable: "1200",
  supplier_credit: "1210",
  employee_receivable: "1220",
  inventory: "1300",
  payable: "2000",
  revenue: "4000",
  sales_discount: "4010",
  sales_return: "4020",
  cogs: "5000",
  inventory_shrink: "5010",
  damaged: "5020",
  tax_output: "2200",
  rounding_gain: "9000",
  rounding_loss: "9001",
  cash_short: "8000",
  cash_over: "8001",
  salary_expense: "6000",
  salary_payable: "2100",
  pph21_payable: "2110",
  bpjs_payable: "2120",
  payroll_employer_expense: "6080",
  bank_fee: "6060",
  equity: "3000",
  customer_credit: "2300",
};

function log(step: string, startedAt: number) {
  console.log(`[${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${step}`);
}

async function main() {
  const scaleArg = (process.argv.find((a) => a.startsWith("--scale=")) ?? "--scale=A").split("=")[1];
  const cfg = SCALES[scaleArg as "A" | "B"];
  if (!cfg) throw new Error(`Skala tidak dikenal: ${scaleArg} (pakai A atau B)`);
  const C = cfg.companyId;
  const started = Date.now();

  const existing = await sql`select id from organization where id = ${C}`;
  if (existing.length > 0) {
    throw new Error(
      `Perusahaan benchmark ${cfg.tag} (${C}) sudah ada. Hapus dulu dengan cleanup.ts --scale=${cfg.tag}.`,
    );
  }

  await sql`select setseed(0.4242)`;

  /* ---------- master: organisasi, cabang, gudang, pengaturan ---------- */
  await sql`
    insert into organization (id, name, slug, created_at)
    values (${C}, ${cfg.name}, ${"sim2-bench-" + cfg.tag.toLowerCase()}, now())`;
  const [branch] = await sql`
    insert into branches (company_id, code, name, is_default)
    values (${C}, 'BR-01', 'Toko Benchmark', true) returning id`;
  const warehouses = await sql`
    insert into warehouses (company_id, branch_id, code, name, type, is_default) values
      (${C}, ${branch.id}, 'GD-01', 'Gudang Benchmark Utama', 'warehouse', true),
      (${C}, ${branch.id}, 'GD-02', 'Gudang Benchmark Kedua', 'warehouse', false)
    returning id, code`;
  const mainWh = warehouses.find((w) => w.code === "GD-01")!.id as string;
  const secondWh = warehouses.find((w) => w.code === "GD-02")!.id as string;
  await sql`
    insert into company_settings (company_id, legal_name, default_warehouse_id, tax_rate, tax_enabled)
    values (${C}, ${cfg.name}, ${mainWh}, 0, false)`;
  log("master perusahaan", started);

  /* ---------- COA + pemetaan + metode bayar ---------- */
  const accId = new Map<string, string>();
  for (const [code, name, type, normal] of ACCOUNT_SEEDS) {
    const [row] = await sql`
      insert into accounts (company_id, code, name, type, normal_balance)
      values (${C}, ${code}, ${name}, ${type}, ${normal}) returning id`;
    accId.set(code, row.id as string);
  }
  for (const [key, code] of Object.entries(MAPPING_KEYS)) {
    await sql`
      insert into account_mappings (company_id, key, account_id)
      values (${C}, ${key}, ${accId.get(code)!})`;
  }
  const methods = await sql`
    insert into payment_methods (company_id, code, name, type, account_id, sort_order) values
      (${C}, 'CASH', 'Tunai', 'cash', ${accId.get("1000")!}, 1),
      (${C}, 'QRIS', 'QRIS', 'qris', ${accId.get("1110")!}, 2),
      (${C}, 'BANK', 'Transfer Bank', 'bank', ${accId.get("1100")!}, 3)
    returning id, code`;
  const cashMethod = methods.find((m) => m.code === "CASH")!.id as string;
  const qrisMethod = methods.find((m) => m.code === "QRIS")!.id as string;
  log("COA + pemetaan + metode bayar", started);

  /* ---------- kategori, satuan, pihak ---------- */
  await sql`
    insert into categories (company_id, name)
    select ${C}, 'Kategori Bench ' || lpad(g::text, 2, '0') from generate_series(1, 20) g`;
  await sql`
    insert into units (company_id, code, name) values
      (${C}, 'PCS', 'Pieces'), (${C}, 'DUS', 'Dus'), (${C}, 'KG', 'Kilogram')`;
  await sql`
    insert into suppliers (company_id, code, name, phone)
    select ${C}, 'SUP-B' || ${cfg.tag} || '-' || lpad(g::text, 4, '0'),
           'Pemasok Bench ' || g, '0812' || lpad(g::text, 8, '0')
    from generate_series(1, ${cfg.suppliers}) g`;
  await sql`
    insert into customer_groups (company_id, name) values (${C}, 'Umum')`;
  await sql`
    insert into customers (company_id, code, name, phone, credit_limit)
    select ${C}, 'CUS-B' || ${cfg.tag} || '-' || lpad(g::text, 5, '0'),
           'Pelanggan Bench ' || g, '0813' || lpad(g::text, 8, '0'), 5000000
    from generate_series(1, ${cfg.customers}) g`;
  log("kategori/satuan/pihak", started);

  /* ---------- produk ---------- */
  // PERHATIAN pola SQL di seluruh generator: random() WAJIB di daftar
  // SELECT kueri per-baris atau di lateral yang mereferensikan baris
  // luar — lateral tanpa referensi di-hoist planner menjadi satu nilai
  // untuk seluruh kueri (terbukti: harga & pilihan produk sempat seragam).
  await sql`
    insert into products (company_id, sku, barcode, name, category_id, unit_id, supplier_id,
                          cost_price, sale_price, min_stock, track_stock, track_batch)
    select ${C},
           'BM' || ${cfg.tag} || '-' || lpad(base.g::text, 6, '0'),
           '899' || lpad(base.g::text, 10, '0'),
           (array['Susu','Kopi','Teh','Beras','Gula','Minyak','Mie','Sabun','Kecap','Roti',
                  'Telur','Ayam','Daging','Sayur','Buah','Susu Formula','Kopi Sachet','Teh Celup','Biskuit','Permen'])[1 + (base.g % 20)]
             || ' ' ||
           (array['Segar','Premium','Ekonomis','Keluarga','Spesial'])[1 + (base.g % 5)]
             || ' ' || base.g,
           cat.id, unt.id, sup.id,
           base.cost_price,
           round(base.cost_price * (1.1 + random() * 0.3)),
           case when base.g % 10 < 3 then 10 else 0 end,
           true,
           base.g % 20 = 0
    from (select g, (1000 + floor(random() * 499) * 1000)::numeric as cost_price
          from generate_series(1, ${cfg.products}) g) base
    join lateral (select id from categories where company_id = ${C} order by name offset (base.g % 20) limit 1) cat on true
    join lateral (select id from units where company_id = ${C} order by code offset (base.g % 3) limit 1) unt on true
    join lateral (select id from suppliers where company_id = ${C} order by code offset (base.g % ${cfg.suppliers}) limit 1) sup on true`;
  log(`produk (${cfg.products})`, started);

  /* ---------- karyawan, payroll, kasbon (beban halaman payroll) ---------- */
  await sql`
    insert into employees (company_id, code, name, position, base_salary, allowances, deductions, joined_at)
    select ${C}, 'EMP-B' || ${cfg.tag} || '-' || lpad(g::text, 4, '0'),
           'Karyawan Bench ' || lpad(g::text, 3, '0'),
           (array['Kasir','Gudang','Admin','Supervisor','Kurir'])[1 + (g % 5)],
           3000000 + (g % 50) * 100000,
           300000 + (g % 7) * 100000,
           50000 + (g % 4) * 50000,
           date '2023-01-01' + (g % 700)
    from generate_series(1, ${cfg.employees}) g`;
  await sql`
    insert into payroll_runs (company_id, number, period, status, total_gross, total_deductions, total_net)
    select ${C}, 'PAY-B' || ${cfg.tag} || '-2025-' || lpad(m::text, 2, '0'),
           '2025-' || lpad(m::text, 2, '0'), 'posted', 0, 0, 0
    from generate_series(1, 12) m`;
  await sql`
    insert into payroll_items (company_id, run_id, employee_id, base_salary, allowances, deductions, net)
    select ${C}, r.id, e.id, e.base_salary, e.allowances, e.deductions,
           e.base_salary + e.allowances - e.deductions
    from payroll_runs r join employees e on e.company_id = ${C}
    where r.company_id = ${C}`;
  await sql`
    update payroll_runs r set
      total_gross = s.gross, total_deductions = s.deduc, total_net = s.net
    from (select run_id, sum(base_salary + allowances) as gross,
                 sum(deductions) as deduc, sum(net) as net
          from payroll_items where company_id = ${C} group by run_id) s
    where r.id = s.run_id and r.company_id = ${C}`;
  // Kasbon berjalan: 120 karyawan pertama, 1–3 kasbon per karyawan,
  // mode rencana campuran — inilah beban N+1 halaman payroll (PERF-01).
  await sql`
    insert into employee_advances (company_id, number, employee_id, date, amount,
                                   remaining_amount, account_id, plan_mode, plan_value, status)
    select ${C},
           'KSB-B' || ${cfg.tag} || '-' || lpad((row_number() over ())::text, 5, '0'),
           e.id,
           date '2025-01-15' + (ord % 300)::int,
           amt.amount,
           round(amt.amount * (0.4 + random() * 0.6)),
           ${accId.get("1000")!},
           (array['full','fixed','percent'])[1 + (ord % 3)],
           case (ord % 3) when 1 then 500000 when 2 then 25 else null end,
           'open'
    from (select id, row_number() over (order by code) as ord
          from employees where company_id = ${C} order by code limit 120) e
    join lateral generate_series(1, 1 + (e.ord % 3)) k on true
    join lateral (select (1000000 + floor(random() * 9) * 500000)::numeric as amount
                  where k is not null) amt on true`;
  log("karyawan/payroll/kasbon", started);

  /* ---------- penjualan (rencana → baris → header → pembayaran) ---------- */
  await sql`
    create temp table tmp_products as
    select id, sale_price, cost_price,
           row_number() over (order by sku) as ord
    from products where company_id = ${C}`;
  await sql`create index on tmp_products (ord)`;
  await sql`
    create temp table tmp_plan as
    select g as seq,
           (date '2025-01-01' + floor(random() * 365)::int) as sdate,
           (timestamp '2025-01-01' + floor(random() * 365)::int * interval '1 day'
             + floor(random() * 86399) * interval '1 second') as created_at,
           1 + floor(random() * 4)::int as nlines
    from generate_series(1, ${cfg.sales}) g`;
  const hotCount = Math.min(200, cfg.products);
  await sql`
    create temp table tmp_picks as
    select p.seq as sale_seq, li as line_no,
           case when random() < 0.8
                then 1 + floor(random() * ${hotCount})::int
                else 1 + floor(random() * ${cfg.products})::int end as pick,
           (1 + floor(random() * 5))::numeric as qty
    from tmp_plan p
    join lateral generate_series(1, p.nlines) li on true`;
  await sql`
    create temp table tmp_lines as
    select pk.sale_seq, p.sdate, p.created_at, pk.line_no,
           tp.id as product_id, tp.sale_price as unit_price, tp.cost_price as unit_cost,
           pk.qty
    from tmp_picks pk
    join tmp_plan p on p.seq = pk.sale_seq
    join tmp_products tp on tp.ord = pk.pick`;
  await sql`create index on tmp_lines (sale_seq)`;
  log("rencana penjualan + baris sementara", started);

  await sql`
    insert into sales (company_id, warehouse_id, number, date, due_date, cashier_id,
                       customer_id, status, subtotal, discount_total, tax_total,
                       rounding_adjustment, rounding_mode, total, cost_total,
                       paid_total, change_total, payment_status, idempotency_key,
                       created_by, created_at, posted_at)
    select ${C}, ${mainWh},
           'INV-B' || ${cfg.tag} || '-' || lpad(t.seq::text, 7, '0'),
           p.sdate,
           case when pm.status <> 'paid' then p.sdate + 30 else null end,
           'bench-cashier',
           cust.id,
           'completed',
           t.subtotal, 0, 0, 0, 'none',
           t.subtotal, t.cost_total,
           pm.paid, 0, pm.status,
           'bench-sale-' || ${cfg.tag} || '-' || t.seq,
           'bench', p.created_at, p.created_at
    from (select sale_seq as seq, sum(qty * unit_price) as subtotal,
                 sum(qty * unit_cost) as cost_total
          from tmp_lines group by sale_seq) t
    join tmp_plan p on p.seq = t.seq
    join lateral (
      select case when t.seq % 20 = 0 then 'unpaid'
                  when t.seq % 20 = 1 then 'partial'
                  else 'paid' end as status,
             case when t.seq % 20 = 0 then 0::numeric
                  when t.seq % 20 = 1 then round(t.subtotal / 2)
                  else t.subtotal end as paid
    ) pm on true
    left join lateral (
      select id from customers
      where company_id = ${C} and t.seq % 5 = 0
      order by code offset (t.seq % ${cfg.customers}) limit 1
    ) cust on true`;
  log(`header penjualan (${cfg.sales})`, started);

  await sql`
    insert into sale_lines (company_id, sale_id, product_id, line_no, qty, unit_price,
                            discount_value, discount_amount, tax_amount, line_total,
                            unit_cost, tax_rate, product_name, product_sku)
    select ${C}, s.id, l.product_id, l.line_no, l.qty, l.unit_price,
           0, 0, 0, l.qty * l.unit_price, l.unit_cost, 0,
           pr.name, pr.sku
    from tmp_lines l
    join sales s on s.company_id = ${C}
      and s.idempotency_key = 'bench-sale-' || ${cfg.tag} || '-' || l.sale_seq
    join products pr on pr.id = l.product_id`;
  log("baris penjualan", started);

  await sql`
    insert into sale_payments (company_id, sale_id, method_id, amount, tendered, created_at)
    select ${C}, s.id,
           case when s.idempotency_key like '%-1' or s.idempotency_key like '%-4' or s.idempotency_key like '%-7'
                then ${qrisMethod}::uuid else ${cashMethod}::uuid end,
           s.paid_total, s.paid_total, s.created_at
    from sales s
    where s.company_id = ${C} and s.paid_total > 0`;
  log("pembayaran penjualan", started);

  /* ---------- pergerakan stok ----------
   * opening: produk laris (ord<=200) stok besar agar tidak negatif;
   * purchase: purchasesPerProduct × per produk tersebar setahun;
   * sale: satu per baris penjualan. stock_on_hand = agregat gerakan. */
  await sql`
    insert into stock_movements (company_id, warehouse_id, product_id, movement_type,
                                 qty, unit_cost, reference_type, created_at)
    select ${C}, ${mainWh}, tp.id, 'opening',
           case when tp.ord <= 200 then 50000 else 100 + floor(random() * 400) end,
           tp.cost_price, 'bench', timestamp '2025-01-01 08:00:00+07'
    from tmp_products tp`;
  await sql`
    insert into stock_movements (company_id, warehouse_id, product_id, movement_type,
                                 qty, unit_cost, reference_type, created_at)
    select ${C}, ${secondWh}, tp.id, 'opening',
           50 + floor(random() * 200), tp.cost_price, 'bench',
           timestamp '2025-01-01 08:00:00+07'
    from tmp_products tp where tp.ord % 3 = 0`;
  await sql`
    insert into stock_movements (company_id, warehouse_id, product_id, movement_type,
                                 qty, unit_cost, reference_type, created_at)
    select ${C}, ${mainWh}, tp.id, 'purchase',
           20 + floor(random() * 100), tp.cost_price, 'bench',
           timestamp '2025-01-02' + floor(random() * 360)::int * interval '1 day'
             + floor(random() * 3600) * interval '1 second'
    from tmp_products tp
    join lateral generate_series(1, ${cfg.purchasesPerProduct}) k on true`;
  await sql`
    insert into stock_movements (company_id, warehouse_id, product_id, movement_type,
                                 qty, unit_cost, reference_type, reference_number, created_at)
    select ${C}, ${mainWh}, l.product_id, 'sale', -l.qty, l.unit_cost,
           'sale', 'INV-B' || ${cfg.tag} || '-' || lpad(l.sale_seq::text, 7, '0'),
           l.created_at
    from tmp_lines l`;
  await sql`
    insert into stock_on_hand (company_id, warehouse_id, product_id, qty)
    select company_id, warehouse_id, product_id, sum(qty)
    from stock_movements where company_id = ${C}
    group by company_id, warehouse_id, product_id`;
  log("pergerakan stok + stok akhir", started);

  /* ---------- jurnal umum (2 baris seimbang per entri) ----------
   * Entri + baris wajib satu transaksi: trigger journal_entries_balanced
   * bersifat DEFERRABLE INITIALLY DEFERRED dan memeriksa keseimbangan
   * saat commit — pola yang sama seperti jalur domain (withCompany). */
  await sql.begin(async (sql) => {
  await sql`
    insert into journal_entries (company_id, number, date, description, source_type,
                                 status, idempotency_key, created_by, posted_at, created_at)
    select ${C},
           'JU-B' || ${cfg.tag} || '-' || lpad(g::text, 7, '0'),
           (date '2025-01-01' + floor(random() * 365)::int),
           case
             when g % 45 = 0 then 'Pembayaran gaji karyawan periode berjalan'
             when g % 9 in (0,1,2,3,4) then 'Penjualan tunai harian toko'
             when g % 9 in (5,6) then 'Pembelian stok dari pemasok'
             when g % 9 = 7 then 'Beban listrik dan air bulanan'
             else 'Jurnal umum penyesuaian dan lain-lain'
           end,
           case
             when g % 45 = 0 then 'payroll'
             when g % 9 in (0,1,2,3,4) then 'sale'
             when g % 9 in (5,6) then 'purchase'
             when g % 9 = 7 then 'expense'
             else 'manual'
           end,
           'posted',
           'bench-journal-' || ${cfg.tag} || '-' || g,
           'bench',
           (timestamp '2025-01-01' + floor(random() * 365)::int * interval '1 day'),
           (timestamp '2025-01-01' + floor(random() * 365)::int * interval '1 day'
             + floor(random() * 86399) * interval '1 second')
    from generate_series(1, ${cfg.journalEntries}) g`;
  await sql`
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description, line_no)
    select ${C}, e.id,
           case
             when side = 1 then pair.dr
             else pair.cr
           end,
           case when side = 1 then e_amt.amount else 0 end,
           case when side = 2 then e_amt.amount else 0 end,
           e.description,
           side
    from journal_entries e
    join lateral (
      select (10000 + floor(random() * 499) * 10000)::numeric as amount
    ) e_amt on true
    join lateral (
      select case
               when e.source_type = 'payroll' then ${accId.get("6000")!}::uuid
               when e.source_type = 'sale' then ${accId.get("1000")!}::uuid
               when e.source_type = 'purchase' then ${accId.get("1300")!}::uuid
               when e.source_type = 'expense' then ${accId.get("6020")!}::uuid
               else ${accId.get("6070")!}::uuid
             end as dr,
             case
               when e.source_type = 'payroll' then ${accId.get("2100")!}::uuid
               when e.source_type = 'sale' then ${accId.get("4000")!}::uuid
               when e.source_type = 'purchase' then ${accId.get("2000")!}::uuid
               else ${accId.get("1000")!}::uuid
             end as cr
    ) pair on true
    join lateral generate_series(1, 2) side on true
    where e.company_id = ${C}`;
  });
  log(`jurnal (${cfg.journalEntries} entri)`, started);

  /* ---------- beban, penerimaan utang, saldo awal pihak ---------- */
  await sql`
    insert into expenses (company_id, number, date, expense_account_id, payment_account_id,
                          amount, description, status, created_at)
    select ${C}, 'EXP-B' || ${cfg.tag} || '-' || lpad(g::text, 6, '0'),
           (date '2025-01-01' + floor(random() * 365)::int),
           ea.id,
           ${accId.get("1000")!},
           (50000 + floor(random() * 195) * 25000)::numeric,
           (array['Sewa tempat usaha','Listrik dan air','Telepon dan internet',
                  'Transportasi pengiriman','Perlengkapan toko','Beban operasional lain'])[1 + (g % 6)],
           'posted',
           (timestamp '2025-01-01' + floor(random() * 365)::int * interval '1 day')
    from generate_series(1, ${cfg.expenses}) g
    join lateral (
      select id from accounts
      where company_id = ${C}
        and code = (array['6010','6020','6030','6040','6050','6070'])[1 + (g % 6)]
    ) ea on true`;
  await sql`
    insert into stock_receipts (company_id, warehouse_id, supplier_id, source, number, date,
                                status, total, paid_amount, payment_status, created_at)
    select ${C}, ${mainWh}, sup.id, 'purchase',
           'GRN-B' || ${cfg.tag} || '-' || lpad(base.g::text, 6, '0'),
           (date '2025-01-01' + floor(random() * 365)::int),
           'posted',
           base.total,
           case when base.g % 4 = 0 then round(base.total / 2) else 0 end,
           case when base.g % 4 = 0 then 'partial' else 'unpaid' end,
           (timestamp '2025-01-01' + floor(random() * 365)::int * interval '1 day')
    from (select g, (500000 + floor(random() * 900) * 10000)::numeric as total
          from generate_series(1, ${cfg.receipts}) g) base
    join lateral (select id from suppliers where company_id = ${C}
                  order by code offset (base.g % ${cfg.suppliers}) limit 1) sup on true`;
  await sql`
    insert into party_opening_balances (company_id, number, kind, party_type, party_id,
                                        date, due_date, amount, paid_amount, status, reference)
    select ${C},
           (case when base.g % 2 = 0 then 'OB-AP-B' else 'OB-AR-B' end) || ${cfg.tag} || '-' || lpad(base.g::text, 5, '0'),
           case when base.g % 2 = 0 then 'payable' else 'receivable' end,
           case when base.g % 2 = 0 then 'supplier' else 'customer' end,
           party.id,
           (date '2025-01-01' + floor(random() * 180)::int),
           (date '2025-02-01' + floor(random() * 180)::int),
           base.amount,
           case when base.g % 3 = 0 then round(base.amount / 3) else 0 end,
           'open',
           'Faktur lama bench ' || base.g
    from (select g, (250000 + floor(random() * 95) * 50000)::numeric as amount
          from generate_series(1, ${cfg.openingBalances}) g) base
    join lateral (
      (select id from suppliers where company_id = ${C} and base.g % 2 = 0
       order by code offset (base.g % ${cfg.suppliers}) limit 1)
      union all
      (select id from customers where company_id = ${C} and base.g % 2 = 1
       order by code offset (base.g % ${cfg.customers}) limit 1)
    ) party on true`;
  log("beban/penerimaan/saldo awal", started);

  /* ---------- ANALYZE + statistik ---------- */
  await sql`analyze products`;
  await sql`analyze sales`;
  await sql`analyze sale_lines`;
  await sql`analyze stock_movements`;
  await sql`analyze journal_entries`;
  await sql`analyze journal_lines`;
  await sql`analyze expenses`;
  await sql`analyze payroll_items`;
  await sql`analyze employee_advances`;

  const counts = await sql`
    select
      (select count(*)::int from products where company_id = ${C}) as products,
      (select count(*)::int from sales where company_id = ${C}) as sales,
      (select count(*)::int from sale_lines where company_id = ${C}) as sale_lines,
      (select count(*)::int from stock_movements where company_id = ${C}) as stock_movements,
      (select count(*)::int from journal_entries where company_id = ${C}) as journal_entries,
      (select count(*)::int from journal_lines where company_id = ${C}) as journal_lines,
      (select count(*)::int from employees where company_id = ${C}) as employees,
      (select count(*)::int from employee_advances where company_id = ${C}) as advances,
      (select count(*)::int from expenses where company_id = ${C}) as expenses`;
  const sizes = await sql`
    select relname, pg_size_pretty(pg_total_relation_size(relid)) as size
    from pg_catalog.pg_statio_user_tables
    where relname in ('products','sales','sale_lines','stock_movements','journal_entries','journal_lines')
    order by relname`;

  console.log(`\n=== Dataset benchmark skala ${cfg.tag} selesai (${((Date.now() - started) / 1000).toFixed(1)}s) ===`);
  console.log(`company_id: ${C}`);
  console.log(counts[0]);
  console.log("Ukuran tabel (seluruh DB, termasuk perusahaan lain):");
  for (const row of sizes) console.log(`  ${row.relname}: ${row.size}`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end({ timeout: 1 }).catch(() => undefined);
  process.exit(1);
});
