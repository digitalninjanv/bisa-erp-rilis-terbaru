// A-26 Q4 (K-03): pecahan src/server/actions/accounting.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).
"use server";
import {
  and,
  eq,
  sql,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import {
  accountMappings,
  accounts,
  customerGroups,
  journalLines,
  paymentMethods,
} from "@/db/schema";
import { postOwnerCapital } from "@/server/accounting-capital";
import {
  getAccountImpact,
  type AccountImpact,
} from "@/server/account-impact";
import { writeAudit } from "@/server/audit";
import { requirePermissionInModule } from "@/lib/session";
import {
  AppError,
  guard,
} from "@/lib/errors";
import {
  isoDate,
  moneyString,
  parseInput,
} from "@/lib/action-validation";
import {
  ACCOUNT_MAPPING_KEYS,
  mappingAccountTypes,
  mappingAllowsAccountType,
  MAPPING_LABELS,
} from "@/lib/account-mappings";
import {
  ACCOUNT_SECTIONS,
  ACCOUNT_TYPE_LABELS,
  isAccountSectionAllowed,
  type AccountSection,
} from "@/lib/accounting";
import {
  defaultPsak118Tags,
  EXPENSE_FUNCTIONS,
  EXPENSE_NATURES,
  PSAK118_CATEGORIES,
  type ExpenseFunction,
  type ExpenseNature,
  type Psak118Category,
  type Psak118Tags,
} from "@/lib/akuntansi/psak118";
import {
  d,
  formatIDR,
  toDb,
} from "@/lib/money";
const accountSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(1).max(20),
  name: z.string().min(2).max(120),
  type: z.enum(["asset", "liability", "equity", "revenue", "expense", "cogs"]),
  normalBalance: z.enum(["debit", "credit"]),
  parentId: z.string().uuid().nullish(),
  section: z
    .enum([
      "current_asset",
      "non_current_asset",
      "current_liability",
      "non_current_liability",
      "equity",
      "revenue",
      "other_income",
      "cogs",
      "operating_expense",
      "other_expense",
    ])
    .nullish(),
  cashFlowGroup: z.enum(["operating", "investing", "financing"]).nullish(),
  // A-27 B3: kelas kas/bank + rincian bank (kolom B1). Kelas adalah
  // sifat akun; rincian hanya bermakna untuk kelas "bank" (pola
  // Accurate — kondisional per kelas, ditegakkan di
  // assertCashBankCoherence di bawah).
  cashBankKind: z.enum(["cash", "bank", "clearing"]).nullish(),
  bankName: z.string().max(120).nullish(),
  bankAccountNumber: z.string().max(40).nullish(),
  bankBranch: z.string().max(120).nullish(),
  bankAccountHolder: z.string().max(120).nullish(),
  currency: z.string().min(3).max(3).nullish(),
  // A-27 B5: tagging PSAK 118 + penanda kontra. Daftar nilai berasal
  // dari lib/akuntansi/psak118.ts (satu rumah); koherensinya terhadap
  // tipe akun ditegakkan assertPsak118Coherence di bawah. Bidang yang
  // TIDAK dikirim (undefined) berarti: buat → bawaan deterministik,
  // ubah → nilai lama dipertahankan; null eksplisit = tag dikosongkan.
  psak118Category: z.enum(Object.keys(PSAK118_CATEGORIES) as [Psak118Category, ...Psak118Category[]]).nullish(),
  expenseNature: z.enum(Object.keys(EXPENSE_NATURES) as [ExpenseNature, ...ExpenseNature[]]).nullish(),
  expenseFunction: z.enum(Object.keys(EXPENSE_FUNCTIONS) as [ExpenseFunction, ...ExpenseFunction[]]).nullish(),
  isContra: z.boolean().optional(),
  contraOf: z.string().uuid().nullish(),
  description: z.string().max(300).nullish(),
  isPostable: z.boolean().optional(),
  isActive: z.boolean().optional(),
  // A-27 B4 (F-05): penonaktifan akun bersaldo ≠ 0 hanya berjalan
  // dengan konfirmasi eksplisit ini (pratinjau dampak di formulir);
  // saldo TIDAK dipindahkan otomatis — tidak ada jurnal otomatis.
  confirmDeactivateWithBalance: z.boolean().optional(),
});
type AccountInputData = z.infer<typeof accountSchema>;
/**
 * A-27 B3: koherensi minimal KHUSUS kelas kas/bank (koherensi umum
 * type↔section adalah wilayah B4 — jangan melebar ke sini):
 * - akun berkelas wajib tipe Aset dan kelompok Aset Lancar (section
 *   kosong diartikan current_asset dan disimpan demikian);
 * - kelas "bank" wajib punya nama bank + nomor rekening (rincian
 *   adalah identitas rekening; tanpanya akun bank tak dapat dikenali
 *   di daftar/rekonsiliasi);
 * - kelas selain "bank" tidak menyimpan rincian bank (dibersihkan
 *   di pemanggil) dan mata uang kembali ke bawaan IDR di pemanggil.
 * Mengembalikan section efektif yang harus disimpan.
 */
function assertCashBankCoherence(data: AccountInputData): string | null {
  const section = data.section ?? null;
  if (!data.cashBankKind) return section;
  if (data.type !== "asset") {
    throw new AppError(
      "VALIDATION",
      "Akun berkelas kas/bank wajib bertipe Aset. Ubah tipe akun menjadi Aset atau kosongkan kelas kas/bank.",
    );
  }
  if (section !== null && section !== "current_asset") {
    throw new AppError(
      "VALIDATION",
      "Akun berkelas kas/bank wajib masuk kelompok laporan Aset Lancar.",
    );
  }
  if (data.cashBankKind === "bank") {
    if (!data.bankName?.trim() || !data.bankAccountNumber?.trim()) {
      throw new AppError(
        "VALIDATION",
        "Akun berkelas Bank wajib diisi nama bank dan nomor rekening.",
      );
    }
  }
  return "current_asset";
}
/**
 * A-27 B4 (F-10): matriks koherensi tipe ↔ kelompok laporan (section).
 * Taksonomi tipe/section sendiri tetap tertutup (sesuai praktik
 * terbaik); yang ditambahkan di sini adalah penolakan pasangan yang
 * tidak koheren — akun Beban tidak boleh masuk kelompok Aset Lancar,
 * dst. Section kosong (otomatis dari tipe) selalu lolos. Saldo normal
 * TIDAK divalidasi terhadap matriks ini: akun kontra adalah
 * pengecualian sah (4010 debit di pendapatan, 1510 kredit di aset).
 */
function assertTypeSectionCoherence(data: AccountInputData, section: string | null): void {
  if (!section) return;
  if (!isAccountSectionAllowed(data.type, section)) {
    throw new AppError(
      "VALIDATION",
      `Akun bertipe ${ACCOUNT_TYPE_LABELS[data.type]} tidak dapat masuk kelompok laporan "${ACCOUNT_SECTIONS[section as AccountSection] ?? section}". Pilih kelompok laporan yang sesuai dengan tipe akun.`,
    );
  }
}
function assertPsak118Coherence(type: AccountInputData["type"], tags: Psak118Tags): void {
  if (tags.psak118Category && !["revenue", "cogs", "expense"].includes(type)) {
    throw new AppError(
      "VALIDATION",
      `Kategori PSAK 118 hanya untuk akun laba rugi (Pendapatan, HPP, Beban). Akun bertipe ${ACCOUNT_TYPE_LABELS[type]} tidak membawa kategori presentasi — kosongkan kategori PSAK 118.`,
    );
  }
  if ((tags.expenseNature || tags.expenseFunction) && !["cogs", "expense"].includes(type)) {
    throw new AppError(
      "VALIDATION",
      `Sifat & fungsi beban hanya untuk akun HPP dan Beban. Akun bertipe ${ACCOUNT_TYPE_LABELS[type]} tidak membawa sifat/fungsi beban — kosongkan keduanya.`,
    );
  }
}
/**
 * A-27 B5: resolusi tag efektif. Bidang tak terkirim (undefined) pada
 * pembuatan jatuh ke bawaan deterministik defaultPsak118Tags; pada
 * perubahan, pemanggil mengoper nilai lama sebagai `fallback` sehingga
 * tag hasil penyesuaian akuntan tidak tertimpa simpan yang tidak
 * menyentuh tag. Null eksplisit selalu berarti dikosongkan.
 */
function resolvePsak118Tags(
  data: AccountInputData,
  section: string | null,
  fallback?: Psak118Tags,
): Psak118Tags {
  const base = fallback ?? defaultPsak118Tags(data.type, section);
  return {
    psak118Category:
      data.psak118Category === undefined ? base.psak118Category : data.psak118Category,
    expenseNature: data.expenseNature === undefined ? base.expenseNature : data.expenseNature,
    expenseFunction:
      data.expenseFunction === undefined ? base.expenseFunction : data.expenseFunction,
  };
}
/**
 * A-27 B4 (F-05): ikatan yang menghalangi penonaktifan — cek referensi
 * yang sama relevannya dengan deleteAccountAction (pemetaan, metode
 * pembayaran, akun diskon kelompok harga) ditambah status induk.
 * Mengembalikan daftar frasa bernama utk pesan penolakan; kosong
 * berarti akun bebas ikatan. Sumber datanya SATU: getAccountImpact.
 */
function deactivationBindings(impact: AccountImpact): string[] {
  const parts: string[] = [];
  if (impact.mappingKeys.length > 0) {
    parts.push(`pemetaan akun (${impact.mappingKeys.map((row) => `"${row.label}"`).join(", ")})`);
  }
  if (impact.paymentMethods.length > 0) {
    parts.push(
      `metode pembayaran (${impact.paymentMethods.map((row) => `${row.code} — ${row.name}`).join(", ")})`,
    );
  }
  if (impact.discountGroups.length > 0) {
    parts.push(
      `akun diskon kelompok harga (${impact.discountGroups.map((row) => row.name).join(", ")})`,
    );
  }
  if (impact.children.length > 0) {
    parts.push(
      `induk dari ${impact.children.length} sub-akun (${impact.children.map((row) => row.code).join(", ")})`,
    );
  }
  return parts;
}
export async function saveAccountAction(input: z.input<typeof accountSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(accountSchema, input);
    // A-27 B3: nilai kelas/rincian efektif — rincian bank hanya hidup
    // untuk kelas "bank"; kelas lain membersihkannya agar data lama
    // tidak tertinggal saat akun berganti kelas.
    const effectiveSection = assertCashBankCoherence(data);
    // A-27 B4 (F-10): koherensi umum tipe ↔ kelompok laporan.
    assertTypeSectionCoherence(data, effectiveSection);
    // A-27 B5: tag PSAK 118 efektif utk jalur buat (bawaan
    // deterministik bila tak dikirim); jalur ubah meresolusi ulang di
    // dalam transaksi dgn fallback nilai lama. Penanda kontra: flag
    // mati memaksa tautan kosong.
    const createTags = resolvePsak118Tags(data, effectiveSection);
    assertPsak118Coherence(data.type, createTags);
    const createIsContra = data.isContra ?? false;
    const createContraOf = createIsContra ? (data.contraOf ?? null) : null;
    const isBank = data.cashBankKind === "bank";
    const bankFields = {
      cashBankKind: data.cashBankKind ?? null,
      bankName: isBank ? data.bankName!.trim() : null,
      bankAccountNumber: isBank ? data.bankAccountNumber!.trim() : null,
      bankBranch: isBank ? data.bankBranch?.trim() || null : null,
      bankAccountHolder: isBank ? data.bankAccountHolder?.trim() || null : null,
      currency: isBank ? (data.currency ?? "IDR").toUpperCase() : "IDR",
    };
    const result = await withCompany(ctx.company.id, async (tx) => {
      // A-27 B5: tautan kontra wajib menunjuk akun yang ADA, sekantor,
      // dan bukan akun itu sendiri — kontra yang menggantung membuat
      // pembaca tag tidak dapat memasangkan akun pengurangnya.
      const assertContraTarget = async (contraOf: string | null, selfId?: string) => {
        if (!contraOf) return;
        if (selfId && contraOf === selfId) {
          throw new AppError(
            "VALIDATION",
            "Akun tidak boleh menjadi akun kontra dari dirinya sendiri. Pilih akun lain sebagai akun yang dikontra.",
          );
        }
        const [target] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.companyId, ctx.company.id), eq(accounts.id, contraOf)))
          .limit(1);
        if (!target) {
          throw new AppError(
            "VALIDATION",
            "Akun yang dikontra tidak ditemukan untuk perusahaan ini. Pilih akun dari bagan akun perusahaan ini.",
          );
        }
      };
      if (data.id && data.parentId === data.id) {
        throw new AppError("VALIDATION", "Akun tidak boleh menjadi induk dirinya sendiri.");
      }
      if (data.parentId) {
        // A-27 B4 (F-06): penjaga hierarki saat tulis — (i) induk wajib
        // akun header (tidak bisa dipakai posting); (iii) anti-siklus:
        // telusuri rantai induk dari calon induk, akun ini tidak boleh
        // muncul di rantainya sendiri.
        const [parent] = await tx
          .select({
            id: accounts.id,
            code: accounts.code,
            name: accounts.name,
            isPostable: accounts.isPostable,
          })
          .from(accounts)
          .where(and(eq(accounts.companyId, ctx.company.id), eq(accounts.id, data.parentId)))
          .limit(1);
        if (!parent) throw new AppError("NOT_FOUND", "Akun induk tidak ditemukan.");
        if (parent.isPostable) {
          throw new AppError(
            "VALIDATION",
            `Akun induk ${parent.code} (${parent.name}) masih bisa dipakai posting. Akun induk wajib akun header — matikan "Bisa dipakai posting" pada akun induk tersebut terlebih dahulu, atau pilih induk lain.`,
          );
        }
        if (data.id) {
          let cursor: string | null = data.parentId;
          const seen = new Set<string>();
          while (cursor) {
            if (cursor === data.id) {
              throw new AppError(
                "VALIDATION",
                "Hierarki akun akan membentuk lingkaran: akun tidak boleh menjadi keturunan dari dirinya sendiri. Pilih akun induk lain.",
              );
            }
            if (seen.has(cursor)) break;
            seen.add(cursor);
            const [chainRow] = await tx
              .select({ parentId: accounts.parentId })
              .from(accounts)
              .where(and(eq(accounts.companyId, ctx.company.id), eq(accounts.id, cursor)))
              .limit(1);
            cursor = chainRow?.parentId ?? null;
          }
        }
      }
      if (data.id) {
        // AK-P2-10: update id yang tidak ada bukan sukses semu, dan tipe akun
        // yang sudah punya baris jurnal tidak boleh diganti — laporan
        // mengelompokkan dari atribut akun saat ini, jadi mengganti tipe akan
        // mengubah klasifikasi seluruh riwayat tanpa jejak.
        const [existing] = await tx
          .select({
            id: accounts.id,
            code: accounts.code,
            name: accounts.name,
            type: accounts.type,
            section: accounts.section,
            normalBalance: accounts.normalBalance,
            isPostable: accounts.isPostable,
            isActive: accounts.isActive,
            currency: accounts.currency,
            psak118Category: accounts.psak118Category,
            expenseNature: accounts.expenseNature,
            expenseFunction: accounts.expenseFunction,
            isContra: accounts.isContra,
            contraOf: accounts.contraOf,
          })
          .from(accounts)
          .where(and(eq(accounts.companyId, ctx.company.id), eq(accounts.id, data.id)))
          .limit(1);
        if (!existing) throw new AppError("NOT_FOUND", "Akun tidak ditemukan.");
        if (existing.type !== data.type) {
          const [used] = await tx
            .select({ value: sql<number>`count(*)::int` })
            .from(journalLines)
            .where(and(eq(journalLines.companyId, ctx.company.id), eq(journalLines.accountId, data.id)));
          if ((used?.value ?? 0) > 0) {
            throw new AppError(
              "VALIDATION",
              `Tipe akun ${existing.code} tidak dapat diubah karena akun sudah memiliki baris jurnal; mengubah tipe akan mengubah klasifikasi seluruh riwayat laporan. Nonaktifkan akun ini dan buat akun baru bila perlu.`,
            );
          }
        }
        // A-27 B4: seluruh penjaga jalur ubah membaca SATU sumber
        // dampak (getAccountImpact) — data yang sama yang ditampilkan
        // pratinjau dampak di halaman detail/formulir akun.
        const impact = await getAccountImpact(tx, ctx.company.id, data.id);
        if (!impact) throw new AppError("NOT_FOUND", "Akun tidak ditemukan.");

        // (F-06 ii/iv): akun yang memiliki anak adalah header — tidak
        // boleh dijadikan akun posting selama anaknya masih ada.
        if ((data.isPostable ?? true) && impact.children.length > 0) {
          throw new AppError(
            "CONFLICT",
            `Akun ${existing.code} (${impact.name}) masih menjadi induk dari ${impact.children.length} sub-akun dan tidak dapat dijadikan akun posting. Pindahkan sub-akunnya terlebih dahulu.`,
          );
        }

        // Akun yang sudah memiliki jurnal tidak boleh berhenti menjadi
        // postable: laporan laba rugi membaca akun postable, sehingga
        // seluruh histori akun akan hilang dari P&L sementara neraca
        // tetap memuatnya.
        if (existing.isPostable && data.isPostable === false && impact.journalLineCount > 0) {
          throw new AppError(
            "CONFLICT",
            `Akun ${existing.code} (${impact.name}) sudah memiliki ${impact.journalLineCount} baris jurnal dan tidak dapat dijadikan non-posting. Nonaktifkan akun dengan konfirmasi saldo, atau buat akun baru.`,
          );
        }

        // RENCANA §2: mata uang rekening tidak dapat diubah sesudah
        // akun bertransaksi — mengubahnya mengubah arti saldo tercatat.
        if (bankFields.currency !== existing.currency && impact.journalLineCount > 0) {
          throw new AppError(
            "CONFLICT",
            `Mata uang akun ${existing.code} tidak dapat diubah dari ${existing.currency} menjadi ${bankFields.currency} karena akun sudah memiliki ${impact.journalLineCount} baris jurnal; mengubah mata uang akan mengubah arti saldo yang sudah tercatat.`,
          );
        }

        // MD-015: saldo normal dan kelompok laporan (section) tidak dapat diubah jika sudah ada baris jurnal
        if (existing.normalBalance !== data.normalBalance && impact.journalLineCount > 0) {
          throw new AppError("CONFLICT", `Saldo normal akun ${existing.code} (${existing.normalBalance.toUpperCase()}) tidak dapat diubah menjadi ${data.normalBalance.toUpperCase()} karena akun sudah memiliki ${impact.journalLineCount} baris jurnal.`);
        }
        if (existing.section !== effectiveSection && impact.journalLineCount > 0) {
          throw new AppError("CONFLICT", `Kelompok laporan akun ${existing.code} tidak dapat diubah dari ${existing.section} menjadi ${effectiveSection} karena akun sudah memiliki ${impact.journalLineCount} baris jurnal.`);
        }

        // (F-05): penonaktifan setara penjaga hapus utk ikatan
        // (CONFLICT bernama yang menyebut ikatannya), dan penonaktifan
        // bersaldo ≠ 0 wajib konfirmasi eksplisit — tanpa jurnal
        // otomatis pemindah saldo (anti-pola QBO, riset §5.3).
        if (existing.isActive && data.isActive === false) {
          const bindings = deactivationBindings(impact);
          if (bindings.length > 0) {
            throw new AppError(
              "CONFLICT",
              `Akun ${impact.code} (${impact.name}) belum dapat dinonaktifkan karena masih terikat: ${bindings.join("; ")}. Tunjuk ulang ikatan tersebut ke akun lain terlebih dahulu, lalu nonaktifkan.`,
            );
          }
          if (!d(impact.balance).isZero() && !data.confirmDeactivateWithBalance) {
            throw new AppError(
              "CONFLICT",
              `Akun ${impact.code} (${impact.name}) masih memiliki saldo ${formatIDR(impact.balance)} dari ${impact.journalLineCount} baris jurnal. Menonaktifkan akun tidak memindahkan saldonya — aktifkan konfirmasi penonaktifan bersaldo pada formulir bila memang disengaja.`,
            );
          }
        }

        // (F-05/F-08): kode akun DAPAT diedit — jurnal & pemetaan
        // mereferensikan accountId, bukan kode, jadi penggantian kode
        // aman secara mekanis. Penjaganya: unik per perusahaan (pesan
        // ramah yang sama seperti pembuatan) dan jejak audit
        // account.code_change. Kode yang sama persis = no-op: tidak
        // dicek, tidak diaudit.
        const codeChanged = data.code !== existing.code;
        if (codeChanged) {
          const [clash] = await tx
            .select({ id: accounts.id })
            .from(accounts)
            .where(and(eq(accounts.companyId, ctx.company.id), eq(accounts.code, data.code)))
            .limit(1);
          if (clash) {
            throw new AppError(
              "VALIDATION",
              "Kode akun tersebut sudah digunakan. Gunakan kode akun yang lain.",
            );
          }
        }

        // A-27 B5: tag jalur ubah — bidang tak terkirim mempertahankan
        // nilai lama (penyesuaian akuntan tidak tertimpa), null
        // eksplisit mengosongkan; kontra mengikuti resolusi yang sama.
        const tags = resolvePsak118Tags(data, effectiveSection, {
          psak118Category: existing.psak118Category as Psak118Category | null,
          expenseNature: existing.expenseNature as ExpenseNature | null,
          expenseFunction: existing.expenseFunction as ExpenseFunction | null,
        });
        assertPsak118Coherence(data.type, tags);
        const nextIsContra = data.isContra ?? existing.isContra;
        const nextContraOf = !nextIsContra
          ? null
          : data.contraOf === undefined
            ? existing.contraOf
            : data.contraOf;
        await assertContraTarget(nextContraOf, data.id);

        const [row] = await tx
          .update(accounts)
          .set({
            code: data.code,
            name: data.name,
            type: data.type,
            normalBalance: data.normalBalance,
            parentId: data.parentId ?? null,
            section: effectiveSection,
            cashFlowGroup: data.cashFlowGroup ?? null,
            ...bankFields,
            psak118Category: tags.psak118Category,
            expenseNature: tags.expenseNature,
            expenseFunction: tags.expenseFunction,
            isContra: nextIsContra,
            contraOf: nextContraOf,
            description: data.description ?? null,
            isPostable: data.isPostable !== undefined ? data.isPostable : existing.isPostable,
            isActive: data.isActive !== undefined ? data.isActive : existing.isActive,
          })
          .where(and(eq(accounts.companyId, ctx.company.id), eq(accounts.id, data.id)))
          .returning({ id: accounts.id });
        if (!row) throw new AppError("NOT_FOUND", "Akun tidak ditemukan.");

        // MD-018: Audit perubahan akun
        await writeAudit(tx, {
          companyId: ctx.company.id,
          userId: ctx.user.id,
          action: codeChanged ? "account.code_change" : "account.update",
          entityType: "account",
          entityId: data.id,
          before: { code: existing.code, name: existing.name, isActive: existing.isActive },
          after: { code: data.code, name: data.name, isActive: data.isActive !== undefined ? data.isActive : existing.isActive },
        });
        return row;
      }
      await assertContraTarget(createContraOf);
      const [row] = await tx
        .insert(accounts)
        .values({
          companyId: ctx.company.id,
          code: data.code,
          name: data.name,
          type: data.type,
          normalBalance: data.normalBalance,
          parentId: data.parentId ?? null,
          section: effectiveSection,
          cashFlowGroup: data.cashFlowGroup ?? null,
          ...bankFields,
          psak118Category: createTags.psak118Category,
          expenseNature: createTags.expenseNature,
          expenseFunction: createTags.expenseFunction,
          isContra: createIsContra,
          contraOf: createContraOf,
          description: data.description ?? null,
          isPostable: data.isPostable ?? true,
          isActive: data.isActive ?? true,
        })
        .returning({ id: accounts.id });

      // MD-018: Audit pembuatan akun
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "account.create",
        entityType: "account",
        entityId: row.id,
        after: { code: data.code, name: data.name, type: data.type },
      });

      return row;
    });
    revalidatePath("/app/akuntansi/akun");
    return result;
  });
}

export async function deleteAccountAction(id: string) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const accountId = parseInput(z.string().uuid(), id);
    await withCompany(ctx.company.id, async (tx) => {
      const [account] = await tx
        .select({ id: accounts.id, code: accounts.code, name: accounts.name })
        .from(accounts)
        .where(and(eq(accounts.companyId, ctx.company.id), eq(accounts.id, accountId)))
        .limit(1);
      if (!account) throw new AppError("NOT_FOUND", "Akun tidak ditemukan.");

      const [used] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(journalLines)
        .where(and(eq(journalLines.companyId, ctx.company.id), eq(journalLines.accountId, accountId)));
      if ((used?.value ?? 0) > 0) {
        throw new AppError("CONFLICT", "Akun sudah dipakai jurnal. Nonaktifkan akun alih-alih menghapus.");
      }
      const [children] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(accounts)
        .where(and(eq(accounts.companyId, ctx.company.id), eq(accounts.parentId, accountId)));
      if ((children?.value ?? 0) > 0) {
        throw new AppError("CONFLICT", "Akun masih menjadi induk akun lain. Pindahkan sub-akun terlebih dahulu.");
      }
      const [mapped] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(accountMappings)
        .where(and(eq(accountMappings.companyId, ctx.company.id), eq(accountMappings.accountId, accountId)));
      if ((mapped?.value ?? 0) > 0) {
        throw new AppError("CONFLICT", "Akun masih dipakai di pemetaan akun. Ganti pemetaannya terlebih dahulu.");
      }
      // AK-P2-12: akun juga direferensikan metode pembayaran dan akun diskon
      // kelompok harga (keduanya uuid tanpa FK). Menghapusnya akan membuat
      // penjualan berikutnya memposting ke akun yang sudah tidak ada.
      const [paymentUse] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(paymentMethods)
        .where(and(eq(paymentMethods.companyId, ctx.company.id), eq(paymentMethods.accountId, accountId)));
      if ((paymentUse?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Akun masih dipakai sebagai akun penampung metode pembayaran. Ganti akun pada metode pembayaran itu terlebih dahulu.",
        );
      }
      const [groupUse] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(customerGroups)
        .where(and(eq(customerGroups.companyId, ctx.company.id), eq(customerGroups.discountAccountId, accountId)));
      if ((groupUse?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Akun masih dipakai sebagai akun diskon kelompok harga pelanggan. Ganti akun diskon pada kelompok itu terlebih dahulu.",
        );
      }

      // MD-016 & WF-019: tolak jika akun terikat pada transfer bank, akun kontra, biaya, pembayaran, atau pinjaman/uang muka
      const [usageCheck] = (await tx.execute(sql`
        SELECT
          (SELECT count(*)::int FROM accounts WHERE company_id = ${ctx.company.id} AND contra_of = ${accountId}) AS contra,
          (SELECT count(*)::int FROM bank_transfers WHERE company_id = ${ctx.company.id} AND (from_account_id = ${accountId} OR to_account_id = ${accountId})) AS bank_transfer,
          (SELECT count(*)::int FROM expenses WHERE company_id = ${ctx.company.id} AND expense_account_id = ${accountId}) AS expense,
          (SELECT count(*)::int FROM party_payments WHERE company_id = ${ctx.company.id} AND account_id = ${accountId}) AS party_payment,
          (SELECT count(*)::int FROM employee_advances WHERE company_id = ${ctx.company.id} AND account_id = ${accountId}) AS advance,
          (SELECT count(*)::int FROM employee_loans WHERE company_id = ${ctx.company.id} AND account_id = ${accountId}) AS loan
      `)) as unknown as { contra: number; bank_transfer: number; expense: number; party_payment: number; advance: number; loan: number }[];
      if ((Number(usageCheck?.contra) || 0) > 0) {
        throw new AppError("CONFLICT", "Akun masih menjadi target akun kontra dari akun lain. Lepaskan relasi kontra akun terlebih dahulu.");
      }
      if ((Number(usageCheck?.bank_transfer) || 0) > 0) {
        throw new AppError("CONFLICT", "Akun memiliki riwayat transfer antar-bank. Nonaktifkan akun alih-alih menghapus.");
      }
      if ((Number(usageCheck?.expense) || 0) > 0) {
        throw new AppError("CONFLICT", "Akun sudah dipakai pada transaksi pengeluaran beban/biaya. Nonaktifkan akun alih-alih menghapus.");
      }
      if ((Number(usageCheck?.party_payment) || 0) > 0) {
        throw new AppError("CONFLICT", "Akun sudah dipakai pada transaksi pembayaran piutang/hutang. Nonaktifkan akun alih-alih menghapus.");
      }
      if ((Number(usageCheck?.advance) || 0) > 0) {
        throw new AppError("CONFLICT", "Akun sudah dipakai pada pencairan kasbon/uang muka karyawan. Nonaktifkan akun alih-alih menghapus.");
      }
      if ((Number(usageCheck?.loan) || 0) > 0) {
        throw new AppError("CONFLICT", "Akun sudah dipakai pada pencairan pinjaman karyawan. Nonaktifkan akun alih-alih menghapus.");
      }

      await tx
        .delete(accounts)
        .where(and(eq(accounts.companyId, ctx.company.id), eq(accounts.id, accountId)));
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "account.delete",
        entityType: "account",
        entityId: accountId,
        before: { code: account.code, name: account.name },
      });
    });
    revalidatePath("/app/akuntansi/akun");
    return { id: accountId };
  });
}

/**
 * Kunci pemetaan akun yang dikenal aplikasi (AK-P2-06). Daftar ini diturunkan
 * dari konsumen pemetaan di src/server: kunci yang di-seed dan ditampilkan
 * editor Pengaturan (MAPPING_LABELS), ditambah "salary_deductions_payable"
 * yang dibaca runPayrollAction sebagai kunci opsional dan "other_income"
 * (D-5) yang dibaca createReceipt sebagai kunci opsional untuk penerimaan
 * bonus. Kunci di luar daftar ini tidak dibaca kode mana pun, jadi
 * menyimpannya hanya menipu pengguna.
 *
 * FIX-P1 Tahap 4 (AK1-03): sembilan kunci yang selama ini dipakai kode
 * tetapi terkunci dari Pengaturan kini dibuka — "supplier_credit"
 * (supplier-returns), "employee_receivable" (employee-advances, hr),
 * "employee_loan_receivable" (employee-loans), "pph21_payable",
 * "bpjs_payable", "payroll_employer_expense" (payroll Indonesia),
 * "fixed_asset", "accumulated_depreciation", "depreciation_expense"
 * (fixed-assets) — ditambah "tax_input" (PPN Masukan, AK1-06/AK4-04).
 * A-24 T4: daftar konstanta kini hidup SATU sumber di
 * `src/lib/account-mappings.ts` bersama MAPPING_LABELS &
 * MAPPING_DESCRIPTIONS (isi & urutan identik dengan daftar lama di
 * sini) dan dijaga test sinkronisasi
 * tests/unit/account-mappings-sync.test.ts — kunci yang bisa disimpan
 * harus bisa dilihat dan dijelaskan.
 */

export async function saveMappingAction(input: { key: string; accountId: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(z.object({ key: z.string().min(1), accountId: z.string().uuid() }), input);
    if (!(ACCOUNT_MAPPING_KEYS as readonly string[]).includes(data.key)) {
      throw new AppError(
        "VALIDATION",
        `Kunci pemetaan "${data.key}" tidak dikenal. Gunakan kunci pemetaan resmi yang tersedia di Pengaturan.`,
      );
    }
    await withCompany(ctx.company.id, async (tx) => {
      // Pola validasi AK-P1-02: akun tujuan harus ada, sekantor, postable, aktif.
      const [account] = await tx
        .select({
          id: accounts.id,
          code: accounts.code,
          name: accounts.name,
          type: accounts.type,
          isPostable: accounts.isPostable,
          isActive: accounts.isActive,
        })
        .from(accounts)
        .where(and(eq(accounts.companyId, ctx.company.id), eq(accounts.id, data.accountId)))
        .limit(1);
      if (!account) {
        throw new AppError("VALIDATION", "Akun tujuan pemetaan tidak ditemukan untuk perusahaan ini.");
      }
      if (!account.isPostable) {
        throw new AppError(
          "VALIDATION",
          `Akun ${account.code} (${account.name}) adalah akun induk dan tidak dapat dipakai sebagai tujuan pemetaan.`,
        );
      }
      if (!account.isActive) {
        throw new AppError(
          "VALIDATION",
          `Akun ${account.code} (${account.name}) sudah tidak aktif dan tidak dapat dipakai sebagai tujuan pemetaan.`,
        );
      }
      if (!mappingAllowsAccountType(data.key, account.type)) {
        throw new AppError(
          "VALIDATION",
          `Akun ${account.code} (${account.name}) bertipe ${account.type}, tidak sesuai untuk pemetaan "${MAPPING_LABELS[data.key] ?? data.key}". Pilih akun bertipe ${mappingAccountTypes(data.key).join("/")}.`,
        );
      }
      const [previous] = await tx
        .select({ accountId: accountMappings.accountId })
        .from(accountMappings)
        .where(
          and(
            eq(accountMappings.companyId, ctx.company.id),
            eq(accountMappings.key, data.key),
          ),
        )
        .limit(1);
      await tx
        .insert(accountMappings)
        .values({ companyId: ctx.company.id, key: data.key, accountId: data.accountId })
        .onConflictDoUpdate({
          target: [accountMappings.companyId, accountMappings.key],
          set: { accountId: data.accountId, updatedAt: new Date() },
        });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "account_mapping.update",
        entityType: "account_mapping",
        entityId: data.key,
        before: previous ? { accountId: previous.accountId } : null,
        after: { key: data.key, accountId: data.accountId, code: account.code },
      });
    });
    revalidatePath("/app/pengaturan");
    return data;
  });
}

const capitalSchema = z.object({
  date: isoDate("Tanggal"),
  accountId: z.string().uuid(),
  equityAccountId: z.string().uuid().optional(),
  amount: moneyString("Nominal modal"),
  description: z.string().min(3).max(200),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

/** Owner capital injection: debit cash/bank, credit equity. */
export async function createCapitalAction(input: z.input<typeof capitalSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(capitalSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      postOwnerCapital(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        ...data,
      }),
    );

    revalidatePath("/app/akuntansi/bank");
    revalidatePath("/app/akuntansi/jurnal");
    revalidatePath("/app/akuntansi");
    return result;
  });
}
