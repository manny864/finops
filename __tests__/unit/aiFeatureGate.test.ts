// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, globalMock, rlMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    globalMock: vi.fn(),
    rlMock: vi.fn(),
}));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/services/aiService", () => ({ isAiGloballyEnabled: globalMock }));
vi.mock("@/lib/rateLimiter", () => ({ default: { checkByKeyDistributed: rlMock } }));

import { checkAiFeature } from "@/lib/aiFeatureGate";

const PRO = { tier: "Professional", ai_enabled: 1, ai_provider: "system", ai_api_key: null };
const tenant = (row: object | null) => queryMock.mockResolvedValueOnce([row ? [row] : []]);
const used = (c: number) => queryMock.mockResolvedValueOnce([[{ c }]]);
const check = () => checkAiFeature("t1", "anomaly-explanation", "ana@x.com");

beforeEach(() => {
    queryMock.mockReset();
    globalMock.mockReset();
    globalMock.mockResolvedValue(true);
    rlMock.mockReset();
    rlMock.mockResolvedValue({ allowed: true, resetAt: new Date() });
});

describe("checkAiFeature", () => {
    it("el interruptor global corta antes de leer el tenant", async () => {
        globalMock.mockResolvedValue(false);
        expect(await check()).toEqual({ allowed: false, reason: "global_disabled" });
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("IA apagada en el tenant, o tenant sin fila: tenant_disabled", async () => {
        tenant({ ...PRO, ai_enabled: 0 });
        expect(await check()).toEqual({ allowed: false, reason: "tenant_disabled" });
        tenant(null);
        expect(await check()).toEqual({ allowed: false, reason: "tenant_disabled" });
    });

    it("un tier desconocido no abre la feature", async () => {
        tenant({ ...PRO, tier: "Platinum" });
        expect(await check()).toEqual({ allowed: false, reason: "tier" });
    });

    it("el mapeo de CSV pide Business, como la página de upload", async () => {
        const csv = () => checkAiFeature("t1", "billing-csv-column-mapping", "ana@x.com");
        tenant(PRO);
        expect(await csv()).toEqual({ allowed: false, reason: "tier" });
        tenant({ ...PRO, tier: "Business" });
        used(0);
        expect(await csv()).toEqual({ allowed: true });
    });

    it("rate limit por feature, tenant y usuario, antes de contar la cuota", async () => {
        tenant(PRO);
        rlMock.mockResolvedValue({ allowed: false, resetAt: new Date() });
        expect(await check()).toEqual({ allowed: false, reason: "rate_limited" });
        expect(rlMock).toHaveBeenCalledWith("ai:anomaly-explanation:t1:ana@x.com", 10, 60_000);
        expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it("cuota mensual: cuenta sólo lo que pagó la plataforma para esa feature", async () => {
        tenant(PRO);
        used(50);
        expect(await check()).toEqual({ allowed: false, reason: "quota" });
        const [sql, params] = queryMock.mock.calls[1];
        expect(sql).toContain("source = 'platform'");
        expect(sql).toContain("DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')");
        expect(params).toEqual(["t1", "anomaly-explanation"]);

        tenant(PRO);
        used(49);
        expect(await check()).toEqual({ allowed: true });
    });

    it("BYOK y Enterprise no tienen cuota: no se consulta el uso", async () => {
        tenant({ ...PRO, ai_provider: "openai", ai_api_key: "enc:..." });
        expect(await check()).toEqual({ allowed: true });
        tenant({ ...PRO, tier: "Enterprise" });
        expect(await check()).toEqual({ allowed: true });
        expect(queryMock).toHaveBeenCalledTimes(2);
    });
});
