/**
 * UUID yang aman di HTTP LAN.
 *
 * `crypto.randomUUID()` hanya tersedia di secure context (HTTPS atau
 * localhost). Saat aplikasi dibuka dari perangkat lain lewat
 * `http://192.168.x.x`, fungsi itu undefined. `crypto.getRandomValues`
 * tetap tersedia di insecure context, jadi dipakai sebagai fallback
 * untuk idempotency key/form — bukan untuk secret.
 */
export function newUuid(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    webCrypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // versi 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // varian RFC 4122
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Browser sangat lama: idempotency key hanya perlu unik, bukan rahasia.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
