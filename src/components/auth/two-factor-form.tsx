"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function TwoFactorForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp({ code: code.trim(), trustDevice: true })
        : await authClient.twoFactor.verifyBackupCode({ code: code.trim() });
    if (result.error) {
      setError(result.error.message ?? "Kode tidak valid atau sudah kedaluwarsa.");
      setPending(false);
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px]">
        <ShieldCheck className="size-4 text-primary" />
        <p>
          {mode === "totp"
            ? "Masukkan 6 digit dari aplikasi authenticator."
            : "Masukkan salah satu kode cadangan yang Anda simpan saat mengaktifkan 2FA."}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="code">{mode === "totp" ? "Kode authenticator" : "Kode cadangan"}</Label>
        <Input
          id="code"
          inputMode={mode === "totp" ? "numeric" : "text"}
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={mode === "totp" ? "123456" : "XXXX-XXXX"}
          required
        />
      </div>

      <Button type="submit" className="h-10 w-full" disabled={pending || code.trim().length < 6}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {pending ? "Memverifikasi..." : "Verifikasi & masuk"}
      </Button>

      <button
        type="button"
        onClick={() => {
          setMode((current) => (current === "totp" ? "backup" : "totp"));
          setCode("");
          setError(null);
        }}
        className="w-full text-center text-[11px] font-medium text-muted-foreground underline-offset-2 hover:underline"
      >
        {mode === "totp" ? "Gunakan kode cadangan" : "Kembali ke kode authenticator"}
      </button>
    </form>
  );
}
