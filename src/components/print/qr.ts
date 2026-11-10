import QRCode from "qrcode";

/**
 * Render a document number as a QR code data URL, server-side.
 *
 * The QR encodes the document number as plain text (D-13) so any scanner
 * can read back which document a printed sheet belongs to. Returns null
 * when rendering fails so a print page never breaks over a QR problem.
 */
export async function documentQrDataUrl(documentNumber: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(documentNumber, {
      margin: 1,
      width: 200,
      errorCorrectionLevel: "M",
    });
  } catch {
    return null;
  }
}
