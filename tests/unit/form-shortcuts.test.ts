import { describe, expect, it, vi } from "vitest";
import { handleFormKeyboardShortcut } from "@/lib/use-form-shortcuts";

describe("handleFormKeyboardShortcut — Enterprise Form Ergonomics", () => {
  it("memanggil onSubmit saat menekan Ctrl+Enter", () => {
    const onSubmit = vi.fn();
    const preventDefault = vi.fn();

    const handled = handleFormKeyboardShortcut(
      { key: "Enter", ctrlKey: true, preventDefault },
      { onSubmit },
    );

    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("memanggil onSubmit saat menekan Cmd+Enter (Mac metaKey)", () => {
    const onSubmit = vi.fn();
    const preventDefault = vi.fn();

    const handled = handleFormKeyboardShortcut(
      { key: "Enter", metaKey: true, preventDefault },
      { onSubmit },
    );

    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("tidak memanggil onSubmit saat disabled === true", () => {
    const onSubmit = vi.fn();

    const handled = handleFormKeyboardShortcut(
      { key: "Enter", ctrlKey: true },
      { onSubmit, disabled: true },
    );

    expect(handled).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("memanggil onCancel saat menekan Escape", () => {
    const onCancel = vi.fn();

    const handled = handleFormKeyboardShortcut(
      { key: "Escape" },
      { onCancel },
    );

    expect(handled).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("mengabaikan tombol biasa seperti 'a' atau 'Enter' tanpa modifier", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    const enterHandled = handleFormKeyboardShortcut(
      { key: "Enter" },
      { onSubmit, onCancel },
    );
    expect(enterHandled).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();

    const aHandled = handleFormKeyboardShortcut(
      { key: "a" },
      { onSubmit, onCancel },
    );
    expect(aHandled).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
