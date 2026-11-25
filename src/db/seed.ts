import { hashPassword } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import { adminDb, adminSql } from "./admin";
import {
  branches,
  cashMovements,
  cashSessions,
  categories,
  companySettings,
  customerGroupPrices,
  customerGroups,
  customers,
  documentSequences,
  employees,
  fiscalPeriods,
  journalEntries,
  journalLines,
  member,
  organization,
  partyOpeningBalances,
  paymentMethods,
  products,
  stockMovements,
  stockOnHand,
  suppliers,
  units,
  user,
  warehouses,
  account,
} from "./schema";
import { toDb } from "../lib/money";
import { env } from "../lib/env";
import { resolveSeedOwnerPassword, seedOwnerLoginMessage } from "./seed-guard";
import { seedDemoChart } from "./seed-chart"; import { seedDemoPackaging } from "./seed-packaging";
import { seedPayrollIndonesiaDefaults } from "../server/payroll-indonesia";

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const YEAR = new Date().getFullYear();

type ProductSeed = {
  name: string;
  category: string;
  unit: string;
  cost: number;
  price: number;
  min: number;
  stock: number;
};

const PRODUCTS: ProductSeed[] = [
  { name: "Aqua Air Mineral 600ml", category: "Minuman", unit: "BTL", cost: 2600, price: 4000, min: 24, stock: 120 },
  { name: "Aqua Air Mineral 1.5L", category: "Minuman", unit: "BTL", cost: 5200, price: 7500, min: 12, stock: 60 },
  { name: "Teh Botol Sosro 450ml", category: "Minuman", unit: "BTL", cost: 4200, price: 6000, min: 24, stock: 96 },
  { name: "Coca Cola 390ml", category: "Minuman", unit: "BTL", cost: 5000, price: 7000, min: 24, stock: 72 },
  { name: "Sprite 390ml", category: "Minuman", unit: "BTL", cost: 5000, price: 7000, min: 24, stock: 48 },
  { name: "Fanta Strawberry 390ml", category: "Minuman", unit: "BTL", cost: 5000, price: 7000, min: 24, stock: 36 },
  { name: "Pocari Sweat 500ml", category: "Minuman", unit: "BTL", cost: 7800, price: 10000, min: 12, stock: 40 },
  { name: "Mizone 500ml", category: "Minuman", unit: "BTL", cost: 5000, price: 7000, min: 12, stock: 30 },
  { name: "Ultra Milk Coklat 250ml", category: "Minuman", unit: "BOX", cost: 5200, price: 7000, min: 12, stock: 48 },
  { name: "Frisian Flag UHT 225ml", category: "Minuman", unit: "BOX", cost: 4800, price: 6500, min: 12, stock: 60 },
  { name: "Kapal Api Spesial Sachet", category: "Minuman", unit: "SACHET", cost: 1400, price: 2000, min: 50, stock: 240 },
  { name: "Nescafe Classic Sachet", category: "Minuman", unit: "SACHET", cost: 1600, price: 2500, min: 50, stock: 180 },
  { name: "Good Day Cappuccino Sachet", category: "Minuman", unit: "SACHET", cost: 1700, price: 2500, min: 50, stock: 200 },
  { name: "Teh Pucuk Harum 350ml", category: "Minuman", unit: "BTL", cost: 3600, price: 5000, min: 24, stock: 84 },
  { name: "Floridina Orange 350ml", category: "Minuman", unit: "BTL", cost: 3300, price: 5000, min: 24, stock: 48 },
  { name: "Buavita Jambu 250ml", category: "Minuman", unit: "BOX", cost: 5600, price: 7500, min: 12, stock: 24 },
  { name: "Chitato Sapi Panggang 68g", category: "Makanan Ringan", unit: "PACK", cost: 9500, price: 12500, min: 12, stock: 36 },
  { name: "Lay's Rumput Laut 68g", category: "Makanan Ringan", unit: "PACK", cost: 9500, price: 12500, min: 12, stock: 30 },
  { name: "Taro Net Seaweed 70g", category: "Makanan Ringan", unit: "PACK", cost: 7800, price: 10000, min: 12, stock: 42 },
  { name: "Qtela Singkong Original 60g", category: "Makanan Ringan", unit: "PACK", cost: 7000, price: 9000, min: 12, stock: 26 },
  { name: "Oreo Vanilla 133g", category: "Makanan Ringan", unit: "PACK", cost: 9500, price: 13000, min: 12, stock: 48 },
  { name: "Roma Kelapa 300g", category: "Makanan Ringan", unit: "PACK", cost: 10500, price: 14000, min: 12, stock: 36 },
  { name: "Beng Beng Chocolate", category: "Makanan Ringan", unit: "PCS", cost: 1900, price: 3000, min: 30, stock: 120 },
  { name: "Silverqueen Almond 65g", category: "Makanan Ringan", unit: "PCS", cost: 15500, price: 20000, min: 12, stock: 24 },
  { name: "Nabati Richoco Wafer", category: "Makanan Ringan", unit: "PACK", cost: 2200, price: 3500, min: 24, stock: 90 },
  { name: "Better Chocolate 100g", category: "Makanan Ringan", unit: "PACK", cost: 9000, price: 12000, min: 12, stock: 18 },
  { name: "Beras Pandan Wangi 5kg", category: "Sembako", unit: "PACK", cost: 62000, price: 72000, min: 10, stock: 34 },
  { name: "Beras IR64 5kg", category: "Sembako", unit: "PACK", cost: 56000, price: 66000, min: 10, stock: 28 },
  { name: "Minyak Goreng Sania 2L", category: "Sembako", unit: "POUCH", cost: 34000, price: 39000, min: 12, stock: 40 },
  { name: "Minyak Goreng Sania 1L", category: "Sembako", unit: "POUCH", cost: 17500, price: 21000, min: 12, stock: 52 },
  { name: "Gula Pasir Gulaku 1kg", category: "Sembako", unit: "PACK", cost: 15500, price: 18000, min: 12, stock: 45 },
  { name: "Tepung Segitiga Biru 1kg", category: "Sembako", unit: "PACK", cost: 12500, price: 15000, min: 12, stock: 30 },
  { name: "Garam Refina 250g", category: "Sembako", unit: "PACK", cost: 2500, price: 4000, min: 24, stock: 60 },
  { name: "Kecap Bango 520ml", category: "Sembako", unit: "BTL", cost: 21000, price: 26000, min: 12, stock: 22 },
  { name: "Sambal ABC Extra Pedas 335ml", category: "Sembako", unit: "BTL", cost: 14500, price: 18000, min: 12, stock: 24 },
  { name: "Saus Tomat ABC 335ml", category: "Sembako", unit: "BTL", cost: 13500, price: 17000, min: 12, stock: 20 },
  { name: "Indomie Goreng", category: "Sembako", unit: "PCS", cost: 3100, price: 3800, min: 40, stock: 240 },
  { name: "Indomie Soto", category: "Sembako", unit: "PCS", cost: 3000, price: 3700, min: 40, stock: 180 },
  { name: "Sarimi Ayam Bawang", category: "Sembako", unit: "PCS", cost: 3000, price: 3700, min: 40, stock: 120 },
  { name: "Telur Ayam Negeri 1kg", category: "Sembako", unit: "KG", cost: 27000, price: 31000, min: 10, stock: 24 },
  { name: "Frisian Flag Kental Manis 490g", category: "Sembako", unit: "CAN", cost: 14500, price: 18000, min: 12, stock: 36 },
  { name: "Blue Band Serbaguna 200g", category: "Sembako", unit: "PACK", cost: 12500, price: 15500, min: 12, stock: 20 },
  { name: "Sampoerna Mild 16", category: "Rokok", unit: "PACK", cost: 30500, price: 34000, min: 10, stock: 40 },
  { name: "Gudang Garam Surya 12", category: "Rokok", unit: "PACK", cost: 26500, price: 30000, min: 10, stock: 35 },
  { name: "Djarum Super 12", category: "Rokok", unit: "PACK", cost: 25500, price: 29000, min: 10, stock: 28 },
  { name: "Marlboro Merah 20", category: "Rokok", unit: "PACK", cost: 42000, price: 47000, min: 10, stock: 18 },
  { name: "Dji Sam Soe 12", category: "Rokok", unit: "PACK", cost: 27000, price: 30500, min: 10, stock: 22 },
  { name: "Sunlight Jeruk Nipis 750ml", category: "Perlengkapan Rumah", unit: "BTL", cost: 19500, price: 24000, min: 12, stock: 24 },
  { name: "Rinso Matic 800g", category: "Perlengkapan Rumah", unit: "PACK", cost: 22000, price: 27000, min: 12, stock: 20 },
  { name: "Downy Fresh 700ml", category: "Perlengkapan Rumah", unit: "BTL", cost: 23000, price: 28000, min: 12, stock: 16 },
  { name: "Baygon Aerosol 600ml", category: "Perlengkapan Rumah", unit: "CAN", cost: 32000, price: 39000, min: 6, stock: 12 },
  { name: "Sapu Ijuk", category: "Perlengkapan Rumah", unit: "PCS", cost: 18000, price: 25000, min: 4, stock: 8 },
  { name: "Ember Plastik 10L", category: "Perlengkapan Rumah", unit: "PCS", cost: 22000, price: 30000, min: 4, stock: 6 },
  { name: "Lilin Putih 10pcs", category: "Perlengkapan Rumah", unit: "PACK", cost: 8000, price: 12000, min: 6, stock: 10 },
  { name: "Pepsodent Herbal 190g", category: "Kebersihan", unit: "PCS", cost: 14500, price: 18000, min: 12, stock: 24 },
  { name: "Lifebuoy Sabun Batang 85g", category: "Kebersihan", unit: "PCS", cost: 4200, price: 6000, min: 24, stock: 60 },
  { name: "Pantene Shampoo 170ml", category: "Kebersihan", unit: "BTL", cost: 26000, price: 32000, min: 12, stock: 18 },
  { name: "Paseo Tissue 250 sheets", category: "Kebersihan", unit: "PACK", cost: 13500, price: 17000, min: 12, stock: 30 },
  { name: "Hand Sanitizer 100ml", category: "Kebersihan", unit: "BTL", cost: 9000, price: 13000, min: 12, stock: 20 },
  { name: "SGM Eksplor 1+ 400g", category: "Bayi & Anak", unit: "BOX", cost: 42000, price: 49000, min: 6, stock: 14 },
  { name: "Dancow Fortigro 400g", category: "Bayi & Anak", unit: "BOX", cost: 45000, price: 52000, min: 6, stock: 12 },
  { name: "Cerelac Beras Merah 120g", category: "Bayi & Anak", unit: "BOX", cost: 18000, price: 23000, min: 8, stock: 16 },
  { name: "Baterai ABC AA 4pcs", category: "Lainnya", unit: "PACK", cost: 12000, price: 16000, min: 8, stock: 18 },
  { name: "Korek Api Gas", category: "Lainnya", unit: "PCS", cost: 3000, price: 5000, min: 12, stock: 40 },
  { name: "Kantong Plastik 1kg", category: "Lainnya", unit: "PACK", cost: 9000, price: 13000, min: 6, stock: 12 },
];

async function resetCompanyData() {
  const tables = [
    "company_roles",
    "customer_group_discounts",
    "import_rows",
    "import_jobs",
    "outbox",
    "audit_log",
    "idempotency_keys",
    // A-24 T7: keluarga Catat Transaksi (quick_entry) — draf melekat
    // pada user demo yang dibuat ulang dengan id yang SAMA persis,
    // dan submissions adalah penyimpanan idempotensi paralel:
    // keduanya satu kelas dengan idempotency_keys di atas.
    "quick_entry_drafts",
    "quick_entry_submissions", "pos_pairing_codes", "pos_terminal_session_reviews", "pos_terminals", "pos_desktop_release_settings", "pos_promotions", // terakhir: Langkah 6–7 (0060–0061) + promo POS — anak FK dulu, induk terakhir, sebelum warehouses
    // FIX-R2 Tahap 3 (RV2-02): party_opening_balances WAJIB ikut
    // dibersihkan — tanpa baris ini reseed menumpuk dokumen saldo awal
    // yatim/duplikat (nomor dokumennya unik per perusahaan).
    "party_opening_balances",
    // A-22 K1 (temuan keadaan DB): keluarga mutasi bank WAJIB ikut
    // dibersihkan — tanpa baris ini baris mutasi hasil impor sesi
    // manual di perusahaan demo bertahan melewati reseed dan
    // bertabrakan dengan test rekonsiliasi. party_credits (A-21
    // R3-B) satu keluarga dengan party_payments: kredit yatim akan
    // tertinggal sementara pembayarannya terhapus.
    "bank_statement_lines",
    "bank_statement_imports",
    // A-24 T3 (celah terbukti di tahap itu): opname_tasks (migrasi
    // 0054) WAJIB ikut dibersihkan — tanpa baris ini tugas opname
    // hasil aktivitas demo bertahan melewati reseed sebagai yatim.
    "opname_tasks",
    "party_credits",
    "party_payments",
    // A-24 T7 (celah terbukti di tahap itu): keluarga HR operasional
    // WAJIB ikut dibersihkan — employees/payroll_runs/payroll_items
    // terhapus sementara anak & dokumen HR-nya (baris slip per
    // komponen, draf THR, absensi, cuti, lembur, kasbon, pinjaman,
    // klaim, riwayat, penugasan shift, master departemen/jabatan/
    // shift) tertinggal sebagai yatim ber-company_id demo.
    // leave_types ikut: jenis kustom akan menempel kembali;
    // 5 jenis bawaan ditanam ulang persis oleh
    // ensureDefaultLeaveTypes pada pemakaian pertama.
    // TIDAK ikut dengan sengaja: keluarga parameter statutori
    // payroll (ditanam ulang idempoten oleh
    // seedPayrollIndonesiaDefaults yang dipanggil seed ini sendiri)
    // dan hr_parameters (seedHrDefaults malas) — penjaga:
    // tests/unit/seed-reset-coverage.test.ts.
    "payroll_item_lines",
    "payroll_component_drafts",
    "employee_statutory_enrollments",
    "employee_advance_entries",
    "employee_advances",
    "employee_loan_entries",
    "employee_loans",
    "reimbursement_claims",
    "attendance_records",
    "overtime_requests",
    "leave_requests",
    "leave_types",
    "employee_shift_assignments",
    "work_shifts",
    "employee_history",
    "departments",
    "job_positions",
    "payroll_items",
    "payroll_runs",
    "employees",
    "bank_transfers",
    // A-24 T7 (TERBUKTI hidup): fixed_assets tidak dibersihkan —
    // aset "Etalase Kaca T4" (dari sesi bukti T4, 2026-11-05)
    // bertahan melewati db:seed --force yang dijalankan tahap ini.
    "fixed_asset_depreciations",
    "fixed_asset_depreciation_runs",
    "fixed_assets",
    "fixed_asset_categories",
    "expenses",
    "cash_movements",
    "cash_sessions",
    "sale_return_lines",
    "sale_returns",
    "sale_payments",
    "sale_lines",
    "sales",
    // A-24 T3 (celah terbukti di tahap itu): keluarga purchase order
    // WAJIB ikut dibersihkan — tanpa baris ini PO hasil aktivitas
    // demo bertahan melewati reseed dan nomor serinya bertabrakan
    // dengan test yang membuat PO pertama di perusahaan demo.
    "purchase_order_lines",
    "purchase_orders",
    // A-24 T7 (kelas celah yang sama dengan purchase_orders di T3):
    // purchase_requests adalah dokumen berseri (PRQ) — yatimnya
    // bertabrakan nomor dengan PR pertama sesudah reseed.
    "purchase_request_lines",
    "purchase_requests", "purchase_advance_allocations", "purchase_advances", // DP pemasok
    // A-24 T7 (TERBUKTI hidup): supplier_returns tidak dibersihkan —
    // dokumen RTB-2026-00001 (posted, dari sesi bukti 2026-11-04)
    // bertahan melewati db:seed --force yang dijalankan tahap ini,
    // sementara document_sequences ter-reset: retur berikutnya di
    // perusahaan demo akan menabrak nomor yang sama.
    "supplier_return_resolutions",
    "supplier_return_allocations",
    "supplier_return_lines",
    "supplier_returns",
    "stock_document_lines",
    "stock_documents",
    "stock_receipt_lines",
    "stock_receipts",
    // A-24 T7: keluarga stok turunan penerimaan (batch, nomor seri,
    // reservasi) — induknya (receipts/products/sales) terhapus,
    // baris-baris ini tertinggal yatim ber-company_id demo.
    "stock_batches",
    "stock_reservations",
    "stock_serial_movements",
    "stock_serials",
    "stock_movements",
    "stock_on_hand",
    "product_packagings", "products",
    "units",
    "categories",
    "suppliers",
    "customers",
    "customer_groups",
    // A-21 (temuan pemblokir gerbang, tindak lanjut tercatat AD-4):
    // tabel turunan FIX-ARS T2 WAJIB ikut dibersihkan — tanpa baris ini
    // reseed menyisakan baris ringkasan yatim dari aktivitas demo
    // ter-commit sebelum reseed (upsert agregat seed hanya menimpa
    // kombinasi yang ada di data seed baru, tidak menghapus sisanya),
    // dan penjaga consistency.test.ts gagal permanen sesudahnya.
    "account_monthly_balances",
    "journal_lines",
    "journal_entries",
    "fiscal_periods",
    "account_mappings",
    "accounts",
    "payment_methods",
    "company_settings",
    "warehouses",
    "branches",
    "document_sequences",
  ];
  await adminSql.begin(async (tx) => {
    await tx.unsafe("SET session_replication_role = replica");
    for (const table of tables) {
      await tx.unsafe(`DELETE FROM ${table} WHERE company_id = $1`, [ORG_ID]);
    }
    await tx.unsafe(`DELETE FROM member WHERE organization_id = $1`, [ORG_ID]);
    await tx.unsafe(`DELETE FROM organization WHERE id = $1`, [ORG_ID]);
    await tx.unsafe(`DELETE FROM account WHERE user_id = $1`, [USER_ID]);
    await tx.unsafe(`DELETE FROM "user" WHERE id = $1`, [USER_ID]);
  });
}
async function seed() {
  const force = process.argv.includes("--force");
  const bulk = process.argv.includes("--bulk");
  const owner = resolveSeedOwnerPassword({ isProduction: env.isProduction, argv: process.argv, ownerPassword: process.env.BISA_SEED_OWNER_PASSWORD });
  const existing = await adminDb
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, ORG_ID))
    .limit(1);
  if (existing.length > 0) {
    if (!force) {
      console.log("Seed sudah ada. Gunakan --force untuk mengulang dari awal.");
      return;
    }
    await resetCompanyData();
  }

  console.log("Membuat organisasi dan pengguna demo...");
  const passwordHash = await hashPassword(owner.password);
  await adminDb.insert(user).values({
    id: USER_ID,
    name: "Nadia Putri",
    email: "owner@bisa.id",
    emailVerified: true,
    role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(),
    accountId: USER_ID,
    providerId: "credential",
    userId: USER_ID,
    password: passwordHash,
  });
  await adminDb.insert(organization).values({
    id: ORG_ID,
    name: "Bisa Minimarket",
    slug: "bisa-minimarket",
    createdAt: new Date(),
  });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(),
    organizationId: ORG_ID,
    userId: USER_ID,
    role: "owner",
    createdAt: new Date(),
  });

  const [branch] = await adminDb
    .insert(branches)
    .values({
      companyId: ORG_ID,
      code: "BR-01",
      name: "Toko Utama",
      address: "Jl. Melati No. 21, Jakarta Selatan",
      phone: "021-555-0123",
      isDefault: true,
    })
    .returning();

  const warehouseRows = await adminDb
    .insert(warehouses)
    .values([
      {
        companyId: ORG_ID,
        branchId: branch.id,
        code: "GD-01",
        name: "Gudang Utama",
        type: "warehouse",
        isDefault: true,
      },
      {
        companyId: ORG_ID,
        branchId: branch.id,
        code: "GD-02",
        name: "Gudang Cadangan",
        type: "warehouse",
      },
      {
        companyId: ORG_ID,
        branchId: branch.id,
        code: "POS-01",
        name: "Rak Toko",
        type: "store",
      },
    ])
    .returning();
  const mainWarehouse = warehouseRows[0];

  await adminDb.insert(companySettings).values({
    companyId: ORG_ID,
    legalName: "Bisa Minimarket",
    taxId: "01.234.567.8-901.000",
    address: "Jl. Melati No. 21, Jakarta Selatan",
    phone: "021-555-0123",
    defaultWarehouseId: mainWarehouse.id,
    roundingMode: "nearest_500",
    // A-28 UI-2: footer nota demo = teks kaki mesin cetak (dulu receiptFooter warisan).
    printFooterText: "Terima kasih telah berbelanja.\nBarang yang sudah dibeli tidak dapat ditukar tanpa nota.",
    taxRate: "0",
  });

  const { mapping } = await seedDemoChart(adminDb, ORG_ID);

  // SIM-2 S2: konfigurasi Payroll Indonesia bawaan untuk perusahaan
  // demo — sama persis dengan backfill migrasi 0027 (saklar utama
  // NONAKTIF; payroll demo tetap generik sampai admin mengaktifkan).
  await seedPayrollIndonesiaDefaults(adminDb, ORG_ID);

  await adminDb.insert(paymentMethods).values([
    {
      companyId: ORG_ID,
      code: "CASH",
      name: "Tunai",
      type: "cash",
      accountId: mapping.cash,
      sortOrder: 1,
    },
    {
      companyId: ORG_ID,
      code: "QRIS",
      name: "QRIS",
      type: "qris",
      accountId: mapping.qris,
      sortOrder: 2,
      instructions: "Scan QRIS di layar kasir, lalu konfirmasi pembayaran.",
    },
    {
      companyId: ORG_ID,
      code: "TRANSFER",
      name: "Transfer Bank",
      type: "bank",
      accountId: mapping.bank,
      sortOrder: 3,
    },
    {
      companyId: ORG_ID,
      code: "CREDIT",
      name: "Utang / Tempo",
      type: "credit",
      accountId: mapping.receivable,
      sortOrder: 4,
    },
    {
      // D-12: penebusan kredit retur exchange/store_credit. Metode ini
      // tidak tampil di daftar metode biasa terminal — dipakai lewat alur
      // "Pakai Kredit Retur" dengan nomor dokumen retur sebagai referensi.
      companyId: ORG_ID,
      code: "CUSTCREDIT",
      name: "Kredit Pelanggan",
      type: "customer_credit",
      accountId: mapping.customer_credit,
      sortOrder: 5,
      instructions: "Masukkan nomor dokumen retur tukar barang/kredit toko.",
    },
  ]);

  const groupRows = await adminDb
    .insert(customerGroups)
    .values([
      { companyId: ORG_ID, name: "Umum", roundingStep: 0, roundingDirection: "down" },
      { companyId: ORG_ID, name: "Mahasiswa", roundingStep: 500, roundingDirection: "down" },
      { companyId: ORG_ID, name: "Karyawan", roundingStep: 500, roundingDirection: "nearest", roundCashTotal: true },
      { companyId: ORG_ID, name: "Grosir", roundingStep: 1000, roundingDirection: "down" },
    ])
    .returning();
  const group = new Map(groupRows.map((g) => [g.name, g.id]));

  const customerRows = await adminDb.insert(customers).values([
    {
      companyId: ORG_ID,
      code: "CUST-0000",
      name: "Pelanggan Umum",
      groupId: group.get("Umum"),
      creditLimit: "0",
    },
    {
      companyId: ORG_ID,
      code: "CUST-0001",
      name: "Budi Santoso",
      phone: "0812-1111-2222",
      groupId: group.get("Mahasiswa"),
      creditLimit: "500000",
    },
    {
      companyId: ORG_ID,
      code: "CUST-0002",
      name: "Siti Rahmawati",
      phone: "0813-3333-4444",
      groupId: group.get("Karyawan"),
      creditLimit: "1000000",
    },
    {
      companyId: ORG_ID,
      code: "CUST-0003",
      name: "Warung Bu Tini",
      phone: "0857-7777-8888",
      address: "Jl. Kenanga No. 8",
      groupId: group.get("Grosir"),
      creditLimit: "2000000",
    },
  ]).returning({ id: customers.id, code: customers.code });
  const customerByCode = new Map(customerRows.map((row) => [row.code, row.id]));

  const supplierRows = await adminDb
    .insert(suppliers)
    .values([
      { companyId: ORG_ID, code: "SUP-001", name: "PT Sumber Makmur", phone: "021-7000-111", address: "Cikarang" },
      { companyId: ORG_ID, code: "SUP-002", name: "CV Aneka Jaya", phone: "021-7000-222", address: "Tangerang" },
      { companyId: ORG_ID, code: "SUP-003", name: "PT Distribusi Nusantara", phone: "021-7000-333", address: "Bekasi" },
    ])
    .returning();

  const categoryRows = await adminDb
    .insert(categories)
    .values(
      [
        "Minuman",
        "Makanan Ringan",
        "Sembako",
        "Rokok",
        "Perlengkapan Rumah",
        "Kebersihan",
        "Bayi & Anak",
        "Lainnya",
      ].map((name) => ({ companyId: ORG_ID, name })),
    )
    .returning();
  const category = new Map(categoryRows.map((c) => [c.name, c.id]));

  const unitRows = await adminDb
    .insert(units)
    .values(
      [
        ["PCS", "Pieces"],
        ["BTL", "Botol"],
        ["BOX", "Kotak"],
        ["PACK", "Pak"],
        ["KG", "Kilogram"],
        ["LTR", "Liter"],
        ["SACHET", "Sachet"],
        ["CAN", "Kaleng"],
        ["POUCH", "Pouch"],
      ].map(([code, name]) => ({ companyId: ORG_ID, code, name })),
    )
    .returning();
  const unit = new Map(unitRows.map((u) => [u.code, u.id]));

  console.log(`Membuat ${bulk ? "10.200" : PRODUCTS.length} produk...`);
  const productValues = PRODUCTS.map((p, index) => ({
    companyId: ORG_ID,
    sku: `SKU-${String(index + 1).padStart(5, "0")}`,
    barcode: `899${String(1000000000 + index).padStart(10, "0")}`,
    name: p.name,
    categoryId: category.get(p.category),
    unitId: unit.get(p.unit),
    supplierId: supplierRows[index % supplierRows.length].id,
    costPrice: toDb(p.cost),
    salePrice: toDb(p.price),
    minStock: toDb(p.min),
    trackStock: true,
  }));

  if (bulk) {
    for (let i = PRODUCTS.length; i < 10200; i++) {
      const base = PRODUCTS[i % PRODUCTS.length];
      productValues.push({
        companyId: ORG_ID,
        sku: `SKU-${String(i + 1).padStart(5, "0")}`,
        barcode: `899${String(1000000000 + i).padStart(10, "0")}`,
        name: `${base.name} #${i + 1}`,
        categoryId: category.get(base.category),
        unitId: unit.get(base.unit),
        supplierId: supplierRows[i % supplierRows.length].id,
        costPrice: toDb(base.cost),
        salePrice: toDb(base.price),
        minStock: toDb(base.min),
        trackStock: true,
      });
    }
  }

  const insertedProducts: { id: string; name: string; cost: number; price: number }[] = [];
  for (let i = 0; i < productValues.length; i += 500) {
    const chunk = productValues.slice(i, i + 500);
    const rows = await adminDb.insert(products).values(chunk).returning({
      id: products.id,
      name: products.name,
      costPrice: products.costPrice,
      salePrice: products.salePrice,
    });
    insertedProducts.push(
      ...rows.map((r) => ({ id: r.id, name: r.name, cost: Number(r.costPrice), price: Number(r.salePrice) })),
    );
  }

  const ruleSeeds = [
    { group: "Mahasiswa", product: "Indomie Goreng", ruleType: "percent", value: "10" },
    { group: "Mahasiswa", product: "Aqua Air Mineral 600ml", ruleType: "percent", value: "10" },
    { group: "Karyawan", product: "Aqua Air Mineral 600ml", ruleType: "percent", value: "8" },
    { group: "Grosir", product: "Beras", ruleType: "fixed", value: "60000" },
  ];
  const ruleValues = ruleSeeds
    .map((rule) => {
      const productRow = insertedProducts.find((row) => row.name.startsWith(rule.product));
      const groupId = group.get(rule.group);
      if (!productRow || !groupId) return null;
      return {
        companyId: ORG_ID,
        groupId,
        productId: productRow.id,
        ruleType: rule.ruleType,
        value: rule.value,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (ruleValues.length > 0) {
    await adminDb.insert(customerGroupPrices).values(ruleValues);
  }

  await seedDemoPackaging(adminDb, ORG_ID, insertedProducts); console.log("Membuat stok awal dan jurnal pembukaan...");
  let inventoryValue = 0;
  const movementValues: (typeof stockMovements.$inferInsert)[] = [];
  const onHandValues: (typeof stockOnHand.$inferInsert)[] = [];
  insertedProducts.forEach((p, index) => {
    const base = PRODUCTS[index % PRODUCTS.length];
    const qty = bulk ? 40 + ((index * 17) % 160) : base.stock;
    inventoryValue += qty * p.cost;
    onHandValues.push({
      companyId: ORG_ID,
      warehouseId: mainWarehouse.id,
      productId: p.id,
      qty: toDb(qty),
    });
    movementValues.push({
      companyId: ORG_ID,
      warehouseId: mainWarehouse.id,
      productId: p.id,
      movementType: "opening",
      qty: toDb(qty),
      unitCost: toDb(p.cost),
      referenceType: "opening",
      referenceNumber: `OPEN-${YEAR}`,
      reason: "Stok awal",
      createdBy: USER_ID,
    });
  });
  for (let i = 0; i < movementValues.length; i += 1000) {
    await adminDb.insert(stockMovements).values(movementValues.slice(i, i + 1000));
  }
  for (let i = 0; i < onHandValues.length; i += 1000) {
    await adminDb.insert(stockOnHand).values(onHandValues.slice(i, i + 1000));
  }

  const cashOpening = 50_000_000;
  await adminDb.transaction(async (tx) => {
    const openingEntry = await tx
      .insert(journalEntries)
      .values({
        companyId: ORG_ID,
        number: `JE-${YEAR}-00001`,
        date: `${YEAR}-01-01`,
        description: "Saldo awal usaha",
        sourceType: "opening",
        status: "posted",
        createdBy: USER_ID,
        postedAt: new Date(),
      })
      .returning({ id: journalEntries.id });

    await tx.insert(journalLines).values([
      {
        companyId: ORG_ID,
        entryId: openingEntry[0].id,
        accountId: mapping.cash,
        debit: toDb(cashOpening),
        credit: "0",
        description: "Kas awal",
        lineNo: 1,
      },
      {
        companyId: ORG_ID,
        entryId: openingEntry[0].id,
        accountId: mapping.inventory,
        debit: toDb(inventoryValue),
        credit: "0",
        description: "Persediaan awal",
        lineNo: 2,
      },
      {
        companyId: ORG_ID,
        entryId: openingEntry[0].id,
        accountId: mapping.equity,
        debit: "0",
        credit: toDb(cashOpening + inventoryValue),
        description: "Modal awal",
        lineNo: 3,
      },
    ]);
  });


  // FIX-R2 Tahap 3 (RV2-02): data demo AR/AP yang bisa didemokan.
  // Audit R2 membuktikan perusahaan demo steril dari sisi piutang/utang
  // (0 dokumen) sehingga fitur penagihan/aging tidak bisa ditunjukkan.
  // Ditambahkan dokumen SALDO AWAL (party_opening_balances) yang meniru
  // persis createOpeningBalance: jurnal sourceType "opening_balance"
  // bertag pihak melawan ekuitas, journalId terisi, stok TIDAK bergerak
  // — baseline demo (65 produk, nilai persediaan) tidak berubah.
  // Jatuh tempo relatif terhadap hari seed dijalankan: satu dokumen
  // tiap sisi sudah lewat tempo, satu masih berjalan.
  const supplierByCode = new Map(supplierRows.map((row) => [row.code, row.id]));
  const isoDay = (offsetDays: number) => {
    const dt = new Date();
    dt.setDate(dt.getDate() + offsetDays);
    return dt.toISOString().slice(0, 10);
  };
  const demoOpeningDocs = [
    {
      number: `OPR-${YEAR}-00001`,
      kind: "receivable" as const,
      partyType: "customer" as const,
      partyId: customerByCode.get("CUST-0001")!,
      partyName: "Budi Santoso",
      date: isoDay(-40),
      dueDate: isoDay(-10),
      amount: 750_000,
      reference: "INV-LAMA-0117",
    },
    {
      number: `OPR-${YEAR}-00002`,
      kind: "receivable" as const,
      partyType: "customer" as const,
      partyId: customerByCode.get("CUST-0003")!,
      partyName: "Warung Bu Tini",
      date: isoDay(-5),
      dueDate: isoDay(25),
      amount: 1_250_000,
      reference: "INV-LAMA-0129",
    },
    {
      number: `OPB-${YEAR}-00001`,
      kind: "payable" as const,
      partyType: "supplier" as const,
      partyId: supplierByCode.get("SUP-001")!,
      partyName: "PT Sumber Makmur",
      date: isoDay(-35),
      dueDate: isoDay(-5),
      amount: 2_400_000,
      reference: "FAKTUR-SM-2210",
    },
    {
      number: `OPB-${YEAR}-00002`,
      kind: "payable" as const,
      partyType: "supplier" as const,
      partyId: supplierByCode.get("SUP-002")!,
      partyName: "CV Aneka Jaya",
      date: isoDay(-3),
      dueDate: isoDay(27),
      amount: 1_600_000,
      reference: "FAKTUR-AJ-0871",
    },
  ];
  await adminDb.transaction(async (tx) => {
    let journalSeq = 2; // JE-${YEAR}-00001 sudah dipakai jurnal pembuka.
    for (const doc of demoOpeningDocs) {
      const isPayable = doc.kind === "payable";
      const [entry] = await tx
        .insert(journalEntries)
        .values({
          companyId: ORG_ID,
          number: `JE-${YEAR}-${String(journalSeq++).padStart(5, "0")}`,
          date: doc.date,
          description: isPayable
            ? `Saldo awal utang ${doc.number} — ${doc.partyName}`
            : `Saldo awal piutang ${doc.number} — ${doc.partyName}`,
          sourceType: "opening_balance",
          status: "posted",
          createdBy: USER_ID,
          postedAt: new Date(),
        })
        .returning({ id: journalEntries.id });
      await tx.insert(journalLines).values(
        isPayable
          ? [
              {
                companyId: ORG_ID,
                entryId: entry.id,
                accountId: mapping.equity,
                debit: toDb(doc.amount),
                credit: "0",
                description: "Ekuitas pembuka saldo awal utang",
                lineNo: 1,
              },
              {
                companyId: ORG_ID,
                entryId: entry.id,
                accountId: mapping.payable,
                debit: "0",
                credit: toDb(doc.amount),
                description: `Saldo awal utang ${doc.reference}`,
                partyType: doc.partyType,
                partyId: doc.partyId,
                lineNo: 2,
              },
            ]
          : [
              {
                companyId: ORG_ID,
                entryId: entry.id,
                accountId: mapping.receivable,
                debit: toDb(doc.amount),
                credit: "0",
                description: `Saldo awal piutang ${doc.reference}`,
                partyType: doc.partyType,
                partyId: doc.partyId,
                lineNo: 1,
              },
              {
                companyId: ORG_ID,
                entryId: entry.id,
                accountId: mapping.equity,
                debit: "0",
                credit: toDb(doc.amount),
                description: "Ekuitas pembuka saldo awal piutang",
                lineNo: 2,
              },
            ],
      );
      await tx.insert(partyOpeningBalances).values({
        companyId: ORG_ID,
        number: doc.number,
        kind: doc.kind,
        partyType: doc.partyType,
        partyId: doc.partyId,
        date: doc.date,
        dueDate: doc.dueDate,
        amount: toDb(doc.amount),
        paidAmount: "0",
        status: "open",
        journalId: entry.id,
        reference: doc.reference,
        notes: "Saldo awal saat migrasi ke Bisa ERP (data demo).",
        createdBy: USER_ID,
      });
    }
  });

  // FIX-ARS Tahap 2 (ARS3-01): seed menulis jurnal pembuka & saldo awal
  // LANGSUNG (bypass postJournal, gerbang aplikasi), jadi ringkasan
  // saldo bulanan untuk perusahaan demo diisi di sini dengan agregat
  // yang sama seperti backfill migrasi 0046 — bila tidak, laporan
  // hibrida perusahaan hasil seed akan kehilangan jurnal-jurnal ini
  // pada bulan-bulan penuh. Seed berjalan di atas perusahaan kosong,
  // jadi upsert agregat penuh ini idempoten terhadap data seed sendiri.
  await adminDb.execute(sql`
    INSERT INTO "account_monthly_balances" ("company_id", "account_id", "year_month", "total_debit", "total_credit")
    SELECT jl."company_id", jl."account_id", to_char(je."date", 'YYYY-MM'), sum(jl."debit"), sum(jl."credit")
    FROM "journal_lines" jl
    INNER JOIN "journal_entries" je ON je."id" = jl."entry_id"
    WHERE je."status" = 'posted' AND jl."company_id" = ${ORG_ID}
    GROUP BY jl."company_id", jl."account_id", to_char(je."date", 'YYYY-MM')
    ON CONFLICT ("company_id", "account_id", "year_month") DO UPDATE SET
      "total_debit" = EXCLUDED."total_debit",
      "total_credit" = EXCLUDED."total_credit"
  `);

  await adminDb.insert(fiscalPeriods).values(
    Array.from({ length: 12 }, (_, i) => ({
      companyId: ORG_ID,
      year: YEAR,
      month: i + 1,
      status: i + 1 < new Date().getMonth() + 1 ? "closed" : "open",
    })),
  );

  // FIX-P1 Tahap 3 (AK1-01): materialisasi periode — tahun berikutnya
  // juga selalu dibuat terbuka sejak perusahaan lahir, selaras dengan
  // jendela materialisasi otomatis di assertPeriodOpen (tahun berjalan
  // & tahun berikutnya). Tahun lain dibuat eksplisit oleh owner.
  await adminDb.insert(fiscalPeriods).values(
    Array.from({ length: 12 }, (_, i) => ({
      companyId: ORG_ID,
      year: YEAR + 1,
      month: i + 1,
      status: "open",
    })),
  );

  await adminDb.insert(employees).values([
    {
      companyId: ORG_ID,
      code: "EMP-001",
      name: "Nadia Putri",
      position: "Store Manager",
      baseSalary: "6500000",
      allowances: "750000",
      deductions: "150000",
      joinedAt: `${YEAR}-01-05`,
    },
    {
      companyId: ORG_ID,
      code: "EMP-002",
      name: "Rizky Pratama",
      position: "Kasir",
      baseSalary: "4200000",
      allowances: "350000",
      deductions: "100000",
      joinedAt: `${YEAR}-02-01`,
    },
    {
      companyId: ORG_ID,
      code: "EMP-003",
      name: "Dewi Lestari",
      position: "Kasir",
      baseSalary: "4200000",
      allowances: "350000",
      deductions: "100000",
      joinedAt: `${YEAR}-03-01`,
    },
    {
      companyId: ORG_ID,
      code: "EMP-004",
      name: "Agus Salim",
      position: "Staff Gudang",
      baseSalary: "4000000",
      allowances: "300000",
      deductions: "100000",
      joinedAt: `${YEAR}-04-01`,
    },
  ]);

  await adminDb.insert(documentSequences).values([
    { companyId: ORG_ID, docType: "SALE", fiscalYear: YEAR, prefix: "INV", nextNumber: 1 },
    { companyId: ORG_ID, docType: "SALE_RETURN", fiscalYear: YEAR, prefix: "RTN", nextNumber: 1 },
    { companyId: ORG_ID, docType: "RECEIPT", fiscalYear: YEAR, prefix: "RCV", nextNumber: 1 },
    { companyId: ORG_ID, docType: "ADJUSTMENT", fiscalYear: YEAR, prefix: "ADJ", nextNumber: 1 },
    { companyId: ORG_ID, docType: "TRANSFER", fiscalYear: YEAR, prefix: "TRF", nextNumber: 1 },
    { companyId: ORG_ID, docType: "OPNAME", fiscalYear: YEAR, prefix: "OPN", nextNumber: 1 },
    // FIX-R2 Tahap 3 (RV2-02): JE-…-00002 s.d. 00005 dipakai jurnal
    // empat dokumen saldo awal demo di atas — penomoran jurnal
    // berikutnya mulai dari 6 agar tidak bertabrakan.
    { companyId: ORG_ID, docType: "JOURNAL", fiscalYear: YEAR, prefix: "JE", nextNumber: 6 },
    { companyId: ORG_ID, docType: "OPENING_PAYABLE", fiscalYear: YEAR, prefix: "OPB", nextNumber: 3 },
    { companyId: ORG_ID, docType: "OPENING_RECEIVABLE", fiscalYear: YEAR, prefix: "OPR", nextNumber: 3 },
    { companyId: ORG_ID, docType: "EXPENSE", fiscalYear: YEAR, prefix: "EXP", nextNumber: 1 },
    { companyId: ORG_ID, docType: "BANK_TRANSFER", fiscalYear: YEAR, prefix: "BTF", nextNumber: 1 },
    { companyId: ORG_ID, docType: "PAYMENT", fiscalYear: YEAR, prefix: "PAY", nextNumber: 1 },
    { companyId: ORG_ID, docType: "PAYROLL", fiscalYear: YEAR, prefix: "PRL", nextNumber: 1 },
  ]);

  const [session] = await adminDb
    .insert(cashSessions)
    .values({
      companyId: ORG_ID,
      branchId: branch.id,
      userId: USER_ID,
      openingCash: "500000",
      status: "open",
    })
    .returning({ id: cashSessions.id });
  await adminDb.insert(cashMovements).values({
    companyId: ORG_ID,
    sessionId: session.id,
    type: "opening",
    amount: "500000",
    createdBy: USER_ID,
  });

  console.log("Seed selesai.");
  console.log(seedOwnerLoginMessage(owner));
  console.log(`Produk: ${insertedProducts.length}, nilai persediaan: ${inventoryValue.toFixed(0)}`);
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await adminSql.end();
  });
