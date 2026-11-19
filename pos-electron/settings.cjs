const { readFileSync, renameSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const DEFAULT_ORIGIN = "http://localhost:3000";

function parseOrigin(value) {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Gunakan alamat HTTPS ERP atau HTTP localhost, tanpa path.");
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
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { origin: DEFAULT_ORIGIN, printer: "", width: 80 };
  }
}

function saveSettings(directory, settings) {
  const file = join(directory, "pos-settings.json");
  writeFileSync(file + ".tmp", JSON.stringify(settings), { mode: 0o600 });
  renameSync(file + ".tmp", file);
}

module.exports = { loadSettings, saveSettings, parseOrigin };
