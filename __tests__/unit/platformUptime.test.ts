// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockPoolQuery: vi.fn() }));

vi.mock("@/modules/storage/db", () => ({
  default: { query: mocks.mockPoolQuery },
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

import { getUptime30d } from "@/services/platformUptime.service";

function snapshots(total: number, down: number, degraded: number) {
  mocks.mockPoolQuery.mockResolvedValueOnce([[{ total_count: total, down_count: down, degraded_count: degraded }]]);
}

describe("getUptime30d", () => {
  beforeEach(() => vi.clearAllMocks());

  // El caso que motivó el cambio: la página pública informaba 22,4% de
  // disponibilidad con la plataforma sirviendo tráfico, porque `degraded`
  // contaba como caída. Estos son los 7 días medidos el 2026-09-22.
  it("cuenta como downtime SOLO `down`", async () => {
    snapshots(2017, 3, 82);
    const r = await getUptime30d();
    expect(r.uptimePct).toBe(99.85);
    expect(r.degradedPct).toBe(4.07);
    expect(r.snapshots).toBe(2017);
  });

  it("no descuenta `degraded` del uptime aunque sea la mayoría", async () => {
    snapshots(100, 0, 90);
    expect((await getUptime30d()).uptimePct).toBe(100);
  });

  it("una plataforma enteramente caída da 0", async () => {
    snapshots(100, 100, 0);
    expect((await getUptime30d()).uptimePct).toBe(0);
  });

  it("sin snapshots asume operativo", async () => {
    snapshots(0, 0, 0);
    expect(await getUptime30d()).toEqual({ uptimePct: 100, degradedPct: 0, snapshots: 0 });
  });

  it("no tira si la query falla", async () => {
    mocks.mockPoolQuery.mockRejectedValueOnce(new Error("db down"));
    expect((await getUptime30d()).snapshots).toBe(0);
  });
});
