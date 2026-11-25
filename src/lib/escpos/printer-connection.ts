"use client";

import type { PrinterPreferences, SerialBaudRate } from "./types";
import { DEFAULT_PRINTER_PREFERENCES } from "./types";
import { buildTestReceiptEscPos } from "./receipt-template";
import { withPrinterWriteLock } from "./printer-write-lock";
import {
  errorMessage,
  isNotFoundError,
  printerNavigator,
  type BluetoothCharacteristicLike,
  type BluetoothDeviceLike,
  type SerialPortLike,
  type UsbDeviceLike,
  type UsbEndpointLike,
} from "./web-printer-types";

const STORAGE_KEY = "bisa_pos_printer_prefs";

// Bluetooth GATT Services umum pada printer thermal portable (BLE)
const BLUETOOTH_PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
];

// Singletons untuk menyimpan koneksi aktif saat sesi kasir berjalan
let activeBluetoothDevice: BluetoothDeviceLike | null = null;
let activeBluetoothCharacteristic: BluetoothCharacteristicLike | null = null;
let activeBluetoothDisconnectHandler: (() => void) | null = null;
let activeSerialPort: SerialPortLike | null = null;
let activeUsbDevice: UsbDeviceLike | null = null;
let activeUsbEndpoint: UsbEndpointLike | null = null;

// Event listeners subscriber untuk UI
type ConnectionListener = (connected: boolean, name?: string) => void;
const statusListeners = new Set<ConnectionListener>();

export function subscribePrinterStatus(listener: ConnectionListener): () => void {
  statusListeners.add(listener);
  // Langsung panggil dengan status saat ini
  listener(isPrinterConnected(), isPrinterConnected() ? getPrinterPreferences().name : undefined);
  return () => {
    statusListeners.delete(listener);
  };
}

function notifyStatusChange(): void {
  const connected = isPrinterConnected();
  const name = connected ? getPrinterPreferences().name : undefined;
  statusListeners.forEach((fn) => {
    try {
      fn(connected, name);
    } catch {
      // Abaikan listener error
    }
  });
}

export function getPrinterPreferences(): PrinterPreferences {
  if (typeof window === "undefined") return DEFAULT_PRINTER_PREFERENCES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRINTER_PREFERENCES;
    return { ...DEFAULT_PRINTER_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PRINTER_PREFERENCES;
  }
}

export function savePrinterPreferences(updates: Partial<PrinterPreferences>): PrinterPreferences {
  const current = getPrinterPreferences();
  const next = { ...current, ...updates };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Abaikan jika storage penuh/disabled
    }
  }
  notifyStatusChange();
  return next;
}

/** Cek apakah halaman berjalan dalam Secure Context (HTTPS atau localhost). */
export function isBrowserSecureContext(): boolean {
  if (typeof window === "undefined") return true;
  return Boolean(window.isSecureContext);
}

function getInsecureOriginMessage(feature: string): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return `Fitur ${feature} memerlukan koneksi HTTPS yang aman. Hubungi administrator untuk mengaktifkan HTTPS atau gunakan POS Desktop.`;
  }
  return `Browser belum mendukung ${feature}. Gunakan Google Chrome atau Microsoft Edge di PC.`;
}

/** Cek apakah browser mendukung Web Bluetooth. */
export function isBluetoothSupported(): boolean {
  return Boolean(printerNavigator()?.bluetooth);
}

/** Cek apakah browser mendukung WebUSB. */
export function isUsbSupported(): boolean {
  return Boolean(printerNavigator()?.usb);
}

/** Cek apakah browser mendukung Web Serial. */
export function isSerialSupported(): boolean {
  return Boolean(printerNavigator()?.serial);
}

/** Cek apakah printer saat ini aktif terhubung dan siap cetak. */
export function isPrinterConnected(): boolean {
  if (activeBluetoothCharacteristic && activeBluetoothDevice?.gatt?.connected) return true;
  if (activeSerialPort?.writable) return true;
  if (activeUsbDevice && activeUsbEndpoint) return true;
  return false;
}

/**
 * Hubungkan ke printer thermal via Web Bluetooth (BLE).
 */
export async function connectBluetoothPrinter(): Promise<{
  ok: boolean;
  name?: string;
  message?: string;
}> {
  if (!isBrowserSecureContext()) {
    return { ok: false, message: getInsecureOriginMessage("Web Bluetooth") };
  }
  if (!isBluetoothSupported()) {
    return {
      ok: false,
      message: getInsecureOriginMessage("Web Bluetooth"),
    };
  }

  try {
    const bluetooth = printerNavigator()?.bluetooth;
    if (!bluetooth) {
      return { ok: false, message: getInsecureOriginMessage("Web Bluetooth") };
    }
    let device: BluetoothDeviceLike;
    try {
      // acceptAllDevices: true memungkinkan menemukan perangkat Bluetooth thermal tanpa terhalang filter UUID broadcast
      device = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: BLUETOOTH_PRINTER_SERVICES,
      });
    } catch (error) {
      if (isNotFoundError(error)) {
        return { ok: false, message: "Tidak ada printer Bluetooth BLE yang dipilih atau ditemukan." };
      }
      device = await bluetooth.requestDevice({
        filters: BLUETOOTH_PRINTER_SERVICES.map((service) => ({ services: [service] })),
        optionalServices: BLUETOOTH_PRINTER_SERVICES,
      });
    }

    if (!device) {
      return { ok: false, message: "Tidak ada perangkat Bluetooth yang dipilih." };
    }

    const server = await device.gatt?.connect();
    if (!server) {
      return { ok: false, message: "Gagal menghubungkan GATT server printer." };
    }

    let targetChar: BluetoothCharacteristicLike | null = null;
    for (const serviceUuid of BLUETOOTH_PRINTER_SERVICES) {
      try {
        const service = await server.getPrimaryService(serviceUuid);
        const chars = await service.getCharacteristics();
        for (const ch of chars) {
          if (ch.properties.write || ch.properties.writeWithoutResponse) {
            targetChar = ch;
            break;
          }
        }
        if (targetChar) break;
      } catch {
        // Coba service berikutnya
      }
    }

    if (!targetChar) {
      try {
        const services = await server.getPrimaryServices();
        for (const s of services) {
          try {
            const chars = await s.getCharacteristics();
            for (const ch of chars) {
              if (ch.properties.write || ch.properties.writeWithoutResponse) {
                targetChar = ch;
                break;
              }
            }
            if (targetChar) break;
          } catch {
            // Lanjut ke service berikutnya
          }
        }
      } catch {
        // Abaikan
      }
    }

    if (!targetChar) {
      device.gatt?.disconnect();
      return { ok: false, message: "Karakteristik cetak printer tidak ditemukan pada perangkat ini." };
    }

    if (activeBluetoothDevice && activeBluetoothDisconnectHandler) {
      activeBluetoothDevice.removeEventListener?.("gattserverdisconnected", activeBluetoothDisconnectHandler);
    }
    if (activeBluetoothDevice && activeBluetoothDevice !== device) {
      activeBluetoothDevice.gatt?.disconnect();
    }
    activeBluetoothDevice = device;
    activeBluetoothCharacteristic = targetChar;
    activeBluetoothDisconnectHandler = () => {
      if (activeBluetoothDevice !== device) return;
      activeBluetoothDevice = null;
      activeBluetoothCharacteristic = null;
      activeBluetoothDisconnectHandler = null;
      notifyStatusChange();
    };
    device.addEventListener?.("gattserverdisconnected", activeBluetoothDisconnectHandler);

    const deviceName = device.name || "Bluetooth Thermal Printer";
    savePrinterPreferences({
      type: "bluetooth",
      name: deviceName,
      bluetoothDeviceId: device.id ?? null,
    });

    notifyStatusChange();
    return { ok: true, name: deviceName };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { ok: false, message: "Printer Bluetooth BLE tidak ditemukan. Pastikan printer menyala dan mendukung BLE." };
    }
    return { ok: false, message: errorMessage(error, "Gagal menghubungkan Bluetooth printer.") };
  }
}

/** Helper untuk membuka dan klaim antarmuka USB printer. */
async function openAndClaimUsbDevice(device: UsbDeviceLike): Promise<{
  ok: boolean;
  endpoint?: UsbEndpointLike;
  message?: string;
}> {
  try {
    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    const interfaces = device.configuration?.interfaces ?? [];
    const candidates = interfaces.flatMap((iface) =>
      (iface.alternates ?? (iface.alternate ? [iface.alternate] : [])).flatMap((alternate) => {
        const endpoint = alternate.endpoints?.find((candidate) => candidate.direction === "out");
        return endpoint ? [{ iface, alternate, endpoint }] : [];
      }),
    );
    const target = candidates.find(({ alternate }) => alternate.interfaceClass === 7) ?? candidates[0];
    if (!target) {
      await device.close().catch(() => undefined);
      return { ok: false, message: "Antarmuka USB dengan endpoint OUT tidak ditemukan." };
    }

    const interfaceNumber = target.iface.interfaceNumber ?? 0;
    try {
      await device.claimInterface(interfaceNumber);
    } catch {
      await device.close().catch(() => undefined);
      return {
        ok: false,
        message: "Antarmuka USB belum bisa diklaim. Jika printer memakai driver OS, pilih mode Driver OS untuk mencetak.",
      };
    }
    const alternateSetting = target.alternate.alternateSetting ?? 0;
    if (alternateSetting !== (target.iface.alternate?.alternateSetting ?? 0)) {
      await device.selectAlternateInterface(interfaceNumber, alternateSetting);
    }
    return { ok: true, endpoint: target.endpoint };
  } catch (error) {
    await device.close().catch(() => undefined);
    return { ok: false, message: errorMessage(error, "Gagal menghubungkan perangkat USB.") };
  }
}

/**
 * Hubungkan ke printer thermal via WebUSB langsung (Class Code 7: Printer atau generic USB).
 */
export async function connectDirectUsbPrinter(): Promise<{
  ok: boolean;
  name?: string;
  message?: string;
}> {
  if (!isBrowserSecureContext()) {
    return { ok: false, message: getInsecureOriginMessage("WebUSB") };
  }
  const nav = printerNavigator();
  if (!nav?.usb) {
    return {
      ok: false,
      message: getInsecureOriginMessage("WebUSB"),
    };
  }

  try {
    let device: UsbDeviceLike;
    try {
      // filters: [] mengizinkan pengguna memilih sembarang printer USB yang terpasang
      device = await nav.usb.requestDevice({ filters: [] });
    } catch (error) {
      if (isNotFoundError(error)) {
        return { ok: false, message: "Pemilihan printer USB dibatalkan." };
      }
      device = await nav.usb.requestDevice({
        filters: [
          { classCode: 7 },
          { vendorId: 0x04b8 }, // Epson
          { vendorId: 0x0519 }, // Star
          { vendorId: 0x0416 }, // Winbond / POS
          { vendorId: 0x0483 }, // STMicroelectronics
          { vendorId: 0x1fc9 }, // NXP
          { vendorId: 0x1a86 }, // QinHeng / CH340
          { vendorId: 0x10c4 }, // Silicon Labs
          { vendorId: 0x067b }, // Prolific
        ],
      });
    }

    if (!device) {
      return { ok: false, message: "Tidak ada printer USB yang dipilih." };
    }

    const res = await openAndClaimUsbDevice(device);
    if (!res.ok) {
      return { ok: false, message: res.message };
    }

    activeUsbDevice = device;
    activeUsbEndpoint = res.endpoint ?? null;

    const deviceName = device.productName || "USB Thermal Printer";
    savePrinterPreferences({
      type: "usb",
      name: deviceName,
      usbSerialNumber: device.serialNumber || null,
    });

    notifyStatusChange();
    return { ok: true, name: deviceName };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { ok: false, message: "Pemilihan printer USB dibatalkan." };
    }
    return { ok: false, message: errorMessage(error, "Gagal menghubungkan printer USB.") };
  }
}

/**
 * Hubungkan ke printer thermal via Web Serial (Virtual COM / CH340 / CP2102 / RS232).
 */
export async function connectSerialPrinter(baudRateOverride?: SerialBaudRate): Promise<{
  ok: boolean;
  name?: string;
  message?: string;
}> {
  if (!isBrowserSecureContext()) {
    return { ok: false, message: getInsecureOriginMessage("Web Serial") };
  }
  const nav = printerNavigator();
  if (!nav?.serial) {
    return {
      ok: false,
      message: getInsecureOriginMessage("Web Serial"),
    };
  }

  try {
    const port = await nav.serial.requestPort();
    if (!port) {
      return { ok: false, message: "Tidak ada port serial yang dipilih." };
    }

    const baudRate = baudRateOverride ?? getPrinterPreferences().serialBaudRate ?? 9600;
    if (!port.readable && !port.writable) {
      await port.open({ baudRate });
    }

    const info = port.getInfo?.();
    activeSerialPort = port;
    const portName = `Serial / COM (${baudRate} bps)`;
    savePrinterPreferences({
      type: "serial",
      name: portName,
      serialBaudRate: baudRate,
      serialVendorId: info?.usbVendorId ?? null,
      serialProductId: info?.usbProductId ?? null,
    });

    notifyStatusChange();
    return { ok: true, name: portName };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { ok: false, message: "Pemilihan port serial dibatalkan." };
    }
    return { ok: false, message: errorMessage(error, "Gagal menghubungkan port serial printer.") };
  }
}

/**
 * Hubungkan ke printer USB (alias default yang mencoba WebUSB).
 */
export async function connectUsbPrinter(): Promise<{
  ok: boolean;
  name?: string;
  message?: string;
}> {
  return connectDirectUsbPrinter();
}

/**
 * Coba hubungkan ulang secara otomatis (auto-reconnect) tanpa menampilkan dialog pemilih.
 * Hanya untuk printer USB dan BLE yang dapat dikenali kembali.
 */
export async function tryAutoReconnect(): Promise<{ ok: boolean; name?: string }> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { ok: false };
  }
  const prefs = getPrinterPreferences();
  if (prefs.type === "none" || prefs.type === "kiosk") {
    return { ok: false };
  }

  const nav = printerNavigator();
  if (!nav) return { ok: false };

  // BLE permissions survive reloads, but the GATT connection does not.
  // Reconnect only to a device already granted by the user; never open a
  // device chooser during checkout/automatic printing.
  if (prefs.type === "bluetooth" && nav.bluetooth?.getDevices) {
    let reconnectingDevice: BluetoothDeviceLike | null = null;
    try {
      const devices = await nav.bluetooth.getDevices();
      const matchingDevice = prefs.bluetoothDeviceId
        ? devices.find((candidate) => candidate.id === prefs.bluetoothDeviceId)
        : undefined;
      const matchingNames = devices.filter((candidate) => candidate.name === prefs.name);
      const device = prefs.bluetoothDeviceId
        ? matchingDevice
        : matchingNames.length === 1 ? matchingNames[0] : undefined;
      reconnectingDevice = device ?? null;
      if (!device) return { ok: false };
      const server = await device?.gatt?.connect();
      if (server) {
        let characteristic: BluetoothCharacteristicLike | null = null;
        for (const serviceUuid of BLUETOOTH_PRINTER_SERVICES) {
          try {
            const service = await server.getPrimaryService(serviceUuid);
            const chars = await service.getCharacteristics();
            characteristic = chars.find((ch) => ch.properties.write || ch.properties.writeWithoutResponse) ?? null;
            if (characteristic) break;
          } catch {
            // This printer may expose a different known service.
          }
        }
        if (!characteristic) {
          for (const service of await server.getPrimaryServices()) {
            try {
              const chars = await service.getCharacteristics();
              characteristic = chars.find((ch) => ch.properties.write || ch.properties.writeWithoutResponse) ?? null;
              if (characteristic) break;
            } catch {
              // Continue through the services already granted by the browser.
            }
          }
        }
        if (characteristic) {
          activeBluetoothDevice = device;
          activeBluetoothCharacteristic = characteristic;
          activeBluetoothDisconnectHandler = () => {
            if (activeBluetoothDevice !== device) return;
            activeBluetoothDevice = null;
            activeBluetoothCharacteristic = null;
            activeBluetoothDisconnectHandler = null;
            notifyStatusChange();
          };
          device.addEventListener?.("gattserverdisconnected", activeBluetoothDisconnectHandler);
          notifyStatusChange();
          return { ok: true, name: device.name || prefs.name };
        }
        device.gatt?.disconnect();
      }
    } catch {
      // A silent reconnect is best effort. Checkout will show a manual
      // reconnect instruction instead of unexpectedly opening a chooser.
      // Do not keep a half-open peripheral connection after discovery fails.
      reconnectingDevice?.gatt?.disconnect();
    }
  }

  // Cek perangkat WebUSB yang sudah pernah diizinkan
  if (prefs.type === "usb" && nav.usb) {
    try {
      const devices = await nav.usb.getDevices();
      const matches = devices.filter((device) =>
        prefs.usbSerialNumber
          ? device.serialNumber === prefs.usbSerialNumber && (device.productName || "USB Thermal Printer") === prefs.name
          : Boolean(device.productName) && device.productName === prefs.name,
      );
      if (matches.length === 1) {
        const [dev] = matches;
        const res = await openAndClaimUsbDevice(dev);
        if (res.ok && res.endpoint) {
          activeUsbDevice = dev;
          activeUsbEndpoint = res.endpoint;
          notifyStatusChange();
          return { ok: true, name: dev.productName || prefs.name };
        }
      }
    } catch {
      // Background reconnect fallback
    }
  }

  if (prefs.type === "serial" && nav.serial?.getPorts) {
    try {
      const ports = await nav.serial.getPorts();
      const matches =
        prefs.serialVendorId != null && prefs.serialProductId != null
          ? ports.filter((port) => {
              const info = port.getInfo?.();
              return (
                info?.usbVendorId === prefs.serialVendorId &&
                info?.usbProductId === prefs.serialProductId
              );
            })
          : ports;
      if (matches.length === 1) {
        const [port] = matches;
        const baudRate = prefs.serialBaudRate ?? 9600;
        if (!port.readable && !port.writable) {
          await port.open({ baudRate });
        }
        activeSerialPort = port;
        notifyStatusChange();
        return { ok: true, name: prefs.name };
      }
    } catch {
      // Abaikan kegagalan background reconnect serial
    }
  }

  return { ok: false };
}

/**
 * Inisialisasi auto-reconnect dan event listeners saat aplikasi kasir dimuat.
 */
export function initPrinterAutoReconnect(): () => void {
  if (typeof window === "undefined") return () => {};

  void tryAutoReconnect();

  const nav = printerNavigator();
  if (!nav) return () => {};
  const handleConnect = () => {
    void tryAutoReconnect();
  };
  const handleDisconnect = () => {
    activeUsbDevice = null;
    activeUsbEndpoint = null;
    activeSerialPort = null;
    notifyStatusChange();
  };

  nav.usb?.addEventListener?.("connect", handleConnect);
  nav.usb?.addEventListener?.("disconnect", handleDisconnect);
  nav.serial?.addEventListener?.("connect", handleConnect);
  nav.serial?.addEventListener?.("disconnect", handleDisconnect);

  return () => {
    nav.usb?.removeEventListener?.("connect", handleConnect);
    nav.usb?.removeEventListener?.("disconnect", handleDisconnect);
    nav.serial?.removeEventListener?.("connect", handleConnect);
    nav.serial?.removeEventListener?.("disconnect", handleDisconnect);
  };
}

/**
 * Kirim raw bytes ESC/POS ke printer aktif (Bluetooth / USB / Serial).
 * Ditulis berurutan; satu job harus selesai sebelum job berikutnya.
 */
export async function sendEscPosToPrinter(
  data: Uint8Array,
): Promise<{ ok: boolean; message?: string; uncertain?: boolean }> {
  try {
    return await withPrinterWriteLock(() => sendEscPosToPrinterUnlocked(data));
  } catch (error) {
    return {
      ok: false,
      uncertain: true,
      message: errorMessage(error, "Gagal mengirim data ke printer."),
    };
  }
}

async function sendEscPosToPrinterUnlocked(
  data: Uint8Array,
): Promise<{ ok: boolean; message?: string; uncertain?: boolean }> {
  const prefs = getPrinterPreferences();

  // Mode Bluetooth
  if (prefs.type === "bluetooth") {
    if (!activeBluetoothCharacteristic) {
      const reconnect = await tryAutoReconnect();
      if (!reconnect.ok || !activeBluetoothCharacteristic) {
        return {
          ok: false,
          message: "Printer Bluetooth terputus. Hubungkan ulang melalui Pengaturan Printer sebelum mencetak.",
        };
      }
    }

    try {
      const CHUNK_SIZE = 100;
      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.slice(i, i + CHUNK_SIZE);
        if (activeBluetoothCharacteristic.writeValueWithoutResponse) {
          await activeBluetoothCharacteristic.writeValueWithoutResponse(chunk);
        } else if (activeBluetoothCharacteristic.writeValue) {
          await activeBluetoothCharacteristic.writeValue(chunk);
        } else {
          throw new Error("Printer Bluetooth tidak mendukung operasi tulis.");
        }
        await new Promise((r) => setTimeout(r, 15));
      }
      return { ok: true };
    } catch (error) {
      if (activeBluetoothDevice && activeBluetoothDisconnectHandler) {
        activeBluetoothDevice.removeEventListener?.("gattserverdisconnected", activeBluetoothDisconnectHandler);
      }
      activeBluetoothDevice = null;
      activeBluetoothCharacteristic = null;
      activeBluetoothDisconnectHandler = null;
      notifyStatusChange();
      return {
        ok: false,
        uncertain: true,
        message: `Gagal mengirim ke Bluetooth printer: ${errorMessage(error, "tanpa keterangan")}`,
      };
    }
  }

  // Mode Serial
  if (prefs.type === "serial") {
    if (!activeSerialPort?.writable) {
      const rec = await tryAutoReconnect();
      if (!rec.ok || !activeSerialPort?.writable) {
        return { ok: false, message: "Port serial printer belum terhubung atau terputus." };
      }
    }

    const port = activeSerialPort;
    try {
      const writer = port.writable!.getWriter();
      try {
        await writer.write(data);
      } finally {
        writer.releaseLock();
      }
      return { ok: true };
    } catch (error) {
      activeSerialPort = null;
      await port.close().catch(() => undefined);
      notifyStatusChange();
      return {
        ok: false,
        uncertain: true,
        message: `Gagal menulis ke Serial printer: ${errorMessage(error, "tanpa keterangan")}`,
      };
    }
  }

  // Mode USB Langsung (WebUSB)
  if (prefs.type === "usb") {
    if (!activeUsbDevice || !activeUsbEndpoint) {
      const rec = await tryAutoReconnect();
      if (!rec.ok || !activeUsbDevice || !activeUsbEndpoint) {
        return { ok: false, message: "Kabel USB printer belum terhubung atau terputus." };
      }
    }

    try {
      const result = await activeUsbDevice.transferOut(activeUsbEndpoint.endpointNumber, data);
      if (result.status !== "ok" || result.bytesWritten !== data.byteLength) {
        return { ok: false, uncertain: true, message: "Transfer USB tidak lengkap. Periksa hasil cetak sebelum mengulang." };
      }
      return { ok: true };
    } catch (error) {
      activeUsbDevice = null;
      activeUsbEndpoint = null;
      notifyStatusChange();
      return { ok: false, uncertain: true, message: `Gagal menulis ke USB printer: ${errorMessage(error, "tanpa keterangan")}` };
    }
  }

  if (prefs.type === "kiosk") {
    return {
      ok: false,
      message: "Printer disetel ke Mode Kiosk. Gunakan pencetakan otomatis driver browser.",
    };
  }

  return { ok: false, message: "Belum ada printer thermal yang terhubung." };
}

/**
 * Uji coba cetak struk tester singkat.
 */
export async function printTestReceipt(): Promise<{ ok: boolean; message?: string }> {
  const prefs = getPrinterPreferences();
  return sendEscPosToPrinter(
    buildTestReceiptEscPos({
      paperWidth: prefs.paperWidth,
      type: prefs.type,
      cutPaper: prefs.cutPaper,
    }),
  );
}

/**
 * Putuskan koneksi printer aktif.
 */
export function disconnectActivePrinter(): void {
  if (activeBluetoothDevice && activeBluetoothDisconnectHandler) {
    activeBluetoothDevice.removeEventListener?.("gattserverdisconnected", activeBluetoothDisconnectHandler);
  }
  try {
    if (activeBluetoothDevice?.gatt?.connected) {
      activeBluetoothDevice.gatt.disconnect();
    }
  } catch {
    // Abaikan
  }
  activeBluetoothDevice = null;
  activeBluetoothCharacteristic = null;
  activeBluetoothDisconnectHandler = null;

  try {
    if (activeSerialPort) {
      void activeSerialPort.close().catch(() => undefined);
    }
  } catch {
    // Abaikan
  }
  activeSerialPort = null;

  try {
    if (activeUsbDevice) {
      void activeUsbDevice.close().catch(() => undefined);
    }
  } catch {
    // Abaikan
  }
  activeUsbDevice = null;
  activeUsbEndpoint = null;

  savePrinterPreferences({
    type: "none",
    name: "Belum terhubung",
    bluetoothDeviceId: null,
    usbSerialNumber: null,
  });
  notifyStatusChange();
}
