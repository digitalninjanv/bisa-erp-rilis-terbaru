import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useOfflineQueue } from "@/components/pos/use-offline-queue";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/actions/pos-offline", () => ({ syncOfflineSalesAction: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

function Indicator() {
  const { online } = useOfflineQueue({ posOfflineEnabled: true, companyId: "test", userId: "cashier" });
  return createElement("span", null, online ? "Online" : "Offline");
}

it.each([undefined, {}, { onLine: false }, { onLine: true }])(
  "uses a stable initial server snapshot with navigator=%j", (navigator) => {
    vi.stubGlobal("navigator", navigator);
    expect(renderToString(createElement(Indicator))).toBe("<span>Online</span>");
  },
);
