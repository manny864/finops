// @vitest-environment node
/**
 * Rama AWS de las páginas de asignación de costos.
 *
 * Lo que protege: que el reparto por centro de costo de un tenant AWS salga de
 * `CostSnapshots.Tags` y no del SDK de Azure, y que la terminología del payload
 * sea la de AWS (la región viaja en `resourceGroup` y el servicio en
 * `chargeType`, que son las claves del contrato compartido con Azure).
 *
 * Rol mínimo: la ruta exige `requireTenantRole` con lectura sobre el tenant.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
    mockRequireTenantRole: vi.fn(),
    mockRequireTenantAccess: vi.fn(),
    mockQuery: vi.fn(),
    mockTenantUsesAws: vi.fn(),
}));

vi.mock("@/modules/storage/db", () => ({
    default: { query: mocks.mockQuery, getConnection: vi.fn() },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/requestAuth", async () => {
    const actual = await vi.importActual<typeof import("@/lib/requestAuth")>("@/lib/requestAuth");
    return {
        ...actual,
        requireTenantRole: mocks.mockRequireTenantRole,
        requireTenantAccess: mocks.mockRequireTenantAccess,
        AuthError: actual.AuthError,
    };
});

vi.mock("@/lib/tenantProviderContext", () => ({
    tenantUsesAws: mocks.mockTenantUsesAws,
}));

// Sin caché: se mide lo que calcula la ruta, no lo que quedó en Redis.
vi.mock("@/lib/cache", () => ({
    getWithStaleWhileRevalidate: vi.fn(async (_k: string, fn: () => Promise<unknown>) => fn()),
}));

const { GET: getChargeback } = await import("@/app/api/intelligence/chargeback/route");
const { GET: getUnitEconomics } = await import("@/app/api/intelligence/unit-economics/route");

// Tenant que no está en la lista de demo: si lo estuviera, la ruta cortaría en
// el mock y el test no ejercitaría la consulta.
const TENANT = "44444444-aaaa-bbbb-cccc-555555555555";

function req(path: string) {
    return new NextRequest(new URL(path, "http://localhost:3000"));
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockRequireTenantRole.mockResolvedValue({ tenantId: TENANT, email: "a@b.com" });
    mocks.mockRequireTenantAccess.mockResolvedValue({ tenantId: TENANT, email: "a@b.com" });
    mocks.mockTenantUsesAws.mockResolvedValue(true);
});

describe("GET /api/intelligence/chargeback (AWS)", () => {
    it("reparte el costo por el valor de la etiqueta y traduce region y servicio", async () => {
        mocks.mockQuery.mockResolvedValueOnce([[
            { tagValue: "Engineering", usageDate: "2026-07-01", region: "us-east-1", serviceName: "AmazonEC2", cost: "120.50" },
            { tagValue: "Data", usageDate: "2026-07-01", region: "eu-west-1", serviceName: "AmazonS3", cost: "30.25" },
        ]]);

        const res = await getChargeback(req(`/api/intelligence/chargeback?tenantId=${TENANT}&subscriptionId=All`));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.data).toEqual([
            { name: "Engineering", value: 120.5 },
            { name: "Data", value: 30.25 },
        ]);
        expect(body.detailed[0].resourceGroup).toBe("us-east-1");
        expect(body.detailed[0].chargeType).toBe("AmazonEC2");
        // No se toca el SDK de Azure en la rama AWS.
        expect(mocks.mockQuery).toHaveBeenCalledTimes(1);
    });

    it("agrupa bajo 'Sin Etiquetar' lo que no tiene la etiqueta", async () => {
        mocks.mockQuery.mockResolvedValueOnce([[
            { tagValue: "", usageDate: "2026-07-02", region: "us-west-2", serviceName: "AWSELB", cost: "10" },
            { tagValue: "   ", usageDate: "2026-07-03", region: "us-west-2", serviceName: "AWSELB", cost: "5" },
        ]]);

        const res = await getChargeback(req(`/api/intelligence/chargeback?tenantId=${TENANT}&subscriptionId=All`));
        const body = await res.json();

        // Las dos filas caen en el mismo balde: si se separaran, el gráfico
        // mostraría dos porciones "sin etiquetar" distintas.
        expect(body.data).toHaveLength(1);
        expect(body.data[0]).toEqual({ name: "Sin Etiquetar / Untagged", value: 15 });
    });

    it("ignora una etiqueta que no está en el catálogo en vez de interpolarla", async () => {
        mocks.mockQuery.mockResolvedValueOnce([[]]);

        await getChargeback(req(
            `/api/intelligence/chargeback?tenantId=${TENANT}&subscriptionId=All&tagKey=${encodeURIComponent("\" OR 1=1 -- ")}`
        ));

        // El JSON path se arma con el valor por defecto, no con lo que mandó el
        // cliente: es lo que impide la inyección en la expresión JSON.
        const params = mocks.mockQuery.mock.calls[0][1] as unknown[];
        expect(params[0]).toBe("$.CostCenter");
    });

    it("filtra por cuenta cuando no se pide 'All'", async () => {
        mocks.mockQuery.mockResolvedValueOnce([[]]);

        await getChargeback(req(`/api/intelligence/chargeback?tenantId=${TENANT}&subscriptionId=123456789012`));

        const [sql, params] = mocks.mockQuery.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain("subscription_id = ?");
        expect(params).toContain("123456789012");
    });
});

describe("GET /api/intelligence/unit-economics (AWS)", () => {
    it("arma la serie de 30 días con el costo de CostSnapshots y el DAU del SaaS", async () => {
        const hoy = new Date().toISOString().slice(0, 10);
        mocks.mockQuery
            .mockResolvedValueOnce([[{ d: hoy, cost: "500" }]])   // costo diario AWS
            .mockResolvedValueOnce([[{ metric_date: hoy, dau: 1000 }]]) // BusinessMetrics
            .mockResolvedValueOnce([[{ estimated_dau: 800 }]]);   // BusinessMetricsConfig

        const res = await getUnitEconomics(req(`/api/intelligence/unit-economics?tenantId=${TENANT}`));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.data.rows).toHaveLength(30);
        const fila = body.data.rows.find((r: { date: string }) => r.date === hoy);
        expect(fila.cost).toBe(500);
        expect(fila.dau).toBe(1000);
        expect(fila.costPerUser).toBeCloseTo(0.5, 6);
    });

    it("no inventa costo por usuario cuando no hay DAU", async () => {
        mocks.mockQuery
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([[]]);

        const res = await getUnitEconomics(req(`/api/intelligence/unit-economics?tenantId=${TENANT}`));
        const body = await res.json();

        // La serie se emite igual aunque no haya datos: la longitud se afirma
        // para que un array vacío no haga pasar el `every` de abajo por vacuidad.
        expect(body.data.rows).toHaveLength(30);
        // `null` y no 0: un cero se graficaría como un costo unitario perfecto.
        expect(body.data.rows.every((r: { costPerUser: number | null }) => r.costPerUser === null)).toBe(true);
        expect(body.data.estimatedDau).toBe(0);
    });
});
