/** Audit-only POS offline snapshot benchmark (full + delta). */
import { readPosDeviceSnapshot } from "../../src/server/pos-device";

const ORG = "01900000-0000-7000-8000-000000000001";
const USER = "01900000-0000-7000-8000-000000000010";

const device = {
  companyId: ORG,
  userId: USER,
  label: "audit-bench",
  terminalId: "01900000-0000-7000-8000-0000000000aa",
  terminalName: "Audit Bench",
  warehouseId: null,
};

async function main() {
  const t0 = performance.now();
  const full = await readPosDeviceSnapshot(device);
  const fullMs = performance.now() - t0;
  const size = JSON.stringify(full).length;
  const t1 = performance.now();
  const delta = await readPosDeviceSnapshot(device, full.cursor);
  const deltaMs = performance.now() - t1;
  const deltaSize = JSON.stringify(delta).length;
  console.log(
    JSON.stringify(
      {
        full: { mode: full.mode, products: full.products.length, ms: Number(fullMs.toFixed(1)), bytes: size },
        delta: { mode: delta.mode, products: delta.products.length, ms: Number(deltaMs.toFixed(1)), bytes: deltaSize },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
