"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bootstrapSetupAction } from "@/server/actions/setup";

export function SetupForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({
    token: "",
    companyName: "",
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
    branchName: "Toko Utama",
    warehouseName: "Gudang Utama",
    address: "",
    phone: "",
  });

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await bootstrapSetupAction(form);
    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }
    window.location.href = "/login?setup=done";
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="token">Token setup</Label>
        <Input
          id="token"
          value={form.token}
          onChange={(event) => set("token", event.target.value)}
          autoComplete="off"
          required
        />
        <p className="text-[11px] text-muted-foreground">
          Tertera sebagai BISA_SETUP_TOKEN di file env server (mode 600).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="companyName">Nama perusahaan / toko</Label>
          <Input
            id="companyName"
            value={form.companyName}
            onChange={(event) => set("companyName", event.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ownerName">Nama owner</Label>
          <Input
            id="ownerName"
            value={form.ownerName}
            onChange={(event) => set("ownerName", event.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ownerEmail">Email login owner</Label>
          <Input
            id="ownerEmail"
            type="email"
            autoComplete="email"
            value={form.ownerEmail}
            onChange={(event) => set("ownerEmail", event.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ownerPassword">Kata sandi owner</Label>
          <Input
            id="ownerPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={form.ownerPassword}
            onChange={(event) => set("ownerPassword", event.target.value)}
            required
          />
          <p className="text-[11px] text-muted-foreground">Minimal 12 karakter. Tidak dicetak atau dikirim ke mana pun.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="branchName">Nama cabang</Label>
          <Input id="branchName" value={form.branchName} onChange={(event) => set("branchName", event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="warehouseName">Nama gudang</Label>
          <Input id="warehouseName" value={form.warehouseName} onChange={(event) => set("warehouseName", event.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="address">Alamat (opsional)</Label>
          <Input id="address" value={form.address} onChange={(event) => set("address", event.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="phone">Telepon (opsional)</Label>
          <Input id="phone" value={form.phone} onChange={(event) => set("phone", event.target.value)} />
        </div>
      </div>

      <Button type="submit" className="h-10 w-full" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {pending ? "Menyiapkan perusahaan..." : "Buat perusahaan & owner"}
      </Button>
    </form>
  );
}
