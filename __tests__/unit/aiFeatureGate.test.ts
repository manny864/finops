// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, globalMock, switchMock, rlMock, logMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    globalMock: vi.fn(),
    switchMock: vi.fn(),
    rlMock: vi.fn(),
    logMock: vi.fn(),
}));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/services/aiService", () => ({ isAiGloballyEnabled: globalMock, getAiFeatureSwitch: switchMock }));
vi.mock("@/lib/rateLimiter", () => ({ default: { checkByKeyDistributed: rlMock } }));
vi.mock("@/lib/aiTelemetry", () => ({ logAiEvent: logMock }));

import { AI_FEATURES, checkAiFeature, peekAiFeature } from "@/lib/aiFeatureGate";
import es from "../../messages/es.json";
import en from "../../messages/en.json";
import ptBR from "../../messages/pt-BR.json";

const PRO = { tier: "Professional", ai_enabled: 1, ai_provider: "system", ai_api_key: null };
const BIZ = { ...PRO, tier: "Business" };
const ENT = { ...PRO, tier: "Enterprise" };
const tenant = (row: object | null) => queryMock.mockResolvedValueOnce([row ? [row] : []]);
const used = (c: number) => queryMock.mockResolvedValueOnce([[{ c }]]);
const check = () => checkAiFeature("t1", "anomaly-explanation", "ana@x.com");
const csv = () => checkAiFeature("t1", "billing-csv-column-mapping", "ana@x.com");
const di = () => checkAiFeature("t1", "document-intelligence", "ana@x.com");

beforeEach(() => {
    queryMock.mockReset();
    globalMock.mockReset();
    globalMock.mockResolvedValue(true);
    switchMock.mockReset();
    switchMock.mockResolvedValue(null);
    rlMock.mockReset();
    rlMock.mockResolvedValue({ allowed: true, resetAt: new Date() });
});

describe("checkAiFeature", () => {
    it("registra cada decisión con su feature", async () => {
        switchMock.mockResolvedValue(false);
        await check();
        expect(logMock).toHaveBeenLastCalledWith("anomaly-explanation", { stage: "gate", outcome: "feature_disabled" });
        switchMock.mockResolvedValue(null);
        tenant(ENT);
        await check();
        expect(logMock).toHaveBeenLastCalledWith("anomaly-explanation", { stage: "gate", outcome: "allowed" });
    });

    it("el interruptor global corta antes de leer el tenant", async () => {
        globalMock.mockResolvedValue(false);
        expect(await check()).toEqual({ allowed: false, reason: "global_disabled" });
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("el interruptor de la feature corta antes de leer el tenant", async () => {
        switchMock.mockResolvedValue(false);
        expect(await check()).toEqual({ allowed: false, reason: "feature_disabled" });
        expect(switchMock).toHaveBeenCalledWith("anomaly-explanation");
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("sin interruptor guardado manda el default de la feature", async () => {
        const cfg = AI_FEATURES["anomaly-explanation"];
        cfg.defaultEnabled = false;
        try {
            expect(await check()).toEqual({ allowed: false, reason: "feature_disabled" });
            switchMock.mockResolvedValue(true);
            tenant(ENT);
            expect(await check()).toEqual({ allowed: true });
        } finally {
            cfg.defaultEnabled = true;
        }
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

    it("la explicación de anomalías pide Enterprise, como la pantalla", async () => {
        tenant(PRO);
        expect(await check()).toEqual({ allowed: false, reason: "tier" });
        tenant(BIZ);
        expect(await check()).toEqual({ allowed: false, reason: "tier" });
        tenant(ENT);
        expect(await check()).toEqual({ allowed: true });
    });

    it("el mapeo de CSV pide Business, como la página de upload", async () => {
        tenant(PRO);
        expect(await csv()).toEqual({ allowed: false, reason: "tier" });
        tenant(BIZ);
        used(0);
        expect(await csv()).toEqual({ allowed: true });
    });

    it("rate limit por feature, tenant y usuario, antes de contar la cuota", async () => {
        tenant(BIZ);
        rlMock.mockResolvedValue({ allowed: false, resetAt: new Date() });
        expect(await csv()).toEqual({ allowed: false, reason: "rate_limited" });
        expect(rlMock).toHaveBeenCalledWith("ai:billing-csv-column-mapping:t1:ana@x.com", 5, 60_000);
        expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it("cuota mensual: cuenta sólo lo que pagó la plataforma para esa feature", async () => {
        tenant(BIZ);
        used(150);
        expect(await csv()).toEqual({ allowed: false, reason: "quota" });
        const [sql, params] = queryMock.mock.calls[1];
        expect(sql).toContain("source = 'platform'");
        expect(sql).toContain("DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')");
        expect(params).toEqual(["t1", "billing-csv-column-mapping"]);

        tenant(BIZ);
        used(149);
        expect(await csv()).toEqual({ allowed: true });
    });

    it("BYOK y Enterprise no tienen cuota: no se consulta el uso", async () => {
        tenant({ ...BIZ, ai_provider: "openai", ai_api_key: "enc:..." });
        expect(await csv()).toEqual({ allowed: true });
        tenant(ENT);
        expect(await csv()).toEqual({ allowed: true });
        expect(queryMock).toHaveBeenCalledTimes(2);
    });

    it("soporte: apagado por defecto; prendido, abre desde Professional sin contar cuota", async () => {
        for (const feature of ["support-ticket-triage", "support-reply-draft"] as const) {
            switchMock.mockResolvedValue(null);
            expect(await checkAiFeature("t1", feature, "ana@x.com")).toEqual({ allowed: false, reason: "feature_disabled" });

            switchMock.mockResolvedValue(true);
            queryMock.mockClear();
            tenant(PRO);
            expect(await checkAiFeature("t1", feature, "ana@x.com")).toEqual({ allowed: true });
            expect(queryMock).toHaveBeenCalledTimes(1);

            // Si el tenant apagó la IA, sus tickets no se mandan al modelo.
            tenant({ ...PRO, ai_enabled: 0 });
            expect(await checkAiFeature("t1", feature, "ana@x.com")).toEqual({ allowed: false, reason: "tenant_disabled" });
        }
    });

    it("Document Intelligence arranca apagada: hace falta prenderla en superadmin", async () => {
        expect(await di()).toEqual({ allowed: false, reason: "feature_disabled" });
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("Document Intelligence pide Business y cuenta cuota aunque el tenant tenga BYOK", async () => {
        switchMock.mockResolvedValue(true);
        tenant(PRO);
        expect(await di()).toEqual({ allowed: false, reason: "tier" });
        tenant({ ...BIZ, ai_provider: "openai", ai_api_key: "enc:..." });
        used(150);
        expect(await di()).toEqual({ allowed: false, reason: "quota" });
        // Enterprise también tiene techo: cada página la paga la plataforma.
        tenant(ENT);
        used(499);
        expect(await di()).toEqual({ allowed: true });
        tenant(ENT);
        used(500);
        expect(await di()).toEqual({ allowed: false, reason: "quota" });
    });
});

describe("peekAiFeature", () => {
    it("decide igual que el gate sin gastar rate limit ni registrar telemetría", async () => {
        logMock.mockClear();
        rlMock.mockResolvedValue({ allowed: false, resetAt: new Date() });
        tenant(BIZ);
        used(0);
        expect(await peekAiFeature("t1", "billing-csv-column-mapping")).toEqual({ allowed: true });
        expect(rlMock).not.toHaveBeenCalled();
        expect(logMock).not.toHaveBeenCalled();
        tenant(BIZ);
        used(150);
        expect(await peekAiFeature("t1", "billing-csv-column-mapping")).toEqual({ allowed: false, reason: "quota" });
    });
});

// El panel del superadmin lista AI_FEATURES y rotula cada interruptor con su clave.
describe("rótulos de los interruptores por función", () => {
    it.each([["es", es], ["en", en], ["pt-BR", ptBR]] as const)("cada feature tiene nombre y descripción en %s", (_, msgs) => {
        const features = msgs.AdminAiConfigGlobal.featureSwitches.features as Record<string, { label?: string; description?: string }>;
        for (const id of Object.keys(AI_FEATURES)) {
            expect(features[id]?.label, id).toBeTruthy();
            expect(features[id]?.description, id).toBeTruthy();
        }
    });
});
