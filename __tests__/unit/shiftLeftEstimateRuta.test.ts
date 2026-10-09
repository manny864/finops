// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";

const verifyApiKey = vi.fn();
const requireScope = vi.fn();
const checkByKeyDistributed = vi.fn();
const queryMock = vi.fn();
const createNotification = vi.fn();
const notifyTenant = vi.fn();

vi.mock("@/lib/publicApiAuth", () => ({
    verifyApiKey: (...a: unknown[]) => verifyApiKey(...a),
    requireScope: (...a: unknown[]) => requireScope(...a),
}));
vi.mock("@/lib/rateLimiter", () => ({
    default: { checkByKeyDistributed: (...a: unknown[]) => checkByKeyDistributed(...a) },
}));
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("@/lib/notify", () => ({ createNotification: (...a: unknown[]) => createNotification(...a) }));
vi.mock("@/lib/notifications", () => ({ notifyTenant: (...a: unknown[]) => notifyTenant(...a) }));

// Los precios salen de respuestas REALES de la Retail API (capturadas el
// 2026-10-08): la ruta corre con el motor y el catálogo de verdad, y sólo la red
// está reemplazada. La tarificación en sí se prueba en iacCostCatalog.test.ts.
vi.mock("@/services/pricingService", async (importOriginal) => {
    const real = await importOriginal<typeof import("@/services/pricingService")>();
    const { readFileSync: leer } = await import("node:fs");
    const datos = JSON.parse(leer("__tests__/fixtures/retail-prices-2026-10-08.json", "utf8")).consultas;
    return {
        ...real,
        obtenerItemsRetail: async (c: any) => {
            const k = [c.serviceName, c.region, c.filtro?.campo ?? "", c.filtro?.valor ?? ""].join("|");
            return datos[k] ? { items: datos[k] } : { error: "api" };
        },
    };
});

import { POST } from "@/app/api/v1/shift-left/estimate/route";

const PLAN = readFileSync("__tests__/fixtures/terraform-plan-azurerm-completo.json", "utf-8");
/** Lo que da el plan completo con los precios capturados: ver iacCostCatalog.test.ts. */
const DELTA = 3176.9149;

const pedido = (cuerpo: string) =>
    new Request("https://x/api/v1/shift-left/estimate", { method: "POST", body: cuerpo }) as any;
const conRepo = (extra: Record<string, unknown> = {}) =>
    pedido(JSON.stringify({ plan: JSON.parse(PLAN), repository: "manny864/finops", ...extra }));

/** Una base de mentira que contesta según la tabla que se consulta, no según el orden de las queries. */
function bd(o: {
    descuento?: string | null;
    gate?: Record<string, unknown> | null;
    previa?: Record<string, unknown> | null;
    centro?: { mensual: number } | null;
    gasto?: number;
} = {}) {
    queryMock.mockImplementation(async (sql: string) => {
        if (/FROM IacPricingSettings/.test(sql)) return [o.descuento != null ? [{ discount_pct: o.descuento }] : []];
        if (/FROM IacBudgetGates/.test(sql)) return [o.gate ? [o.gate] : []];
        if (/FROM IacCostEstimations/.test(sql)) return [o.previa ? [o.previa] : []];
        if (/FROM CostCenterBudgets/.test(sql)) return [o.centro ? [{ monthly_budget_usd: o.centro.mensual }] : []];
        if (/FROM CostSnapshots/.test(sql)) return [[{ gasto: o.gasto ?? 0 }]];
        if (/INSERT INTO IacCostEstimations/.test(sql)) return [{ affectedRows: 1 }];
        return [[]];
    });
}
const insert = () => queryMock.mock.calls.find((c) => /INSERT INTO IacCostEstimations/.test(String(c[0])));
const fila = (u: unknown, pct: unknown = null, centro: unknown = null) =>
    ({ threshold_usd: u, threshold_pct_of_remaining: pct, cost_center_name: centro });
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
    verifyApiKey.mockReset().mockResolvedValue({ tenantId: "t1", keyId: 7, name: "ci", scopes: ["write:shift-left"], rateLimitPerMin: 60 });
    requireScope.mockReset();
    checkByKeyDistributed.mockReset().mockResolvedValue({ allowed: true });
    createNotification.mockReset().mockResolvedValue(undefined);
    notifyTenant.mockReset().mockResolvedValue({ sent: 0, failed: 0, results: [] });
    queryMock.mockReset();
    bd();
});

describe("POST /api/v1/shift-left/estimate", () => {
    it("rechaza sin API key, antes de mirar el cuerpo", async () => {
        verifyApiKey.mockResolvedValue(null);
        const r = await POST(pedido(PLAN));
        expect(r.status).toBe(401);
        expect((await r.json()).error.code).toBe("unauthorized");
        // Lo importante: no se tarifo nada ni se escribio nada sin autenticar.
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("rechaza una clave sin el scope", async () => {
        requireScope.mockImplementation(() => { throw new Error("Insufficient scope. Required: write:shift-left"); });
        const r = await POST(pedido(PLAN));
        expect(r.status).toBe(403);
        expect((await r.json()).error.code).toBe("insufficient_scope");
    });

    it("respeta el rate limit por clave", async () => {
        checkByKeyDistributed.mockResolvedValue({ allowed: false });
        expect((await POST(pedido(PLAN))).status).toBe(429);
    });

    it("estima un plan real de 25 recursos y devuelve el delta", async () => {
        const r = await POST(pedido(PLAN));
        expect(r.status).toBe(200);
        const { data } = await r.json();
        expect(data.delta_cost_usd).toBeCloseTo(DELTA, 2);
        expect(data.currency).toBe("USD");
        expect(data.resources_free).toBe(8);
        expect(data.lines).toHaveLength(25);
        // El storage account se cobra por consumo: no está en el número y se avisa.
        expect(data.resources_by_use).toBe(1);
        expect(data.resources_unpriced).toBe(1);
        expect(data.discount_pct).toBe(0);
        expect(data.budget).toBeNull();
        expect(data.previous).toBeNull();
    });

    it("acepta el plan pelado o envuelto, y registra la corrida con sus metadatos", async () => {
        const r = await POST(conRepo({ pr_number: 42, commit_sha: "abc123", author: "lucia", tool: "tofu" }));
        expect(r.status).toBe(200);
        const params = insert()![1] as any[];
        expect(params.slice(0, 5)).toEqual(["t1", "manny864/finops", 42, "abc123", "lucia"]);
        expect(params[7]).toBeCloseTo(DELTA, 2);
        // priced = 25 líneas − 8 sin costo − 1 por uso − 0 sin tarifar
        expect(params[8]).toBe(16);
        expect(params[9]).toBe(1);
        expect(JSON.parse(params[12]).tool).toBe("tofu");
    });

    it("una herramienta desconocida se registra como terraform", async () => {
        await POST(conRepo({ tool: "algo-raro" }));
        expect(JSON.parse((insert()![1] as any[])[12]).tool).toBe("terraform");
    });

    it("no registra nada cuando no se dice de que repo viene", async () => {
        await POST(pedido(PLAN));
        // Sin repo no hay donde archivar la corrida ni gate que buscar. Lo único que
        // se lee es el descuento del tenant, que no depende del repositorio.
        expect(insert()).toBeUndefined();
        expect(queryMock.mock.calls.some((c) => /IacBudgetGates/.test(String(c[0])))).toBe(false);
        expect(queryMock.mock.calls.some((c) => /IacPricingSettings/.test(String(c[0])))).toBe(true);
    });

    it("si MySQL falla igual responde la estimacion", async () => {
        // El CI esta esperando este numero para comentar el PR. Perder una fila
        // de historial, o el descuento, no puede costar la respuesta.
        queryMock.mockReset().mockRejectedValue(new Error("ECONNREFUSED"));
        const r = await POST(conRepo());
        expect(r.status).toBe(200);
        const { data } = await r.json();
        expect(data.delta_cost_usd).toBeCloseTo(DELTA, 2);
        expect(data.budget_gate.status).toBe("NOT_EVALUATED");
        expect(data.discount_pct).toBe(0);
    });

    it("distingue un JSON roto de un plan que no es un plan", async () => {
        const roto = await POST(pedido("{no es json"));
        expect(roto.status).toBe(400);
        expect((await roto.json()).error.code).toBe("invalid_json");

        const noEsPlan = await POST(pedido(JSON.stringify({ hola: "mundo" })));
        expect(noEsPlan.status).toBe(400);
        expect((await noEsPlan.json()).error.code).toBe("invalid_plan");
    });

    it("corta un plan desmedido antes de parsearlo", async () => {
        const enorme = JSON.stringify({ relleno: "x".repeat(7 * 1024 * 1024) });
        expect((await POST(pedido(enorme))).status).toBe(413);
    });

    it("siempre devuelve X-Request-Id, tambien en los errores", async () => {
        expect((await POST(pedido(PLAN))).headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
        verifyApiKey.mockResolvedValue(null);
        expect((await POST(pedido(PLAN))).headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    });
});

describe("descuento del cliente", () => {
    it("aplica el porcentaje configurado y devuelve también el precio de lista", async () => {
        bd({ descuento: "20.00" });
        const { data } = await (await POST(pedido(PLAN))).json();
        expect(data.discount_pct).toBe(20);
        expect(data.list_delta_cost_usd).toBeCloseTo(DELTA, 2);
        expect(data.delta_cost_usd).toBeCloseTo(DELTA * 0.8, 2);
    });

    it("el Budget Gate se mide contra el número CON descuento: es lo que el cliente va a pagar", async () => {
        // 3176.91 de lista; con 50% son 1588.46. Un umbral de 2000 pasa con descuento y no sin él.
        bd({ descuento: "50", gate: fila("2000.0000") });
        const { data } = await (await POST(conRepo())).json();
        expect(data.budget_gate.status).toBe("OK");
    });

    it("lo registra en la fila: descuento y delta de lista", async () => {
        bd({ descuento: "10" });
        await POST(conRepo());
        const meta = JSON.parse((insert()![1] as any[])[12]);
        expect(meta.discount_pct).toBe(10);
        expect(meta.list_delta_cost_usd).toBeCloseTo(DELTA, 2);
    });
});

describe("Budget Gate por monto (MEJ-20)", () => {
    it("sin umbral configurado informa pero no bloquea", async () => {
        const { data } = await (await POST(conRepo())).json();
        expect(data.budget_gate).toEqual({ status: "NOT_EVALUATED", threshold_usd: null, threshold_pct_of_remaining: null, reason: null });
        expect((insert()![1] as any[])[10]).toBe("NOT_EVALUATED");
    });

    it("marca EXCEEDED cuando el delta supera el umbral", async () => {
        bd({ gate: fila("10.0000") });
        const { data } = await (await POST(conRepo())).json();
        expect(data.budget_gate).toMatchObject({ status: "EXCEEDED", threshold_usd: 10, reason: "usd" });
        // El estado se persiste: la pantalla de gobernanza lo lee de ahi.
        expect((insert()![1] as any[])[10]).toBe("EXCEEDED");
    });

    it("marca OK cuando no lo supera", async () => {
        bd({ gate: fila("100000.0000") });
        expect((await (await POST(conRepo())).json()).data.budget_gate.status).toBe("OK");
    });

    // Sin el guard de Number.isFinite, un umbral ilegible cae en la comparacion
    // (30 > "no-es-un-numero" es false en JS) y sale "OK", o sea "evaluado y
    // aprobado". No es lo mismo que "no hay umbral".
    it("un umbral ilegible queda sin evaluar, no aprobado", async () => {
        bd({ gate: fila("no-es-un-numero") });
        expect((await (await POST(conRepo())).json()).data.budget_gate.status).toBe("NOT_EVALUATED");
    });

    it("el borde exacto no bloquea: el umbral es el maximo permitido", async () => {
        bd({ gate: fila(String(DELTA)) });
        expect((await (await POST(conRepo())).json()).data.budget_gate.status).toBe("OK");
    });

    // Falla ABIERTO. Esto corre en el CI de otra gente: si nuestra base no
    // responde, el PR no se voltea por algo que no tiene que ver con el.
    it("si no se puede leer el umbral, no bloquea", async () => {
        queryMock.mockImplementation(async (sql: string) => {
            if (/IacBudgetGates/.test(sql)) throw new Error("ECONNREFUSED");
            return [[]];
        });
        expect((await (await POST(conRepo())).json()).data.budget_gate.status).toBe("NOT_EVALUATED");
    });
});

describe("Budget Gate por presupuesto del centro de costos", () => {
    // Presupuesto 5000, gastado 1000 => quedan 4000. El delta (3176.91) pesa 63,54% del
    // presupuesto y 79,42% de lo que queda.
    const centro = { mensual: 5000 };

    it("devuelve el contexto de presupuesto aunque el repo no tenga umbral", async () => {
        bd({ gate: fila(null, null, "Plataforma"), centro, gasto: 1000 });
        const { data } = await (await POST(conRepo())).json();
        expect(data.budget).toEqual({
            cost_center: "Plataforma", monthly_usd: 5000, spent_usd: 1000, remaining_usd: 4000,
            delta_pct_of_budget: 63.54, delta_pct_of_remaining: 79.42,
        });
        expect(data.budget_gate.status).toBe("NOT_EVALUATED");
    });

    it("marca EXCEEDED cuando el PR consume más que el porcentaje de lo que queda", async () => {
        bd({ gate: fila(null, "50.00", "Plataforma"), centro, gasto: 1000 });
        const { data } = await (await POST(conRepo())).json();
        // 50% de 4000 = 2000 < 3176,91
        expect(data.budget_gate).toMatchObject({ status: "EXCEEDED", threshold_pct_of_remaining: 50, reason: "pct" });
    });

    it("marca OK si cabe", async () => {
        bd({ gate: fila(null, "90.00", "Plataforma"), centro, gasto: 1000 });
        expect((await (await POST(conRepo())).json()).data.budget_gate.status).toBe("OK");
    });

    it("un centro ya pasado de presupuesto bloquea cualquier aumento", async () => {
        bd({ gate: fila(null, "100.00", "Plataforma"), centro, gasto: 6000 });
        const { data } = await (await POST(conRepo())).json();
        expect(data.budget.remaining_usd).toBe(-1000);
        expect(data.budget.delta_pct_of_remaining).toBeNull();
        expect(data.budget_gate.status).toBe("EXCEEDED");
    });

    it("sin presupuesto cargado para el centro, el gate por porcentaje no se puede evaluar", async () => {
        bd({ gate: fila(null, "50.00", "Fantasma"), centro: null });
        const { data } = await (await POST(conRepo())).json();
        expect(data.budget).toBeNull();
        expect(data.budget_gate.status).toBe("NOT_EVALUATED");
    });

    it("con monto y porcentaje alcanza con que se cumpla uno", async () => {
        bd({ gate: fila("100000", "50.00", "Plataforma"), centro, gasto: 1000 });
        const { data } = await (await POST(conRepo())).json();
        expect(data.budget_gate).toMatchObject({ status: "EXCEEDED", reason: "pct" });
    });
});

describe("el PR anterior y los avisos", () => {
    const previa = (gate: string) => ({ delta_cost_usd: "100.0000", commit_sha: "old", gate_status: gate, created_at: "2026-10-08T10:00:00Z" });

    it("devuelve la estimación del push anterior del mismo PR", async () => {
        bd({ previa: previa("OK") });
        const { data } = await (await POST(conRepo({ pr_number: 7 }))).json();
        expect(data.previous).toEqual({ delta_cost_usd: 100, commit_sha: "old", gate_status: "OK", created_at: "2026-10-08T10:00:00.000Z" });
    });

    it("sin número de PR no hay un 'anterior' que buscar", async () => {
        const { data } = await (await POST(conRepo())).json();
        expect(data.previous).toBeNull();
        expect(queryMock.mock.calls.some((c) => /FROM IacCostEstimations/.test(String(c[0])))).toBe(false);
    });

    it("avisa cuando un PR pasa a EXCEEDED por primera vez", async () => {
        bd({ gate: fila("10"), previa: previa("OK") });
        await POST(conRepo({ pr_number: 7 }));
        await flush();
        expect(createNotification).toHaveBeenCalledTimes(1);
        expect(createNotification.mock.calls[0][0]).toMatchObject({
            tenantId: "t1", titleKey: "notif_shift_left_gate_title", messageKey: "notif_shift_left_gate_usd_msg",
            severity: "warning", source: "shift-left", href: "/governance/shift-left",
            params: { repo: "manny864/finops #7", delta: 3176.91, value: 10 },
        });
        expect(notifyTenant).toHaveBeenCalledTimes(1);
    });

    it("el aviso por porcentaje usa su propio mensaje", async () => {
        bd({ gate: fila(null, "50.00", "Plataforma"), centro: { mensual: 5000 }, gasto: 1000 });
        await POST(conRepo({ pr_number: 8 }));
        await flush();
        expect(createNotification.mock.calls[0][0]).toMatchObject({
            messageKey: "notif_shift_left_gate_pct_msg", params: { repo: "manny864/finops #8", value: 50 },
        });
    });

    it("avisa también la primera vez que se estima un PR que ya nace superado", async () => {
        bd({ gate: fila("10") });
        await POST(conRepo({ pr_number: 7 }));
        await flush();
        expect(createNotification).toHaveBeenCalledTimes(1);
    });

    it("NO vuelve a avisar en cada push si ya estaba superado: sería ruido", async () => {
        bd({ gate: fila("10"), previa: previa("EXCEEDED") });
        await POST(conRepo({ pr_number: 7 }));
        await flush();
        expect(createNotification).not.toHaveBeenCalled();
        expect(notifyTenant).not.toHaveBeenCalled();
    });

    it("no avisa si el gate pasa", async () => {
        bd({ gate: fila("100000") });
        await POST(conRepo({ pr_number: 7 }));
        await flush();
        expect(createNotification).not.toHaveBeenCalled();
    });

    it("si el aviso falla, la respuesta no se pierde", async () => {
        createNotification.mockRejectedValue(new Error("boom"));
        notifyTenant.mockRejectedValue(new Error("teams caído"));
        bd({ gate: fila("10") });
        const r = await POST(conRepo({ pr_number: 7 }));
        await flush();
        expect(r.status).toBe(200);
        expect((await r.json()).data.budget_gate.status).toBe("EXCEEDED");
    });
});

describe("Bicep (what-if de ARM)", () => {
    const WHATIF = readFileSync("__tests__/fixtures/arm-whatif-completo.json", "utf-8");
    const total = async (r: Response) => (await r.json()).data;

    it("estima el what-if envuelto en `what_if` y lo registra como bicep", async () => {
        const r = await POST(pedido(JSON.stringify({ what_if: JSON.parse(WHATIF), repository: "acme/bicep", pr_number: 5 })));
        expect(r.status).toBe(200);
        const data = await total(r);
        // Suma de las 14 líneas con costo del fixture, a precio de lista de westus2.
        expect(data.delta_cost_usd).toBeCloseTo(2915.9825, 2);
        expect(data.resources_by_use).toBe(1);
        expect(JSON.parse((insert()![1] as any[])[12]).tool).toBe("bicep");
    });

    it("acepta el what-if pelado, como lo escupe la CLI", async () => {
        const r = await POST(pedido(WHATIF));
        expect(r.status).toBe(200);
        expect((await total(r)).lines.length).toBeGreaterThan(15);
    });

    it("lo marca bicep aunque la clave `tool` diga otra cosa", async () => {
        await POST(pedido(JSON.stringify({ what_if: JSON.parse(WHATIF), repository: "acme/bicep", tool: "terraform" })));
        expect(JSON.parse((insert()![1] as any[])[12]).tool).toBe("bicep");
    });

    it("un what_if sin `changes` es un 400 con el mensaje de cómo generarlo", async () => {
        const r = await POST(pedido(JSON.stringify({ what_if: { status: "Succeeded" } })));
        expect(r.status).toBe(400);
        const j = await r.json();
        expect(j.error.code).toBe("invalid_what_if");
        expect(j.error.message).toContain("az deployment group what-if --no-pretty-print");
    });

    it("el mismo gate y descuento aplican a Bicep", async () => {
        bd({ descuento: "10", gate: fila("100") });
        const { data } = await (await POST(pedido(JSON.stringify({ what_if: JSON.parse(WHATIF), repository: "acme/bicep" })))).json();
        expect(data.discount_pct).toBe(10);
        expect(data.budget_gate.status).toBe("EXCEEDED");
    });
});

