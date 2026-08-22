import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/modules/storage/db", () => {
    const query = vi.fn();
    return { default: { query }, initializeDatabase: vi.fn(), insertPlatformAiUsage: vi.fn() };
});

import pool from "@/modules/storage/db";
import {
    getDataSharingPrefs,
    redactForDataSharing,
    redactForTenant,
    redactSerializedForTenant,
} from "@/modules/core/aiProvider";
import { buildApiKeyHint, providerFromDb, providerToDb, sensitivityToDb } from "@/types/tenantAiConfiguration.types";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

function prefsRow(shareResourceNames: boolean, shareTags: boolean) {
    return [[{ ai_share_resource_names: shareResourceNames ? 1 : 0, ai_share_tags: shareTags ? 1 : 0 }]];
}

beforeEach(() => query.mockReset());

// Payload con la forma real que arman las páginas: nombres de recurso y tags
// mezclados con métricas numéricas que NO deben tocarse.
const PAYLOAD = {
    resourceName: "vm-prod-finanzas-01",
    resourceGroup: "rg-produccion",
    costUSD: 1234.56,
    tags: { owner: "cfo@empresa.com", costCenter: "CC-100" },
    nested: [{ displayName: "sql-nomina", vmName: "vm-rrhh", monthlySpend: 42 }],
};

describe("redactForTenant — preferencias del tenant aplicadas", () => {
    it("redacta nombres de recurso cuando el tenant los desactivó", async () => {
        query.mockResolvedValue(prefsRow(false, true));
        const out: any = await redactForTenant("t1", PAYLOAD);

        expect(out.resourceName).toBe("[REDACTED]");
        expect(out.resourceGroup).toBe("[REDACTED]");
        expect(out.nested[0].displayName).toBe("[REDACTED]");
        expect(out.nested[0].vmName).toBe("[REDACTED]");
        // Los números nunca se tocan: redactar métricas rompería el análisis.
        expect(out.costUSD).toBe(1234.56);
        expect(out.nested[0].monthlySpend).toBe(42);
        // shareTags seguía activo.
        expect(out.tags.owner).toBe("cfo@empresa.com");
    });

    it("reemplaza los tags por su conteo cuando el tenant los desactivó", async () => {
        query.mockResolvedValue(prefsRow(true, false));
        const out: any = await redactForTenant("t1", PAYLOAD);

        expect(out.tags).toEqual({ _redacted: true, tagCount: 2 });
        expect(out.resourceName).toBe("vm-prod-finanzas-01");
    });

    it("no altera nada cuando el tenant comparte todo", async () => {
        query.mockResolvedValue(prefsRow(true, true));
        const out = await redactForTenant("t1", PAYLOAD);
        expect(out).toEqual(PAYLOAD);
    });

    // El caso "la DB falla" vive en aiDataSharingFailClosed.test.ts: Vitest
    // reporta como fallo del test cualquier Error creado dentro de un
    // mockImplementation asignado desde el cuerpo del test, aunque el código lo
    // capture correctamente. Con el throw horneado en la factory de vi.mock no
    // pasa, y esa factory es por archivo.

    it("un tenant inexistente no bloquea el flujo (comparte por default)", async () => {
        query.mockResolvedValue([[]]);
        expect(await getDataSharingPrefs("nope")).toEqual({ shareResourceNames: true, shareTags: true });
    });
});

describe("redactSerializedForTenant — payload ya serializado (camino del copilot)", () => {
    it("parsea, redacta y re-serializa", async () => {
        query.mockResolvedValue(prefsRow(false, false));
        const { payload, dropped } = await redactSerializedForTenant("t1", JSON.stringify(PAYLOAD));

        expect(dropped).toBe(false);
        const parsed = JSON.parse(payload);
        expect(parsed.resourceName).toBe("[REDACTED]");
        expect(parsed.tags).toEqual({ _redacted: true, tagCount: 2 });
        expect(payload).not.toContain("vm-prod-finanzas-01");
        expect(payload).not.toContain("cfo@empresa.com");
    });

    it("descarta el contexto si no es parseable y la redacción está activa", async () => {
        query.mockResolvedValue(prefsRow(false, true));
        const { payload, dropped } = await redactSerializedForTenant("t1", "vm-prod-finanzas-01 gastó 1234 USD");

        expect(dropped).toBe(true);
        // Fail-closed: no se puede redactar texto libre por clave, así que no viaja.
        expect(payload).not.toContain("vm-prod-finanzas-01");
        expect(payload).toContain("_redacted");
    });

    it("deja pasar el string intacto cuando el tenant comparte todo", async () => {
        query.mockResolvedValue(prefsRow(true, true));
        const raw = "texto libre con vm-prod-01";
        const { payload, dropped } = await redactSerializedForTenant("t1", raw);
        expect(payload).toBe(raw);
        expect(dropped).toBe(false);
    });
});

describe("redactForDataSharing — comportamiento base", () => {
    it("es un no-op cuando ambas preferencias están activas", () => {
        const out = redactForDataSharing(PAYLOAD, { shareResourceNames: true, shareTags: true });
        expect(out).toBe(PAYLOAD); // misma referencia: no clona sin necesidad
    });
});

describe("mapeos de la pestaña IA", () => {
    it("ida y vuelta de proveedor contra los valores que ya usa la DB", () => {
        expect(providerToDb("AZURE_OPENAI")).toBe("azure_openai");
        expect(providerFromDb("azure_openai")).toBe("AZURE_OPENAI");
        expect(providerFromDb("chatgpt")).toBe("OPENAI_DIRECT");
        // 'system' y desconocidos caen al default de la plataforma, no rompen.
        expect(providerFromDb("system")).toBe("AZURE_OPENAI");
        expect(providerFromDb(null)).toBe("AZURE_OPENAI");
    });

    it("STRICT degrada a 'high', el valor más estricto que soporta el ENUM", () => {
        expect(sensitivityToDb("STRICT")).toBe("high");
        expect(sensitivityToDb("LOW")).toBe("low");
    });

    it("la pista de la API key no permite reconstruirla", () => {
        const hint = buildApiKeyHint("sk-proj-abcdefghijklmnop4a1b");
        expect(hint).toBe("sk-...4a1b");
        expect(hint).not.toContain("abcdefghij");
        // Claves cortas se ocultan enteras en vez de exponer la mitad.
        expect(buildApiKeyHint("short")).toBe("••••");
    });
});
