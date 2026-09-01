import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const poolQueryMock = vi.fn();

vi.mock("@/modules/storage/db", () => ({
    default: { query: (...args: unknown[]) => poolQueryMock(...args) },
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn().mockResolvedValue({ tenantId: "test-tenant" }),
    AuthError: class AuthError extends Error {
        status = 401;
    },
}));

vi.mock("@/lib/mockData", () => ({
    isMockTenant: () => false,
    getMockDataForRoute: () => ({ totalGb: 100, totalCost: 10 }),
}));

import { GET } from "@/app/api/intelligence/storage-efficiency/history/route";

// MEJ-31: el test hardcodeaba "2025-08"/"2025-09" asumiendo que la ventana de
// 13 meses (calculada por la ruta con `new Date()` real) siempre iba a tener
// a "2025-08" como el mes más viejo. Eso sólo era cierto mientras "hoy" caía
// dentro de agosto de 2026 -- rompía cada vez que el reloj cruzaba a
// septiembre, y volvía a romper el mes siguiente contra "2025-09". Se fija el
// reloj con un `now` de prueba y los meses esperados se calculan a partir de
// ÉL, con la MISMA fórmula que usa la ruta, en vez de escribirlos sueltos.
const FAKE_NOW = new Date(2026, 7, 15); // 15 de agosto de 2026 -- lejos de cualquier borde de mes.

/** "YYYY-MM" de `monthsAgo` meses antes de `base` -- mismo cálculo que
 *  `src/app/api/intelligence/storage-efficiency/history/route.ts`
 *  (`new Date(year, month - i, 1)`, día fijo para no toparse con el bug
 *  clásico de `setMonth` en fin de mes). */
function monthKey(base: Date, monthsAgo: number): string {
    const d = new Date(base.getFullYear(), base.getMonth() - monthsAgo, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

describe("storage-efficiency history route", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(FAKE_NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("devuelve 13 meses de histórico agrupados por mes", async () => {
        // Los dos meses más viejos de la ventana de 13 (i=12 e i=11), derivados
        // de FAKE_NOW -- no strings sueltos.
        const oldestMonth = monthKey(FAKE_NOW, 12);
        const secondOldestMonth = monthKey(FAKE_NOW, 11);

        poolQueryMock.mockResolvedValueOnce([
            [
                { month: oldestMonth, totalCost: 12.5, totalGb: 500 },
                { month: secondOldestMonth, totalCost: 15.0, totalGb: 600 },
            ],
        ]);

        const req = {
            url: "http://localhost/api/intelligence/storage-efficiency/history?tenantId=test-tenant",
            headers: new Headers(),
        } as any;

        const res = await GET(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.history.length).toBe(13);
        const itemOldest = body.history.find((h: any) => h.month === oldestMonth);
        const itemSecond = body.history.find((h: any) => h.month === secondOldestMonth);
        expect(itemOldest?.totalCost).toBe(12.5);
        expect(itemSecond?.momChangePercent).toBe(20); // (15 - 12.5)/12.5 * 100 = 20%
    });

    it("requiere tenantId", async () => {
        const req = {
            url: "http://localhost/api/intelligence/storage-efficiency/history",
            headers: new Headers(),
        } as any;

        const res = await GET(req);
        expect(res.status).toBe(400);
    });
});
