import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field } from "@/components/blocks/field";

describe("FORM-STANDARD: Field", () => {
  it("menandai field wajib untuk visual dan pembaca layar", () => {
    const html = renderToStaticMarkup(
      // eslint-disable-next-line react/no-children-prop
      createElement(Field, {
        label: "Nama produk",
        required: true,
        children: createElement("input", { name: "name" }),
      }),
    );
    expect(html).toContain("Nama produk");
    expect(html).toContain("wajib diisi");
    expect(html).toContain('aria-required="true"');
  });

  it("menghubungkan hint dan error ke kontrol tunggal", () => {
    const html = renderToStaticMarkup(
      // eslint-disable-next-line react/no-children-prop
      createElement(Field, {
        label: "SKU",
        hint: "Harus unik",
        error: "SKU sudah dipakai",
        children: createElement("input", { name: "sku" }),
      }),
    );
    expect(html).toContain("Harus unik");
    expect(html).toContain("SKU sudah dipakai");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/aria-describedby="[^"]+"/);
    expect(html).toContain('role="alert"');
  });
});
