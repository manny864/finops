// @vitest-environment node
/**
 * El reporte ejecutivo tiene que poder leer sus tres colectores de base de datos.
 *
 * `hardWaste`, `anomalies` y `budgets` pedían tablas y columnas que no existen: `ZombieResources` (no hay tal tabla;
 * el desperdicio sólo existe como escaneo de Resource Graph), `Anomalies.detected_date` / `service_name` /
 * `actual_cost_usd` / `expected_cost_usd` / `deviation_percentage` / `severity` y `Budgets.name` / `amount_usd` /
 * `actual_spend_usd`. MySQL rechazaba cada SELECT, `collect()` lo registraba (`[executiveReport] colector "x" fallo:`)
 * y devolvía vacío: producción lo registró 45, 11 y 11 veces en pocos días, y el reporte salía sin desperdicio, sin
 * anomalías y sin presupuestos como si el tenant no tuviera ninguno.
 *
 * Los mocks de `pool.query` de otros tests aceptan cualquier SELECT (el de `executiveTelemetryAggregator` hasta
 * devolvía filas de `ZombieResources`), por eso nadie lo vio. Acá la base falsa lee el DDL REAL del repo
 * (`__tests__/helpers/ddlVersionado.ts`) y rechaza, como MySQL, toda tabla o columna inexistente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { crearBaseFalsa, type Fila, type Respuesta } from "../helpers/baseFalsaDdl";

const { query, scanLiveZombies, getBudgetConsumption } = vi.hoisted(() => ({
    query: vi.fn(),
    scanLiveZombies: vi.fn(),
    getBudgetConsumption: vi.fn(),
}));

vi.mock("@/modules/storage/db", () => ({
    default: { query: (...a: unknown[]) => query(...a) },
    insertPlatformAiUsage: vi.fn(),
    initializeDatabase: vi.fn(),
}));
vi.mock("@/lib/cache", () => ({ getWithStaleWhileRevalidate: async (_clave: string, f: () => unknown) => f() }));
vi.mock("@/services/azureZombieScan.service", () => ({
    scanLiveZombies,
    zombieScanCacheKey: (t: string) => `zombies:${t}`,
    ZOMBIE_SCAN_TTL_S: 900,
    ZOMBIE_SCAN_SOFT_TTL_S: 300,
}));
vi.mock("@/services/budgetService", () => ({ getBudgetConsumption }));
vi.mock("@/services/categoryConsumptionService", () => ({ getRealCategoryOverview: vi.fn(async () => ({ categories: [] })) }));
vi.mock("@/services/haService", () => ({ evaluateHALive: vi.fn(async () => ({ items: [], counts: {}, diagnostics: {} })) }));
vi.mock("@/lib/carbonFootprint", () => ({ getCachedCarbonFootprint: vi.fn(async () => ({ footprint: 0, avoided: 0, degraded: false })) }));
vi.mock("@/services/tagComplianceService", () => ({ getRealTagCompliance: vi.fn(async () => ({ complianceScore: 0 })) }));
vi.mock("@/services/commitmentCoverageService", () => ({ getRealCommitmentsCoverage: vi.fn(async () => ({ coveragePercent: 0 })) }));
vi.mock("@/services/rightsizingAggregator.service", () => ({
    getRealRightsizingRecommendations: vi.fn(async () => ({ recommendations: [], totalSavingsUSD: 0, candidatesCount: 0 })),
}));
vi.mock("@/modules/core/aiProvider", () => ({
    AIProviderFactory: { getGeminiModel: vi.fn() },
    aiQueue: { add: vi.fn() },
    withExponentialBackoff: vi.fn(),
    redactForTenant: vi.fn(),
}));
vi.mock("@/lib/emailHelper", () => ({ sendEmailStrict: vi.fn() }));

const { aggregateExecutiveTelemetry } = await import("@/services/executiveReportGenerator.service");

const TENANT = "11111111-aaaa-4bbb-8ccc-222222222222"; // real: no matchea isMockTenant

// ── Base falsa con el DDL real del repo ─────────────────────────────────────

const base = crearBaseFalsa();
const ESQUEMA = base.esquema;
const fila = base.fila;

// ── Datos de prueba ─────────────────────────────────────────────────────────

const rid = (tipo: string, nombre: string) => `/subscriptions/s1/resourceGroups/rg/providers/${tipo}/${nombre}`;
/** Un hallazgo tal como lo devuelve `scanLiveZombies`: con las tres etiquetas mínimas salvo que se diga otra cosa. */
const zombi = (tipo: string, name: string, monthlyCost: number, extra: Fila = {}) => ({
    id: rid(tipo, name),
    resourceId: rid(tipo, name),
    name,
    type: tipo.toLowerCase(),
    resourceType: tipo.toLowerCase(),
    location: "eastus",
    resourceGroup: "rg",
    subscriptionId: "s1",
    subscriptionName: "s1",
    monthlyCost,
    estimatedMonthlyCost: monthlyCost,
    tags: { Environment: "Prod", CostCenter: "IT", Owner: "ops@contoso.com" },
    isHygiene: false,
    ...extra,
});

const HALLAZGOS = [
    zombi("Microsoft.Compute/disks", "disco-1", 10),
    zombi("Microsoft.Compute/disks", "disco-2", 20),
    zombi("Microsoft.Compute/disks", "disco-eximido", 100), // eximido más abajo
    zombi("Microsoft.Network/publicIPAddresses", "ip-1", 4),
    zombi("Microsoft.Network/virtualNetworkGateways", "gw-1", 130),
    // Higiene (grupo de recursos vacío): hallazgo de gobernanza, no desperdicio.
    zombi("Microsoft.Resources/subscriptions/resourceGroups", "rg-vacio", 0, { isHygiene: true }),
];

const anomalias = () => [
    fila("Anomalies", {
        id: 11,
        subscription_id: "s1",
        date: "2026-10-08", // el SELECT la devuelve ya formateada (DATE_FORMAT): sin Date ni zona horaria de por medio
        amount: "500.0000",
        expected_amount: "100.0000",
        z_score: "4.5000",
        top_contributors: [{ service_name: "Azure OpenAI", resource_group: "rg-ai", delta: 380, delta_pct_of_total: 95 }],
        status: "New",
    }),
    fila("Anomalies", {
        id: 12,
        subscription_id: "s1",
        date: "2026-10-05",
        amount: "330.0000",
        expected_amount: "300.0000",
        z_score: "3.2000",
        top_contributors: [],
        status: "Investigating",
    }),
];

/** Lo que contesta la base: cada tabla con su fila, como las devuelve mysql2. */
function respuestasBase(): Record<string, Respuesta> {
    return {
        tenants: () => [fila("Tenants", { company_name: "Contoso", tier: "business" })],
        costsnapshots: (_p, sql) =>
            sql.includes("mtdTotal")
                ? [{ mtdTotal: "1000.00" }]
                : [{ monthKey: "2026-08", totalBilledCost: "2000" }, { monthKey: "2026-09", totalBilledCost: "2400" }],
        zombieexemptions: () => [
            fila("ZombieExemptions", {
                resource_id: rid("Microsoft.Compute/disks", "disco-eximido"),
                exemption_reason: "DR frío",
                exempted_at: new Date("2026-09-01T00:00:00Z"),
                expires_at: null,
            }),
        ],
        localresourcetagscache: () => [],
        anomalies: anomalias,
        budgets: () => [
            fila("Budgets", { cost_center_tag_value: "Plataforma", monthly_limit_usd: "1000.00" }),
            fila("Budgets", { cost_center_tag_value: "Datos", monthly_limit_usd: "500.00" }),
        ],
    };
}

let consolaError: ReturnType<typeof vi.spyOn>;
const fallosDeColector = () => consolaError.mock.calls.filter(([m]) => String(m).startsWith("[executiveReport] colector"));

beforeEach(() => {
    vi.clearAllMocks();
    base.reiniciar();
    consolaError = vi.spyOn(console, "error").mockImplementation(() => {});
    scanLiveZombies.mockResolvedValue(HALLAZGOS);
    getBudgetConsumption.mockImplementation(async (_t: string, _s: string, centro: string) => (centro === "Plataforma" ? 400 : 650));
    query.mockImplementation(base.query(respuestasBase()));
});

afterEach(() => consolaError.mockRestore());

describe("el DDL que lee la base falsa", () => {
    it("trae las tablas del reporte con las columnas que el reporte necesita", () => {
        for (const c of ["date", "amount", "expected_amount", "z_score", "top_contributors", "status"]) {
            expect(ESQUEMA.get("anomalies")!.has(c), `Anomalies.${c}`).toBe(true);
        }
        for (const c of ["cost_center_tag_value", "monthly_limit_usd", "active"]) {
            expect(ESQUEMA.get("budgets")!.has(c), `Budgets.${c}`).toBe(true);
        }
        // Lo que el reporte pedía y no existe: si alguna aparece, el test de abajo deja de probar algo.
        expect(ESQUEMA.has("zombieresources")).toBe(false);
        expect(ESQUEMA.get("anomalies")!.has("detected_date")).toBe(false);
        expect(ESQUEMA.get("budgets")!.has("amount_usd")).toBe(false);
    });
});

describe("aggregateExecutiveTelemetry con un tenant real", () => {
    it("pide sólo tablas y columnas que existen, y ningún colector falla", async () => {
        const r = await aggregateExecutiveTelemetry(TENANT);

        expect(base.violaciones).toEqual([]);
        expect(fallosDeColector().map(([, e]) => e)).toEqual([]);
        expect(r.collectorStatus.filter((c) => !c.ok)).toEqual([]);
    });

    describe("desperdicio (hardWaste)", () => {
        it("sale del escaneo de zombis: sin eximidos ni higiene, agrupado por motivo y ordenado por plata", async () => {
            const r = await aggregateExecutiveTelemetry(TENANT);

            expect(r.inefficiencyDistribution).toEqual([
                // El tipo sin motivo propio en el escaneo ("Recurso Zombi") se rotula por su tipo de recurso.
                { categoryName: "VNet Gateway", affectedResourcesCount: 1, monthlyWasteUSD: 130, percentageOfTotalWaste: 79.27 },
                { categoryName: "Disco Huérfano (Unattached)", affectedResourcesCount: 2, monthlyWasteUSD: 30, percentageOfTotalWaste: 18.29 },
                { categoryName: "IP Pública Huérfana", affectedResourcesCount: 1, monthlyWasteUSD: 4, percentageOfTotalWaste: 2.44 },
            ]);
            expect(r.kpiMetrics.monthlySavingsIdentifiedUSD).toBe(164);
            expect(r.kpiMetrics.annualizedSavingsUSD).toBe(1968);
            // Se lee el escaneo de todo el tenant: el alcance del reporte no entra al escaneo (sería una suscripción sin validar).
            expect(scanLiveZombies).toHaveBeenCalledWith(TENANT);
        });

        it("si el escaneo falla, el desperdicio se informa como dato no disponible y no como cero", async () => {
            scanLiveZombies.mockRejectedValue(new Error("ARG 429: demasiadas solicitudes"));

            const r = await aggregateExecutiveTelemetry(TENANT);

            const estado = r.collectorStatus.find((c) => c.collector === "hardWaste");
            expect(estado).toMatchObject({ ok: false });
            expect(estado?.error).toContain("429");
            expect(r.inefficiencyDistribution).toEqual([]);
            // El resto del barrido sobrevive.
            expect(r.collectorStatus.find((c) => c.collector === "anomalies")?.ok).toBe(true);
            expect(base.violaciones).toEqual([]);
        });
    });

    describe("anomalías (anomalies)", () => {
        it("salen de las columnas reales: fecha, causa dominante, impacto y severidad por z-score", async () => {
            const r = await aggregateExecutiveTelemetry(TENANT);

            expect(r.anomalies).toEqual([
                { date: "2026-10-08", resource: "Azure OpenAI", impactUSD: 400, severity: "CRITICAL (400% de desvío)" },
                // Sin contribuyentes guardados no hay servicio que nombrar: el reporte no inventa uno.
                { date: "2026-10-05", resource: "Servicio no identificado", impactUSD: 30, severity: "HIGH (10% de desvío)" },
            ]);
            expect(r.kpiMetrics.activeAnomaliesCount).toBe(2);
        });

        it("pide sólo las abiertas (New e Investigating), que es lo que cuenta como activa en el resto de la app", async () => {
            await aggregateExecutiveTelemetry(TENANT);

            const [, params] = query.mock.calls.find(([sql]) => /FROM\s+Anomalies/i.test(String(sql)))!;
            expect(params).toEqual([TENANT, ["New", "Investigating"]]);
        });
    });

    describe("presupuestos (budgets)", () => {
        it("el límite sale de la tabla y el gasto de Cost Management, el mismo de la pantalla de Presupuestos", async () => {
            const r = await aggregateExecutiveTelemetry(TENANT);

            expect(r.budgetsExecution).toEqual([
                { name: "Plataforma", amountUSD: 1000, currentSpendUSD: 400, burnPercent: 40, isExceeded: false },
                { name: "Datos", amountUSD: 500, currentSpendUSD: 650, burnPercent: 130, isExceeded: true },
            ]);
            expect(r.kpiMetrics.budgetBurnPercent).toBe(85);
            // Todo el tenant ("All"): el alcance del reporte no entra, como en el colector de desperdicio.
            expect(getBudgetConsumption).toHaveBeenCalledWith(TENANT, "All", "Plataforma");
            expect(getBudgetConsumption).toHaveBeenCalledWith(TENANT, "All", "Datos");
        });

        it("si no se puede leer el gasto de un presupuesto, el colector se informa caído y no con gasto cero", async () => {
            getBudgetConsumption.mockRejectedValue(new Error("Cost Management 429"));

            const r = await aggregateExecutiveTelemetry(TENANT);

            expect(r.collectorStatus.find((c) => c.collector === "budgets")).toMatchObject({ ok: false });
            expect(r.budgetsExecution).toEqual([]);
            expect(r.kpiMetrics.budgetBurnPercent).toBe(0);
        });
    });

    it("sin datos en ninguna tabla: nada inventado y sin errores", async () => {
        scanLiveZombies.mockResolvedValue([]);
        query.mockImplementation(base.query({ tenants: () => [fila("Tenants", { company_name: "Contoso", tier: "business" })] }));

        const r = await aggregateExecutiveTelemetry(TENANT);

        expect(r.inefficiencyDistribution).toEqual([]);
        expect(r.anomalies).toEqual([]);
        expect(r.budgetsExecution).toEqual([]);
        expect(base.violaciones).toEqual([]);
        expect(r.collectorStatus.filter((c) => !c.ok)).toEqual([]);
    });
});
