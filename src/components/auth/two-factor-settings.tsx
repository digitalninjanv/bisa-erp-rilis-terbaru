"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Enrollment = {
  totpURI: string;
  backupCodes: string[];
};

export function TwoFactorSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void authClient.getSession().then((result) => {
      if (cancelled) return;
      const user = result.data?.user as { twoFactorEnabled?: boolean } | undefined;
      setEnabled(Boolean(user?.twoFactorEnabled));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!enrollment?.totpURI) return;
    void QRCode.toDataURL(enrollment.totpURI, { margin: 1, width: 220 }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [enrollment]);

  async function enable() {
    if (password.length < 8) {
      toast.error("Masukkan kata sandi akun untuk mengaktifkan 2FA.");
      return;
    }
    setPending(true);
    const result = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (result.error) {
      toast.error(result.error.message ?? "2FA gagal diaktifkan.");
      return;
    }
    const data = result.data as { totpURI?: string; backupCodes?: string[] };
    if (!data.totpURI || !data.backupCodes) {
      toast.error("Server tidak mengembalikan data enrollment 2FA.");
      return;
    }
    setQrDataUrl(null);
    setEnrollment({ totpURI: data.totpURI, backupCodes: data.backupCodes });
    setPassword("");
    toast.success("Pindai QR, lalu masukkan kode 6 digit untuk mengaktifkan.");
  }

  async function verify() {
    setPending(true);
    const result = await authClient.twoFactor.verifyTotp({ code: code.trim() });
    setPending(false);
    if (result.error) {
      toast.error(result.error.message ?? "Kode tidak valid.");
      return;
    }
    setEnabled(true);
    setEnrollment(null);
    setQrDataUrl(null);
    setCode("");
    toast.success("Verifikasi dua langkah aktif.");
  }

  async function disable() {
    if (password.length < 8) {
      toast.error("Masukkan kata sandi akun untuk menonaktifkan 2FA.");
      return;
    }
    setPending(true);
    const result = await authClient.twoFactor.disable({ password });
    setPending(false);
    if (result.error) {
      toast.error(result.error.message ?? "2FA gagal dinonaktifkan.");
      return;
    }
    setEnabled(false);
    setPassword("");
    toast.success("Verifikasi dua langkah dinonaktifkan.");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-3">
        {enabled ? (
          <ShieldCheck className="size-4 text-tone-green" />
        ) : (
          <ShieldOff className="size-4 text-muted-foreground" />
        )}
        <p className="flex-1 text-[12px]">
          {enabled === null
            ? "Memeriksa status 2FA…"
            : enabled
              ? "Verifikasi dua langkah aktif untuk akun ini."
              : "Verifikasi dua langkah belum aktif. Disarankan untuk owner dan admin."}
        </p>
      </div>

      {enrollment ? (
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <h2 className="text-[13px] font-semibold">Pindai QR authenticator</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Simpan kode cadangan di tempat aman. Kode cadangan hanya ditampilkan sekali.
          </p>
          <div className="mt-3 flex flex-wrap items-start gap-4">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="QR TOTP" className="size-44 rounded border border-border bg-white p-1" />
            ) : (
              <div className="grid size-44 place-items-center rounded border border-border text-[11px] text-muted-foreground">
                Membuat QR…
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <p className="text-[11px] font-medium">Kode cadangan</p>
                <pre className="num mt-1 max-h-32 overflow-auto rounded bg-muted px-2 py-1.5 text-[11px]">
                  {enrollment.backupCodes.join("\n")}
                </pre>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="totp-verify">Kode 6 digit</Label>
                <div className="flex gap-2">
                  <Input
                    id="totp-verify"
                    inputMode="numeric"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="123456"
                  />
                  <Button type="button" onClick={() => void verify()} disabled={pending || code.trim().length < 6}>
                    {pending ? <Loader2 className="size-4 animate-spin" /> : "Aktifkan"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : enabled ? (
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <h2 className="text-[13px] font-semibold">Nonaktifkan 2FA</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Konfirmasi dengan kata sandi akun. Kode cadangan lama akan dihapus.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Kata sandi akun"
              className="max-w-xs"
            />
            <Button type="button" variant="destructive" onClick={() => void disable()} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : "Nonaktifkan 2FA"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <h2 className="text-[13px] font-semibold">Aktifkan 2FA</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Gunakan aplikasi authenticator (Google Authenticator, Authy, 1Password). Kata sandi akun diperlukan.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Kata sandi akun"
              className="max-w-xs"
            />
            <Button type="button" onClick={() => void enable()} disabled={pending || enabled === null}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : "Aktifkan 2FA"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
