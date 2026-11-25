# CORE FIXES — Bisa ERP Remediation

Tanggal: 2026-11-21

## CORE-01 — Eskalasi `users.manage`
- **Perubahan**: `src/server/actions/users.ts` menambahkan `permissionsForRole` + `assertCanManageRolePermissions`. Non-owner hanya boleh memberi/mengubah/mereset/menghapus role yang permission-nya subset dari permission actor. Owner tetap penuh.
- **Helper**: `missingPermissions` di `src/lib/permissions.ts`.
- **Test**: `tests/integration/user-management.test.ts` — custom `users.manage` ditolak membuat manager dan mereset akun warehouse; test owner/admin lama tetap lulus (19 test).
- **Status**: VERIFIED.

## CORE-02 — Module gate action
- **Status**: **DEFERRED**. Perubahan module gate pada import/rekonsiliasi/uang muka ditunda karena mock test lama belum menyediakan `requirePermissionInModule` dan perubahan menyentuh banyak suite. CORE-03/CORE-04 (jalur paling sensitif) sudah ditangani.
- **Residual risk**: write action tersebut masih dapat dipanggil saat module dimatikan. Perbaiki bersama pembaruan mock/integration test di iterasi berikutnya.

## CORE-03 — Payroll export
- **Perubahan**: `src/app/api/export/payroll/route.ts` menambahkan `assertModuleEnabled(ctx.enabledModules, "hr")` setelah permission + fresh session.
- **Status**: VERIFIED (code); route runtime test belum.

## CORE-04 — Device token module gate
- **Perubahan**: `resolvePosTerminalByToken` membaca `company_settings` dan menolak token bila `isModuleEnabled(settings,"pos")` false.
- **Status**: VERIFIED (code); API integration test belum.

## CORE-05 — Pairing lock
- **Perubahan**: `consumePairingCode` memakai `.for("update")` pada SELECT kode.
- **Status**: VERIFIED (code).

## CORE-06 — Audit feed HR
- **Perubahan**: `listCompanyAuditTrail` menerima `excludeEntityTypes`; filter diterapkan pada rows/total/facet actions/entityTypes/actors. Halaman Riwayat menyembunyikan `HR_AUDIT_ENTITY_TYPES` bila aktor tidak punya `payroll.view`/`payroll.manage`/`payroll.salary`.
- **Test**: `remediation-audit-fixes.test.ts` — viewer hanya melihat `product`, bukan `employee_loan`.
- **Status**: VERIFIED.

## CORE-07 — Redirect di `guard()`
- **Perubahan**: `guard()` me-rethrow error dengan digest `NEXT_REDIRECT`/`NEXT_NOT_FOUND` sebelum mapping INTERNAL.
- **Test**: `tests/unit/guard-zod.test.ts` — redirect/notFound rethrow.
- **Status**: VERIFIED.
