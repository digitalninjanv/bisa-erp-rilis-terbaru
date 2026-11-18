// FIX-ARS Tahap 4: indeks modul hasil pemecahan src/server/pos.ts.
// Mengekspor ulang persis API publik berkas asal.

export { quoteCart } from "./quote";
export type { CartLineInput, QuoteLine, QuoteResult, QuoteLinePublic, QuoteResultPublic } from "./quote";
export { payReceivable } from "./receivables";
export { getReturnCredit } from "./returns-credit";
export type { ReturnCredit } from "./returns-credit";
export {
  createSaleReturn,
  listRecentSaleReturns,
  getReturnedQtyByProduct,
  getReturnedQtyBySaleLine,
} from "./returns";
export { listSaleReturnHistory } from "./return-history";
export { createSale } from "./sales-create";
export type { PaymentInput } from "./sales-types";
export { consumeHeldSale, deleteHeldSale, holdSale } from "./sales-hold";
export { voidSale } from "./sales-void";
export { openCashSession, closeCashSession, cashDrawerMovement, getOpenCashSession, countHeldSales } from "./sessions";
export {
  consumePairingCode,
  createPosTerminal,
  digestSecret,
  enrollPosDesktopTerminal,
  issuePairingCode,
  listPosTerminals,
  listTerminalActorOptions,
  listTerminalSessionReviews,
  recordTerminalSessionClose,
  resolvePosTerminalByToken,
  revokePosTerminal,
} from "./terminals";
export type {
  PosTerminalIdentity,
  PosTerminalRow,
  PosTerminalSessionReviewRow,
  TerminalSessionCloseIntent,
  TerminalSessionOpenIntent,
} from "./terminals";
export {
  artifactFileName,
  compareVersions,
  decideDesktopUpdate,
  getDesktopReleaseSettings,
  isValidVersion,
  releaseDir,
  resolveReleaseArtifact,
  rolloutBucket,
  setDesktopReleaseSettings,
} from "./releases";
export type {
  DesktopReleaseSettingsView,
  DesktopUpdateDecision,
  ReleaseArtifact,
} from "./releases";
export * from "./offline";
export {
  posSessionIntentSchema,
  posSyncItemSchema,
  posSyncRequestSchema,
} from "./device-contract";
export { syncPosDeviceItems } from "./device-sync";
export { getPosDeviceCashSessionSummary, syncPosDeviceSessionIntents } from "./device-sessions";
export type { PosDeviceIdentity, PosSessionIntent } from "./device-contract";
export type { PosSessionIntentResult } from "./device-sessions";
