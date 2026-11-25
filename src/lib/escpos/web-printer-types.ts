/**
 * Tipe minimal Web Bluetooth / WebUSB / Web Serial untuk printer thermal.
 *
 * API perangkat ini belum ada di lib.dom TypeScript. Kontrak di bawah
 * sengaja hanya memuat permukaan yang dipakai `printer-connection.ts`
 * supaya tidak ada `any` yang lolos tanpa pemeriksaan. Dipisah dari
 * logika koneksi agar berkas utamanya tetap di bawah ratchet 800 baris.
 */

export interface BluetoothCharacteristicLike {
  properties: { write?: boolean; writeWithoutResponse?: boolean };
  writeValue?: (value: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
}

export interface BluetoothServiceLike {
  getCharacteristics(): Promise<BluetoothCharacteristicLike[]>;
}

export interface BluetoothServerLike {
  getPrimaryService(uuid: string): Promise<BluetoothServiceLike>;
  getPrimaryServices(): Promise<BluetoothServiceLike[]>;
}

export interface BluetoothDeviceLike {
  id: string;
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<BluetoothServerLike>;
    disconnect(): void;
  };
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface SerialWriterLike {
  write(data: Uint8Array): Promise<void>;
  releaseLock(): void;
}

export interface SerialPortLike {
  readable?: unknown;
  writable?: { getWriter(): SerialWriterLike } | null;
  getInfo?: () => { usbVendorId?: number; usbProductId?: number };
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

export interface UsbEndpointLike {
  endpointNumber: number;
  direction: string;
}

export interface UsbAlternateLike {
  alternateSetting?: number;
  interfaceClass?: number;
  endpoints?: UsbEndpointLike[];
}

export interface UsbInterfaceLike {
  interfaceNumber?: number;
  alternate?: UsbAlternateLike;
  alternates?: UsbAlternateLike[];
}

export interface UsbConfigurationLike {
  interfaces?: UsbInterfaceLike[];
}

export interface UsbDeviceLike {
  configuration: UsbConfigurationLike | null;
  productName?: string;
  serialNumber?: string;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(value: number): Promise<void>;
  selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void>;
  transferOut(endpointNumber: number, data: Uint8Array): Promise<{ status: string; bytesWritten: number }>;
}

export interface PrinterNavigator {
  bluetooth?: {
    requestDevice(options: unknown): Promise<BluetoothDeviceLike>;
    getDevices?: () => Promise<BluetoothDeviceLike[]>;
  };
  usb?: {
    requestDevice(options: unknown): Promise<UsbDeviceLike>;
    getDevices(): Promise<UsbDeviceLike[]>;
    addEventListener?(type: string, listener: () => void): void;
    removeEventListener?(type: string, listener: () => void): void;
  };
  serial?: {
    requestPort(): Promise<SerialPortLike>;
    getPorts(): Promise<SerialPortLike[]>;
    addEventListener?(type: string, listener: () => void): void;
    removeEventListener?(type: string, listener: () => void): void;
  };
}

export function printerNavigator(): PrinterNavigator | null {
  if (typeof navigator === "undefined") return null;
  return navigator as unknown as PrinterNavigator;
}

export function errorDetails(error: unknown): { name?: string; message?: string } {
  if (!error || typeof error !== "object") return {};
  const value = error as { name?: unknown; message?: unknown };
  return {
    name: typeof value.name === "string" ? value.name : undefined,
    message: typeof value.message === "string" ? value.message : undefined,
  };
}

export function isNotFoundError(error: unknown): boolean {
  return errorDetails(error).name === "NotFoundError";
}

export function errorMessage(error: unknown, fallback: string): string {
  return errorDetails(error).message || fallback;
}
