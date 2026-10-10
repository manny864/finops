// @vitest-environment node
/**
 * La tool `get_anomalies_feed` del MCP tiene que poder leer `Anomalies`.
 *
 * Pedía `detected_date`, `service_name`, `actual_cost_usd`, `expected_cost_usd`, `deviation_percentage` y `severity`,
 * que la tabla nunca tuvo (tiene `date`, `amount`, `expected_amount` y `z_score`). MySQL rechazaba el SELECT y el
 * `catch` devolvía `{ count: 0, anomalies: [], note: "Tabla Anomalies no disponible" }`: un agente que preguntaba por
 * las anomalías del tenant recibía "no hay" (y, de existir el dato, una nota que culpaba a una tabla que sí existe).
 * Como el `catch` ni siquiera registraba el error, ningún log lo mostraba.
 *
 * La base falsa lee el DDL REAL del repo (`__tests__/helpers/ddlVersionado.ts`) y rechaza, como MySQL, toda tabla o
 * columna inexistente: los mocks de `pool.query` aceptan cualquier consulta.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { crearBaseFalsa } from "../helpers/baseFalsaDdl";

const { query, TENANT } = vi.hoisted(() => ({ query: vi.fn(), TENANT: "8b41364f-581a-4e43-b7cb-13138dac5517" }));

vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => query(...a) } }));
vi.mock("@/services/mcpApiKey.service", () => ({ authenticateMcpToken: vi.fn(async () => ({ tenantId: TENANT, keyId: 1 })) }));

const { POST } = await import("@/app/api/mcp/route");

const base = crearBaseFalsa();
const fila = base.fila;

/** Llama a una tool por JSON-RPC, como un agente, y devuelve lo que la tool respondió. */
async function llamar(tool: string, args: Record<string, unknown> = {}) {
    const respuesta = await POST(
        new NextRequest("http://localhost/api/mcp", {
            method: "POST",
            headers: { authorization: "Bearer mcp_live_prueba", "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
        })
    );
    const cuerpo = await respuesta.json();
    return JSON.parse(cuerpo.result.content[0].text);
}

/** Lo que `Anomalies` devuelve (con `date` ya formateada por el SELECT): una abierta con causa y una resuelta sin ella. */
const anomalias = () => [
    fila("Anomalies", {
        id: 11,
        subscription_id: "s1",
        date: "2026-10-08",
        amount: "500.0000",
        expected_amount: "100.0000",
        z_score: "4.5000",
        top_contributors: [{ service_name: "Azure OpenAI", resource_group: "rg-ai", delta: 380, delta_pct_of_total: 95 }],
        status: "New",
    }),
    fila("Anomalies", {
        id: 9,
        subscription_id: "s1",
        date: "2026-09-30",
        amount: "250.0000",
        expected_amount: "200.0000",
        z_score: "3.4000",
        top_contributors: [],
        status: "Resolved",
    }),
];

let consolaError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.clearAllMocks();
    base.reiniciar();
    consolaError = vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockImplementation(base.query({ anomalies: anomalias }));
});

afterEach(() => consolaError.mockRestore());

describe("MCP get_anomalies_feed", () => {
    it("lee sólo columnas que existen y devuelve las anomalías con su causa, su severidad y su estado", async () => {
        const r = await llamar("get_anomalies_feed");

        expect(base.violaciones).toEqual([]);
        expect(r.note).toBeUndefined();
        expect(r).toEqual({
            count: 2,
            anomalies: [
                {
                    id: 11,
                    detected_date: "2026-10-08",
                    service_name: "Azure OpenAI",
                    actual_cost_usd: 500,
                    expected_cost_usd: 100,
                    deviation_percentage: 400,
                    severity: "CRITICAL",
                    status: "New",
                },
                {
                    id: 9,
                    detected_date: "2026-09-30",
                    // Sin contribuyentes guardados no hay servicio que nombrar: ni un texto inventado ni un centinela.
                    service_name: null,
                    actual_cost_usd: 250,
                    expected_cost_usd: 200,
                    deviation_percentage: 25,
                    severity: "HIGH",
                    // El feed trae todas, no sólo las abiertas: el estado va en cada una.
                    status: "Resolved",
                },
            ],
        });
    });

    it("acota al tenant de la llave y al límite pedido (con tope en 100)", async () => {
        await llamar("get_anomalies_feed", { limit: 5 });
        await llamar("get_anomalies_feed", { limit: 5000 });

        expect(query.mock.calls.map(([, params]) => params)).toEqual([[TENANT, 5], [TENANT, 100]]);
    });

    it("si la lectura falla de verdad, lo dice y lo registra: no culpa a una tabla que existe", async () => {
        query.mockRejectedValue(Object.assign(new Error("Connection lost: The server closed the connection."), { code: "PROTOCOL_CONNECTION_LOST" }));

        const r = await llamar("get_anomalies_feed");

        expect(r.count).toBe(0);
        expect(r.note).toContain("Connection lost");
        expect(r.note).not.toMatch(/no disponible/i);
        // Sin esta línea el fallo sólo se veía como "no hay anomalías".
        expect(consolaError.mock.calls.some(([m]) => String(m).startsWith("[mcp] get_anomalies_feed"))).toBe(true);
    });
});
