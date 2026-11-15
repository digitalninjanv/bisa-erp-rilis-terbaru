import { describe, expect, it } from "vitest";
import { findPurchaseOrderPriceVariances } from "@/lib/purchase-order-price-variance";
import { calculateLinkedSupplierReturnValuation } from "@/lib/supplier-return-valuation";

describe("purchase receipt PO price comparison", () => {
  it("compares weighted base-unit receipt cost and combines batch-split lines", () => {
    const rows = findPurchaseOrderPriceVariances(
      [{ productId: "p1", productName: "Beras", unitCost: "12000.0000" }],
      [
        { productId: "p1", name: "Beras", qty: "2", stockUnitCost: "11500" },
        { productId: "p1", name: "Beras", qty: "3", stockUnitCost: "12000" },
      ],
    );

    expect(rows).toEqual([{
      productId: "p1",
      name: "Beras",
      qty: "5.0000",
      expectedUnitCost: "12000.0000",
      receivedUnitCost: "11800.0000",
      differenceUnitCost: "-200.0000",
      differenceAmount: "-1000.0000",
    }]);
  });

  it("does not create a variance below the persisted four-decimal precision", () => {
    expect(findPurchaseOrderPriceVariances(
      [{ productId: "p1", unitCost: "100.0000" }],
      [{ productId: "p1", qty: "1", stockUnitCost: "100.00001" }],
    )).toEqual([]);
  });
});

describe("supplier return invoice and AVCO valuation", () => {
  it("keeps stock at AVCO while valuing the supplier claim from the source invoice", () => {
    const result = calculateLinkedSupplierReturnValuation({
      sourceLines: [{ id: "l1", qty: "10", lineTotal: "120000" }],
      returnLines: [{ receiptLineId: "l1", qty: "2" }],
      receiptTotal: "133200",
      receiptTaxAmount: "13200",
      inventoryValue: "22000",
    });

    expect(result).toEqual({
      invoiceNetValue: "24000.0000",
      taxValue: "2640.0000",
      invoiceCreditValue: "26640.0000",
      inventoryVariance: "2000.0000",
      taxIncludedInLineValue: false,
    });
  });

  it("extracts tax when the source invoice price already includes it", () => {
    const result = calculateLinkedSupplierReturnValuation({
      sourceLines: [{ id: "l1", qty: "10", lineTotal: "133200" }],
      returnLines: [{ receiptLineId: "l1", qty: "2" }],
      receiptTotal: "133200",
      receiptTaxAmount: "13200",
      inventoryValue: "24000",
    });

    expect(result).toEqual({
      invoiceNetValue: "24000.0000",
      taxValue: "2640.0000",
      invoiceCreditValue: "26640.0000",
      inventoryVariance: "0.0000",
      taxIncludedInLineValue: true,
    });
  });

  it("refuses to value a return if the stored source invoice does not reconcile", () => {
    expect(calculateLinkedSupplierReturnValuation({
      sourceLines: [{ id: "l1", qty: "10", lineTotal: "120000" }],
      returnLines: [{ receiptLineId: "l1", qty: "2" }],
      receiptTotal: "140000",
      receiptTaxAmount: "13200",
      inventoryValue: "22000",
    })).toBeNull();
  });
});
