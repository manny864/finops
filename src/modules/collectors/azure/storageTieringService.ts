/**
 * Storage Tiering Service — recomendaciones reales de migración Hot→Cool/Archive
 * por cuenta de almacenamiento, basadas en patrones de acceso reales (no mock).
 *
 * RBAC mínimo (Service Principal del tenant, solo lectura):
 *   - Reader (Resource Graph) para inventariar cuentas de storage.
 *   - Monitoring Reader para BlobCapacity (por Tier) y Transactions.
 *
 * Punto ciego del reporte: archivos/respaldos antiguos en capa Hot en vez de
 * migrarse vía Lifecycle Management a Cool/Archive. Se detecta cruzando GB
 * almacenados en Hot (Azure Monitor, dimensión BlobType/Tier) contra el
 * volumen de transacciones reales de los últimos 30 días: capacidad grande
 * en Hot + transacciones bajas = candidata a Cool/Archive.
 */
import { getResourceGraphClient } from "@/lib/azure";
import { MonitorClient } from "@azure/arm-monitor";
import { getAzureCredential } from "@/lib/azure";
import { isMockTenant } from "@/lib/mockData";

export interface StorageTieringRow {
    accountName: string;
    resourceGroup: string;
    resourceId: string;
    currentTier: "Hot" | "Cool";
    recommendedTier: "Cool" | "Archive";
    usedGb: number;
    monthlyCost: number;
    estimatedSavings: number;
    reason: string;
}

export interface StorageTieringResult {
    items: StorageTieringRow[];
    totalSavings: number;
    dataAvailable: boolean;
}

// $/GB/mes aproximado (Blob LRS, Hot/Cool/Archive) — usado solo para estimar
// el ahorro de mover GB de una capa a otra, no para el costo real facturado.
const TIER_RATE: Record<string, number> = { Hot: 0.0184, Cool: 0.01, Archive: 0.00099 };

const MOCK_ITEMS: StorageTieringRow[] = [
    { accountName: 'stproddata01', resourceGroup: 'rg-prod', resourceId: 'mock', currentTier: 'Hot', recommendedTier: 'Cool', usedGb: 18500, monthlyCost: 340, estimatedSavings: 155, reason: 'Bajo volumen de transacciones (<1/día/GB) sostenido 30 días' },
    { accountName: 'stbackups', resourceGroup: 'rg-backups', resourceId: 'mock', currentTier: 'Hot', recommendedTier: 'Archive', usedGb: 42000, monthlyCost: 775, estimatedSavings: 734, reason: 'Prácticamente sin transacciones en 30 días — candidata a Archive' },
];

function buildMockResult(): StorageTieringResult {
    return { items: MOCK_ITEMS, totalSavings: MOCK_ITEMS.reduce((s, i) => s + i.estimatedSavings, 0), dataAvailable: true };
}

export const getStorageTieringRecommendations = async (tenantId: string): Promise<StorageTieringResult> => {
    if (isMockTenant(tenantId)) return buildMockResult();

    let rawAccounts: any[] = [];
    try {
        const argClient = await getResourceGraphClient(tenantId);
        const query = `
            Resources
            | where type =~ 'microsoft.storage/storageaccounts'
            | project name, resourceGroup, resourceId = tolower(id), subscriptionId
        `;
        const resARG: any = await argClient.resources({ query, options: { resultFormat: "objectArray", top: 1000 } });
        rawAccounts = (resARG.data as any[]) || [];
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`[Storage Tiering] No se pudo inventariar para ${tenantId}:`, message);
        return { items: [], totalSavings: 0, dataAvailable: false };
    }

    if (rawAccounts.length === 0) return { items: [], totalSavings: 0, dataAvailable: true };

    let credential;
    try {
        credential = await getAzureCredential(tenantId);
    } catch {
        return { items: [], totalSavings: 0, dataAvailable: false };
    }

    const now = new Date();
    const past30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const timespan = `${past30Days.toISOString()}/${now.toISOString()}`;

    const items: StorageTieringRow[] = [];
    for (const acc of rawAccounts) {
        const resourceId = String(acc.resourceId);
        const subscriptionId = String(acc.subscriptionId || "");
        if (!subscriptionId) continue;
        try {
            const monitorClient = new MonitorClient(credential, subscriptionId);
            const blobResourceId = `${resourceId}/blobServices/default`;

            // GB por Tier (Average del período, snapshot representativo del estado actual).
            const capacityMetrics = await monitorClient.metrics.list(blobResourceId, {
                timespan,
                interval: "P1D",
                metricnames: "BlobCapacity",
                aggregation: "Average",
                metricnamespace: "Microsoft.Storage/storageAccounts/blobServices",
                filter: "Tier eq '*'",
            });

            let hotBytes = 0;
            for (const metric of capacityMetrics.value || []) {
                for (const series of metric.timeseries || []) {
                    const tierValue = series.metadatavalues?.find((m) => m.name?.value?.toLowerCase() === "tier")?.value;
                    if (tierValue !== "Hot") continue;
                    const points = series.data || [];
                    const last = [...points].reverse().find((p) => typeof p.average === "number");
                    if (last && typeof last.average === "number") hotBytes = Math.max(hotBytes, last.average);
                }
            }
            const hotGb = hotBytes / (1024 * 1024 * 1024);
            if (hotGb < 1) continue; // sin datos significativos en Hot, nada que recomendar

            // Transacciones totales (Total, 30 días) — proxy de actividad real sobre la cuenta.
            const txMetrics = await monitorClient.metrics.list(blobResourceId, {
                timespan,
                interval: "P1D",
                metricnames: "Transactions",
                aggregation: "Total",
            });
            let totalTx = 0;
            for (const metric of txMetrics.value || []) {
                for (const point of metric.timeseries?.[0]?.data || []) {
                    if (typeof point.total === "number") totalTx += point.total;
                }
            }
            const txPerGbPerDay = hotGb > 0 ? totalTx / hotGb / 30 : 0;

            // Umbral: <0.05 transacciones/GB/día sostenido 30 días = prácticamente frío.
            // <0.005 = candidata a Archive (casi sin acceso); si no, Cool.
            if (txPerGbPerDay >= 0.05) continue;
            const recommendedTier: "Cool" | "Archive" = txPerGbPerDay < 0.005 ? "Archive" : "Cool";
            const monthlyCost = Number((hotGb * TIER_RATE.Hot).toFixed(2));
            const estimatedSavings = Number((hotGb * (TIER_RATE.Hot - TIER_RATE[recommendedTier])).toFixed(2));

            items.push({
                accountName: acc.name,
                resourceGroup: acc.resourceGroup,
                resourceId,
                currentTier: "Hot",
                recommendedTier,
                usedGb: Math.round(hotGb),
                monthlyCost,
                estimatedSavings,
                reason: recommendedTier === "Archive"
                    ? `~${totalTx.toFixed(0)} transacciones en 30 días — prácticamente sin acceso, candidata a Archive`
                    : `${txPerGbPerDay.toFixed(3)} transacciones/GB/día — bajo uso, candidata a Cool`,
            });
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.warn(`[Storage Tiering] Métricas no disponibles para ${resourceId}:`, message);
        }
    }

    return {
        items: items.sort((a, b) => b.estimatedSavings - a.estimatedSavings),
        totalSavings: Number(items.reduce((s, i) => s + i.estimatedSavings, 0).toFixed(2)),
        dataAvailable: true,
    };
};
