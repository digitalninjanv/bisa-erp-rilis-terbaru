const { readFileSync, renameSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const DEFAULT_ORIGIN = "https://ifi.lapak.my.id";

function isPrivateOrLoopbackHost(hostname) {
  if (["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return true;
  if (hostname.endsWith(".local")) return true;
  // RFC 1918 IPv4 private ranges:
  // 10.0.0.0 - 10.255.255.255
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  // 172.16.0.0 - 172.31.255.255
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  // 192.168.0.0 - 192.168.255.255
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
}

function parseOrigin(value) {
  const url = new URL(value);
  const localOrLan = isPrivateOrLoopbackHost(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && localOrLan)) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Gunakan alamat HTTPS ERP atau HTTP jaringan lokal (LAN/localhost), tanpa path.");
  }
  return url.origin;
}

function loadSettings(directory) {
  try {
    const value = JSON.parse(readFileSync(join(directory, "pos-settings.json"), "utf8"));
    return {
      origin: parseOrigin(value.origin),
      printer: typeof value.printer === "string" ? value.printer : "",
      width: value.width === 58 ? 58 : 80,
      autoPrint: typeof value.autoPrint === "boolean" ? value.autoPrint : true,
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("[bisa-pos] pos-settings.json rusak, kembali ke bawaan:", error.message || error);
    }
    return { origin: DEFAULT_ORIGIN, printer: "", width: 80, autoPrint: true };
  }
}

function saveSettings(directory, settings) {
  const file = join(directory, "pos-settings.json");
  writeFileSync(file + ".tmp", JSON.stringify(settings), { mode: 0o600 });
  renameSync(file + ".tmp", file);
}

module.exports = { loadSettings, saveSettings, parseOrigin, isPrivateOrLoopbackHost };
