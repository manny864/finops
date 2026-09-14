// @vitest-environment node
/**
 * Tres cosas que el panel de alertas self-service no hacía:
 *
 *  1. EDITAR DUPLICABA. El modal mandaba POST también al editar --no existía
 *     PUT en la ruta-- así que "guardar" sobre una regla existente creaba una
 *     segunda regla idéntica en vez de modificarla.
 *  2. EL ALCANCE SE PERDÍA. Sólo se guardaba si era SUBSCRIPTION; elegir un
 *     grupo de recursos o un centro de costos escribía NULL en silencio y al
 *     recargar la regla decía "Tenant Completo".
 *  3. EL FORMULARIO DE EDICIÓN ABRÍA VACÍO, porque el modal estaba montado
 *     siempre y `useState(initialRule?...)` sólo corre en el primer montaje.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({
    default: { query: (...args: unknown[]) => queryMock(...args) },
    initializeDatabase: async () => {},
}));
vi.mock("@/lib/requestAuth", async () => {
    const real: any = await vi.importActual("@/lib/requestAuth");
    return { ...real, requireTenantAccess: async () => {}, requireTenantRole: async () => {} };
});

import { GET, POST, PUT } from "@/app/api/analytics/self-service-alerts/route";
import { NextRequest } from "next/server";

// Un GUID cualquiera NO: los de MOCK_AZURE_TENANTS entran por el camino
// sintético y la ruta ni toca la base.
const TENANT = "9a7c1e40-53bd-4f21-8f0a-6cb2de91f004";

const pedido = (url: string, method: string, body?: unknown) =>
    new NextRequest(`http://localhost${url}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });

const reglaBase = {
    name: "Gasto del RG de producción",
    alertType: "FIXED_THRESHOLD",
    thresholdValue: 500,
    thresholdUnit: "USD",
    notificationChannel: "EMAIL",
    channelTarget: "finops@empresa.com",
};

/** Valor de una columna del INSERT/UPDATE, ubicado por el nombre en el propio SQL. */
function valorDe(sql: string, params: unknown[], columna: string): unknown {
    const cols = sql.includes("INSERT")
        ? sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map((c) => c.trim())
        : sql.slice(sql.indexOf("SET") + 3, sql.indexOf("WHERE")).split(",").map((c) => c.split("=")[0].trim());
    const i = cols.indexOf(columna);
    expect(i, `la columna ${columna} no está en el SQL`).toBeGreaterThanOrEqual(0);
    return params[i];
}

beforeEach(() => queryMock.mockReset());

describe("alcance de una regla de alerta", () => {
    it("guarda el grupo de recursos elegido en vez de descartarlo", async () => {
        queryMock.mockResolvedValue([{ insertId: 7 }]);

        await POST(pedido(`/api/analytics/self-service-alerts?tenantId=${TENANT}`, "POST", {
            ...reglaBase,
            scopeType: "RESOURCE_GROUP",
            scopeValue: "rg-produccion",
        }));

        const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
        expect(valorDe(sql, params, "scope_type")).toBe("RESOURCE_GROUP");
        expect(valorDe(sql, params, "scope_value")).toBe("rg-produccion");
        // La columna vieja sólo aplica a suscripciones: llenarla con un RG haría
        // que /api/budgets/alerts lo leyera como si fuera un id de suscripción.
        expect(valorDe(sql, params, "scope_subscription_id")).toBeNull();
    });

    it("un alcance sin valor es el tenant entero, no un valor vacío", async () => {
        queryMock.mockResolvedValue([{ insertId: 8 }]);

        await POST(pedido(`/api/analytics/self-service-alerts?tenantId=${TENANT}`, "POST", {
            ...reglaBase, scopeType: "TAG", scopeValue: "   ",
        }));

        const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
        expect(valorDe(sql, params, "scope_type")).toBe("TENANT");
        expect(valorDe(sql, params, "scope_value")).toBeNull();
    });

    it("vuelve a leerse como se guardó", async () => {
        queryMock.mockResolvedValue([[{
            id: 7, rule_name: "R", rule_type: "threshold",
            scope_type: "RESOURCE_GROUP", scope_value: "rg-produccion", scope_subscription_id: null,
            threshold_value: 500, threshold_unit: "USD", channel: "email",
            channel_target: "finops@empresa.com", enabled: 1, trigger_count: 0,
        }]]);

        const res = await GET(pedido(`/api/analytics/self-service-alerts?tenantId=${TENANT}`, "GET"));
        const regla = (await res.json()).metrics.rules[0];
        expect(regla.scopeType).toBe("RESOURCE_GROUP");
        expect(regla.scopeValue).toBe("rg-produccion");
    });

    it("las filas viejas, que sólo tienen scope_subscription_id, siguen leyéndose", async () => {
        queryMock.mockResolvedValue([[{
            id: 3, rule_name: "Vieja", rule_type: "budget",
            scope_type: "TENANT", scope_value: null, scope_subscription_id: "sub-abc",
            threshold_value: 80, threshold_unit: "PERCENT", channel: "email",
            channel_target: "a@b.com", enabled: 1, trigger_count: 0,
        }]]);

        const regla = (await (await GET(pedido(`/api/analytics/self-service-alerts?tenantId=${TENANT}`, "GET"))).json()).metrics.rules[0];
        expect(regla.scopeValue).toBe("sub-abc");
    });
});

describe("editar una regla no crea otra", () => {
    it("PUT actualiza la fila y no inserta", async () => {
        queryMock.mockResolvedValue([{ affectedRows: 1 }]);

        const res = await PUT(pedido(
            `/api/analytics/self-service-alerts?tenantId=${TENANT}&ruleId=7`, "PUT",
            { ...reglaBase, name: "Nombre editado", scopeType: "RESOURCE_GROUP", scopeValue: "rg-produccion" }
        ));

        expect(res.status).toBe(200);
        const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
        expect(sql).toContain("UPDATE AlertRules");
        expect(sql).not.toContain("INSERT");
        expect(valorDe(sql, params, "rule_name")).toBe("Nombre editado");
        // El tenant en el WHERE: sin eso un Admin podría editar la regla de otro.
        expect(sql).toContain("tenant_id = ?");
        expect(params.slice(-2)).toEqual(["7", TENANT]);
    });

    it("editar una regla de otro tenant da 404 y no toca nada", async () => {
        queryMock.mockResolvedValue([{ affectedRows: 0 }]);
        const res = await PUT(pedido(
            `/api/analytics/self-service-alerts?tenantId=${TENANT}&ruleId=999`, "PUT", reglaBase
        ));
        expect(res.status).toBe(404);
    });
});

describe("el modal de edición", () => {
    const panel = readFileSync("src/components/analytics/SelfServiceAlertsPanel.tsx", "utf8");

    it("manda PUT cuando hay una regla inicial", () => {
        expect(panel).toMatch(/method:\s*esEdicion\s*\?\s*"PUT"\s*:\s*"POST"/);
    });

    it("se monta sólo mientras está abierto, para que cargue los valores de la regla", () => {
        // Montado siempre, los useState(initialRule?...) no vuelven a correr y
        // "editar" abre el formulario en blanco.
        expect(panel).toMatch(/\{isModalOpen && \(\s*<CreateOrEditRuleModal/);
    });

    it("refresca la lista al guardar", () => {
        expect(panel).toMatch(/onSaved=\{\(\) => mutate\(\)\}/);
    });

    it("pide las opciones de alcance con token", () => {
        // Un `fetch` pelado devuelve 401 (la ruta exige bearer, no hay cookie) y
        // el usuario ve "no hay valores para este tipo de alcance" en vez de un
        // error: la lista queda vacia por permisos, no porque no haya datos.
        const bloque = panel.slice(panel.indexOf("scope-options?tenantId=") - 600, panel.indexOf("scope-options?tenantId=") + 300);
        expect(bloque).toContain("buildFetcher");
        expect(bloque).not.toMatch(/\(url: string\) => fetch\(url\)/);
    });

    it("no deja un guardado fallido sin mensaje", () => {
        expect(panel).toContain("setSaveError");
        expect(panel).toMatch(/\{saveError && \(/);
    });
});
