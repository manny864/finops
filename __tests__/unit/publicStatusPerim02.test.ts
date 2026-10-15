// @vitest-environment node
/**
 * PERIM-02 — Estado público desacoplado del backend.
 *
 * Aceptación del plan: query strings distintos y ráfagas concurrentes no
 * aumentan las lecturas por TTL/réplica; un fallo del backend activa backoff y
 * 503 (nunca 100%); un snapshot caducado no se presenta como actual; el DTO
 * público no expone versión ni latencias.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock("@/modules/storage/db", () => ({
    default: { query: mockQuery },
    initializeDatabase: vi.fn(),
}));

import { GET } from "@/app/api/status/route";
import {
    CACHE_TTL_MS,
    FAILURE_BACKOFF_MS,
    MAX_SNAPSHOT_AGE_MS,
    readPublicStatus,
    __resetPublicStatusCacheForTests,
} from "@/lib/publicStatus";

const NOW = new Date("2026-10-14T12:00:00Z").getTime();

function snapshot(overrides: Record<string, unknown> = {}) {
    return [[{
        overall_status: "degraded",
        captured_at: new Date(NOW - 2 * 60_000),
        components_json: [
            { name: "API", status: "operational" },
            { name: "Database", status: "degraded", latency_ms: 812 },
            { name: "<img src=x>", status: "operational" },
            { name: "Paddle Billing", status: "pwned" },
        ],
        ...overrides,
    }]];
}
const stats = [[{ total: "200", down_count: "2", degraded_count: "10", incidents: "1" }]];

function primeOk() {
    mockQuery.mockImplementation(async (sql: string) =>
        sql.includes("LIMIT 1") ? snapshot() : stats
    );
}

/** Next pasa la request al handler; la ruta la ignora a propósito. */
const callGET = GET as unknown as (req?: Request) => Promise<Response>;

describe("PERIM-02 — /api/status sirve snapshots sin trabajo por petición", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(NOW);
        mockQuery.mockReset();
        __resetPublicStatusCacheForTests();
        vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("no ejecuta health checks: sólo lee el snapshot y sus agregados", async () => {
        primeOk();
        const res = await callGET();
        expect(res.status).toBe(200);
        const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
        expect(sqls).toHaveLength(2);
        expect(sqls).not.toContain("SELECT 1");
        expect(sqls.some((q) => q.includes("FROM Tenants"))).toBe(false);
    });

    it("query strings distintos y ráfagas concurrentes comparten una sola lectura por TTL", async () => {
        primeOk();
        const urls = Array.from({ length: 50 }, (_, i) => `https://x/api/status?bust=${i}`);
        const responses = await Promise.all(urls.map((u) => callGET(new Request(u))));
        expect(responses.every((r) => r.status === 200)).toBe(true);
        expect(mockQuery).toHaveBeenCalledTimes(2);

        await callGET(new Request("https://x/api/status?otra=1"));
        expect(mockQuery).toHaveBeenCalledTimes(2);

        vi.setSystemTime(NOW + CACHE_TTL_MS + 1);
        await callGET();
        expect(mockQuery).toHaveBeenCalledTimes(4);
    });

    it("publica un DTO sanitizado: sin versión, sin latencias, componentes en allowlist", async () => {
        process.env.APP_VERSION = "deadbeef";
        primeOk();
        const json = await (await callGET()).json();
        delete process.env.APP_VERSION;
        expect(json).toEqual({
            status: "degraded",
            timestamp: new Date(NOW - 2 * 60_000).toISOString(),
            components: [
                { name: "API", status: "operational" },
                { name: "Database", status: "degraded" },
            ],
            uptime_30d_pct: 99,
            degraded_30d_pct: 5,
            incidents_last_30d: 1,
        });
    });

    it("acepta components_json como texto (columna TEXT) y descarta JSON inválido", async () => {
        mockQuery
            .mockResolvedValueOnce(snapshot({ components_json: '[{"name":"API","status":"down"}]' }))
            .mockResolvedValueOnce(stats);
        expect((await readPublicStatus())?.components).toEqual([{ name: "API", status: "down" }]);

        __resetPublicStatusCacheForTests();
        mockQuery
            .mockResolvedValueOnce(snapshot({ components_json: "{no-json" }))
            .mockResolvedValueOnce(stats);
        expect((await readPublicStatus())?.components).toEqual([]);
    });

    it("fallo del backend: 503 unknown sin 100%, y backoff sin reintentar contra MySQL", async () => {
        mockQuery.mockRejectedValue(new Error("ECONNREFUSED"));
        const res = await callGET();
        expect(res.status).toBe(503);
        expect(res.headers.get("retry-after")).toBe("30");
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(await res.json()).toEqual({ status: "unknown" });
        expect(mockQuery).toHaveBeenCalledTimes(1);

        await Promise.all(Array.from({ length: 20 }, () => callGET()));
        expect(mockQuery).toHaveBeenCalledTimes(1);

        vi.setSystemTime(NOW + FAILURE_BACKOFF_MS + 1);
        primeOk();
        expect((await callGET()).status).toBe(200);
    });

    it("snapshot caducado (el cron dejó de correr) no se presenta como actual", async () => {
        mockQuery.mockResolvedValue(snapshot({ captured_at: new Date(NOW - MAX_SNAPSHOT_AGE_MS - 1000) }));
        expect((await callGET()).status).toBe(503);
    });

    it("snapshot con fecha futura o estado inválido es desconocido", async () => {
        mockQuery.mockResolvedValue(snapshot({ captured_at: new Date(NOW + 10 * 60_000) }));
        expect((await callGET()).status).toBe(503);

        __resetPublicStatusCacheForTests();
        mockQuery.mockReset();
        mockQuery.mockResolvedValue(snapshot({ overall_status: "operational<script>" }));
        expect((await callGET()).status).toBe(503);
    });

    it("sin snapshots o sin estadísticas no inventa disponibilidad", async () => {
        mockQuery.mockResolvedValueOnce([[]]);
        expect(await readPublicStatus()).toBeNull();

        __resetPublicStatusCacheForTests();
        mockQuery
            .mockResolvedValueOnce(snapshot())
            .mockResolvedValueOnce([[{ total: 0, down_count: 0, degraded_count: 0, incidents: 0 }]]);
        expect(await readPublicStatus()).toBeNull();
    });

    it("OPTIONS responde 204 sin cuerpo", async () => {
        const { OPTIONS } = await import("@/app/api/status/route");
        const res = await OPTIONS();
        expect(res.status).toBe(204);
        expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    });
});

describe("PERIM-02 — la página /status no se pide a sí misma por HTTP", () => {
    const page = readFileSync("src/app/[locale]/status/page.tsx", "utf8");

    it("lee el estado con readPublicStatus y contempla el estado desconocido", () => {
        expect(page).toContain("readPublicStatus()");
        expect(page).not.toMatch(/fetch\([^)]*\/api\/status`/);
        expect(page).toContain('t("bannerUnknown")');
    });

    it("no muestra versión ni latencias", () => {
        expect(page).not.toContain("version");
        expect(page).not.toContain("latency");
    });
});
