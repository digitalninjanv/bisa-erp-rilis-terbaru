"use client";

import type { ComponentProps } from "react";
import { CartPanel } from "@/components/pos/cart-panel";
import { PaymentPanel } from "@/components/pos/payment-panel";
import { MobileCartHeader } from "@/components/pos/terminal/mobile-pay-bar";

type CartPanelProps = ComponentProps<typeof CartPanel>;
type PaymentPanelProps = ComponentProps<typeof PaymentPanel>;

/** Panel keranjang dan pembayaran yang dipakai ulang untuk desktop dan sheet mobile. */
export function PosCheckoutWorkspace({
  cartProps,
  paymentProps,
  mobile = false,
  onClose,
}: {
  cartProps: CartPanelProps;
  paymentProps: PaymentPanelProps;
  mobile?: boolean;
  onClose?: () => void;
}) {
  return (
    <div className="min-w-0 space-y-3">
      {mobile ? (
        <MobileCartHeader
          count={cartProps.cart.length}
          total={cartProps.total}
          onClose={onClose ?? (() => {})}
        />
      ) : null}
      <CartPanel {...cartProps} scrollMode={mobile ? "page" : "contained"} compactHeader={mobile} />
      <PaymentPanel
        key={paymentProps.lastSale?.id ?? "payment-new"}
        {...paymentProps}
        tenderedInputId={mobile ? "pos-tendered-input-mobile" : "pos-tendered-input"}
      />
    </div>
  );
}
