import { BlockList, isIP } from "node:net";

/**
 * SEC-012 — resolusi IP klien yang tidak menelan mentah X-Forwarded-For.
 *
 * Tanpa daftar proksi tepercaya, hanya header satu-nilai yang sah
 * (rantai multi-hop tidak dapat dipastikan asalnya). Bila daftar diisi
 * operator (`BISA_TRUSTED_PROXIES`), rantai dibaca dari kanan dan hop
 * proksi dilewati sampai klien pertama — pola yang sama dengan Better
 * Auth. Header yang tidak valid membuat resolusi gagal (fail closed),
 * bukan jatuh ke nilai yang bisa dipalsukan.
 */
export function buildTrustedProxyList(entries: string[]): BlockList | null {
  if (entries.length === 0) return null;
  const list = new BlockList();
  let added = 0;
  for (const entry of entries) {
    const slash = entry.lastIndexOf("/");
    const ip = slash === -1 ? entry : entry.slice(0, slash);
    const family = isIP(ip);
    if (family === 0) continue;
    const type = family === 4 ? "ipv4" : "ipv6";
    if (slash === -1) {
      list.addAddress(ip, type);
      added += 1;
      continue;
    }
    const prefix = Number(entry.slice(slash + 1));
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > (family === 4 ? 32 : 128)) continue;
    list.addSubnet(ip, prefix, type);
    added += 1;
  }
  return added > 0 ? list : null;
}

function isListed(list: BlockList, ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return false;
  return list.check(ip, family === 4 ? "ipv4" : "ipv6");
}

export function resolveClientIp(
  headers: Headers,
  trustedProxies: string[],
): string | null {
  const trusted = buildTrustedProxyList(trustedProxies);
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (hops.length > 0) {
      if (trusted) {
        for (let index = hops.length - 1; index >= 0; index -= 1) {
          const hop = hops[index];
          if (!hop || isIP(hop) === 0) return null;
          if (isListed(trusted, hop)) continue;
          return hop;
        }
        return null;
      }
      // Tanpa proksi tepercaya, rantai lebih dari satu hop tidak dapat
      // diverifikasi asalnya — jangan menebak.
      if (hops.length === 1 && isIP(hops[0] ?? "") !== 0) return hops[0] ?? null;
      return null;
    }
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp && isIP(realIp) !== 0) return realIp;
  return null;
}

/** Entri mentah dari environment; validasi bentuk dilakukan env.ts saat start. */
export function trustedProxiesFromEnv(): string[] {
  return (process.env.BISA_TRUSTED_PROXIES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
