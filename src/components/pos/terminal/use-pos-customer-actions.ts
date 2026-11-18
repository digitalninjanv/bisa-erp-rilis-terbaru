"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { quickAddCustomerAction, searchCustomersAction } from "@/server/actions/pos";
import type { CustomerOption } from "@/components/pos/terminal-types";

export function usePosCustomerActions(params: {
  debtActive: boolean;
  customer: CustomerOption | null;
  setCustomer: (customer: CustomerOption | null) => void;
  customerQuery: string;
  setCustomerResults: (results: CustomerOption[]) => void;
  setCustomerSearching: (searching: boolean) => void;
  quickName: string;
  quickPhone: string;
  setQuickName: (name: string) => void;
  setQuickPhone: (phone: string) => void;
  setQuickAddOpen: (open: boolean) => void;
  setQuickBusy: (busy: boolean) => void;
}) {
  const {
    debtActive,
    customer,
    setCustomer,
    customerQuery,
    setCustomerResults,
    setCustomerSearching,
    quickName,
    quickPhone,
    setQuickName,
    setQuickPhone,
    setQuickAddOpen,
    setQuickBusy,
  } = params;

  useEffect(() => {
    if (!debtActive || customer) return;
    let active = true;
    const timer = setTimeout(() => {
      void (async () => {
        setCustomerSearching(true);
        try {
          const result = await searchCustomersAction(customerQuery.trim());
          if (active && result.ok) setCustomerResults(result.data);
        } catch {
          // Gagal jaringan: daftar dibiarkan; kasir dapat mengetik ulang.
        } finally {
          if (active) setCustomerSearching(false);
        }
      })();
    }, 220);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [customerQuery, debtActive, customer, setCustomerResults, setCustomerSearching]);

  async function quickAddCustomer() {
    if (quickName.trim().length < 2) {
      toast.error("Nama pelanggan wajib diisi (minimal 2 karakter).");
      return;
    }
    setQuickBusy(true);
    try {
      const result = await quickAddCustomerAction({
        name: quickName.trim(),
        phone: quickPhone.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setCustomer(result.data);
      setQuickAddOpen(false);
      setQuickName("");
      setQuickPhone("");
      toast.success(`Pelanggan ${result.data.name} ditambahkan & dipilih.`);
    } catch {
      toast.error("Gagal menambah pelanggan. Periksa koneksi lalu coba lagi.");
    } finally {
      setQuickBusy(false);
    }
  }

  return { quickAddCustomer };
}
