/**
 * SQL DB Rightsizing Service — recomendaciones reales de downsizing de Azure SQL
 * Database basadas en utilización real (DTU% o vCore CPU%), no mock.
 *
 * RBAC mínimo (Service Principal del tenant, solo lectura):
 *   - Reader (Resource Graph) para inventariar bases de datos y su SKU actual.
 *   - Monitoring Reader para dtu_consumption_percent / cpu_percent.
 *
 * Heurística: P95 de utilización <20% sostenido 30 días = sobredimensionada.
 * El precio es una tabla estática de referencia (mismo patrón que los costos
 * planos de zombies/networking) — no requiere una llamada extra a Cost
 * Management, y es suficiente para estimar el ahorro de bajar un escalón.
 */
import { getResourceGraphClient, getAzureCredential } from "@/lib/azure";
import { MonitorClient } from "@azure/arm-monitor";
import { isMockTenant } from "@/lib/mockData";

export interface SqlDbRightsizingRow {
    serverName: string;
    dbName: string;
    resourceGroup: string;
    resourceId: string;
    currentTier: string;
    recommendedTier: string;
    avgDtuPercent: number;
    monthlyCost: number;
    estimatedSavings: number;
    reason: string;
}

export interface SqlDbRightsizingResult {
    items: SqlDbRightsizingRow[];
    totalSavings: number;
    dataAvailable: boolean;
}

// Precio mensual de referencia (USD) por escalón — DTU model (Standard) y vCore
// (GeneralPurpose Gen5). No pretende ser exacto a centavos: es la base para
// estimar el ahorro relativo de bajar un escalón, igual que el resto del
// catálogo de costos planos de la app.
const DTU_LADDER: Array<{ tier: string; dtu: number; monthlyCost: number }> = [
    { tier: "Basic 5 DTU", dtu: 5, monthlyCost: 5 },
    { tier: "S0 Standard 10 DTU", dtu: 10, monthlyCost: 15 },
    { tier: "S1 Standard 20 DTU", dtu: 20, monthlyCost: 30 },
    { tier: "S2 Standard 50 DTU", dtu: 50, monthlyCost: 75 },
    { tier: "S3 Standard 100 DTU", dtu: 100, monthlyCost: 150 },
    { tier: "S4 Standard 200 DTU", dtu: 200, monthlyCost: 300 },
    { tier: "S6 Standard 400 DTU", dtu: 400, monthlyCost: 600 },
    { tier: "S7 Standard 800 DTU", dtu: 800, monthlyCost: 1200 },
    { tier: "S9 Standard 1600 DTU", dtu: 1600, monthlyCost: 2400 },
    { tier: "S12 Standard 3000 DTU", dtu: 3000, monthlyCost: 4500 },
];
const VCORE_MONTHLY_PER_CORE = 186; // GeneralPurpose Gen5, referencia

function dtuLadderStep(currentDtu: number, down: boolean): { tier: string; monthlyCost: number } | null {
    const idx = DTU_LADDER.findIndex((s) => s.dtu === currentDtu);
    const target = idx >= 0 ? (down ? idx - 1 : idx + 1) : -1;
    if (target < 0 || target >= DTU_LADDER.length) return null;
    return DTU_LADDER[target];
}

const MOCK_ITEMS: SqlDbRightsizingRow[] = [
    { serverName: 'sql-prod-01', dbName: 'orders', resourceGroup: 'rg-prod', resourceId: 'mock', currentTier: 'S3 Standard 100 DTU', recommendedTier: 'S2 Standard 50 DTU', avgDtuPercent: 18, monthlyCost: 150, estimatedSavings: 75, reason: 'DTU P95 <20% en 30 días' },
    { serverName: 'sql-dev', dbName: 'sandbox', resourceGroup: 'rg-dev', resourceId: 'mock', currentTier: 'S1 Standard 20 DTU', recommendedTier: 'Basic 5 DTU', avgDtuPercent: 3, monthlyCost: 30, estimatedSavings: 25, reason: 'DTU P95 <20% en 30 días' },
];

function buildMockResult(): SqlDbRightsizingResult {
    return { items: MOCK_ITEMS, totalSavings: MOCK_ITEMS.reduce((s, i) => s + i.estimatedSavings, 0), dataAvailable: true };
}

function p95(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return sorted[idx];
}

export const getSqlDbRightsizingRecommendations = async (tenantId: string): Promise<SqlDbRightsizingResult> => {
    if (isMockTenant(tenantId)) return buildMockResult();

    let rawDbs: any[] = [];
    try {
        const argClient = await getResourceGraphClient(tenantId);
        const query = `
            Resources
            | where type =~ 'microsoft.sql/servers/databases'
            | where name != 'master'
            | extend serverName = tostring(split(id, '/')[8])
            | project name, resourceGroup, resourceId = tolower(id), serverName,
                      skuName = tostring(sku.name), skuTier = tostring(sku.tier), skuCapacity = toint(sku.capacity)
        `;
        const resARG: any = await argClient.resources({ query, options: { resultFormat: "objectArray", top: 1000 } });
        rawDbs = (resARG.data as any[]) || [];
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`[SQL DB Rightsizing] No se pudo inventariar para ${tenantId}:`, message);
        return { items: [], totalSavings: 0, dataAvailable: false };
    }

    if (rawDbs.length === 0) return { items: [], totalSavings: 0, dataAvailable: true };

    let credential;
    try {
        credential = await getAzureCredential(tenantId);
    } catch {
        return { items: [], totalSavings: 0, dataAvailable: false };
    }

    const now = new Date();
    const past30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const timespan = `${past30Days.toISOString()}/${now.toISOString()}`;

    const items: SqlDbRightsizingRow[] = [];
    for (const db of rawDbs) {
        const resourceId = String(db.resourceId);
        const subscriptionId = resourceId.split("/")[2] || "";
        if (!subscriptionId) continue;
        const isDtuModel = ["Basic", "Standard", "Premium"].includes(String(db.skuTier));
        if (!isDtuModel) continue; // vCore: fuera de alcance de esta primera pasada (sin tabla de precios propia confiable)

        try {
            const monitorClient = new MonitorClient(credential, subscriptionId);
            const metrics = await monitorClient.metrics.list(resourceId, {
                timespan,
                interval: "P1D",
                metricnames: "dtu_consumption_percent",
                aggregation: "Average",
            });
            const values: number[] = [];
            for (const metric of metrics.value || []) {
                for (const point of metric.timeseries?.[0]?.data || []) {
                    if (typeof point.average === "number") values.push(point.average);
                }
            }
            if (values.length === 0) continue;
            const p95Dtu = p95(values);
            if (p95Dtu >= 20) continue;

            const currentDtu = Number(db.skuCapacity) || 0;
            const step = dtuLadderStep(currentDtu, true);
            if (!step) continue;
            const currentRow = DTU_LADDER.find((s) => s.dtu === currentDtu);
            const monthlyCost = currentRow?.monthlyCost ?? 0;
            const estimatedSavings = Number((monthlyCost - step.monthlyCost).toFixed(2));
            if (estimatedSavings <= 0) continue;

            items.push({
                serverName: db.serverName,
                dbName: db.name,
                resourceGroup: db.resourceGroup,
                resourceId,
                currentTier: String(db.skuName || `${db.skuTier} ${currentDtu} DTU`),
                recommendedTier: step.tier,
                avgDtuPercent: Math.round(p95Dtu),
                monthlyCost,
                estimatedSavings,
                reason: `DTU P95 ${p95Dtu.toFixed(0)}% en 30 días — sobredimensionada`,
            });
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.warn(`[SQL DB Rightsizing] Métricas no disponibles para ${resourceId}:`, message);
        }
    }

    return {
        items: items.sort((a, b) => b.estimatedSavings - a.estimatedSavings),
        totalSavings: Number(items.reduce((s, i) => s + i.estimatedSavings, 0).toFixed(2)),
        dataAvailable: true,
    };
};
