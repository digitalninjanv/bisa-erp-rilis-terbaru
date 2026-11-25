const api = window.bisaPosSettings;
const printerSelect = document.getElementById("printerSelect");
const originInput = document.getElementById("originInput");
const autoPrintInput = document.getElementById("autoPrintInput");
const statusBox = document.getElementById("status");
const testBtn = document.getElementById("testBtn");
const saveBtn = document.getElementById("saveBtn");
const refreshBtn = document.getElementById("refreshBtn");
const closeBtn = document.getElementById("closeBtn");

function showStatus(text, ok) {
  statusBox.textContent = text;
  statusBox.className = "status " + (ok ? "ok" : "err");
}

function populatePrinters(printers, selected) {
  printerSelect.innerHTML = "";
  const emptyOpt = document.createElement("option");
  emptyOpt.value = "";
  emptyOpt.textContent = printers.length ? "-- Pilih printer --" : "Belum ada printer terpasang di sistem operasi";
  printerSelect.appendChild(emptyOpt);
  for (const p of printers) {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.displayName && p.displayName !== p.name ? p.displayName + " (" + p.name + ")" : p.name;
    if (p.name === selected) opt.selected = true;
    printerSelect.appendChild(opt);
  }
}

async function init() {
  const data = await api.load();
  populatePrinters(data.printers || [], data.settings.printer || "");
  originInput.value = data.settings.origin || "http://localhost:3000";
  autoPrintInput.checked = data.settings.autoPrint !== false;
  const widthRadio = document.querySelector('input[name="width"][value="' + (data.settings.width === 58 ? 58 : 80) + '"]');
  if (widthRadio) widthRadio.checked = true;
}

async function saveCurrent() {
  const widthRadio = document.querySelector('input[name="width"]:checked');
  const res = await api.save({
    printer: printerSelect.value,
    width: widthRadio && widthRadio.value === "58" ? 58 : 80,
    autoPrint: autoPrintInput.checked,
    origin: originInput.value.trim(),
  });
  if (!res.ok) {
    showStatus(res.message || "Gagal menyimpan pengaturan.", false);
    return false;
  }
  showStatus(res.originChanged ? "Pengaturan disimpan & terminal dimuat ulang ke server baru." : "Pengaturan printer tersimpan.", true);
  return true;
}

document.getElementById("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  saveBtn.disabled = true;
  try { await saveCurrent(); } finally { saveBtn.disabled = false; }
});

testBtn.addEventListener("click", async () => {
  testBtn.disabled = true;
  try {
    const saved = await saveCurrent();
    if (!saved) return;
    showStatus("Mengirim halaman uji ke printer...", true);
    const res = await api.testPrint();
    showStatus(res.ok ? "Uji cetak dikirim! Periksa kertas printer Anda." : (res.message || "Uji cetak gagal."), res.ok);
  } finally {
    testBtn.disabled = false;
  }
});

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  try {
    const printers = await api.refreshPrinters();
    populatePrinters(printers || [], printerSelect.value);
    showStatus("Daftar printer diperbarui (" + (printers ? printers.length : 0) + " ditemukan).", true);
  } finally {
    refreshBtn.disabled = false;
  }
});

closeBtn.addEventListener("click", () => api.close());
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") api.close();
});

void init();
