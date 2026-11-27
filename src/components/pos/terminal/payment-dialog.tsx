"use client";

import type { ComponentProps, CSSProperties } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PaymentPanel } from "@/components/pos/payment-panel";

type PaymentPanelProps = ComponentProps<typeof PaymentPanel>;

/**
 * Panel pembayaran fokus: baru muncul setelah kasir menekan Bayar.
 * Dialog di-portal ke body, jadi token warna POS dikirim eksplisit
 * (pos-terminal-surface + themeStyle) agar tidak kehilangan palet.
 */
export function PaymentDialog({
  open,
  onOpenChange,
  onClose,
  themeStyle,
  tenderedInputId = "pos-tendered-input",
  ...panelProps
}: Omit<
  PaymentPanelProps,
  "embedded" | "onClose" | "themeStyle" | "tenderedInputId"
> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClose: () => void;
  themeStyle?: CSSProperties;
  tenderedInputId?: string;
}) {
  const { setHoldOpen, ...panel } = panelProps;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="pos-terminal-surface max-h-[92dvh] max-w-[calc(100%-2rem)] gap-0 overflow-y-auto bg-[var(--pos-panel)] p-0 sm:max-w-md"
        style={themeStyle}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Pembayaran</DialogTitle>
        <PaymentPanel
          {...panel}
          embedded
          onClose={onClose}
          themeStyle={themeStyle}
          tenderedInputId={tenderedInputId}
          setHoldOpen={(value) => {
            onClose();
            setHoldOpen(value);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
