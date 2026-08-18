import pool, { initializeDatabase } from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { collectAdvisorData } from "@/modules/collectors/azure/advisorCollector";
import type {
    CoinIndexSummary,
    RecommendationStatusBreakdown,
    CategoryCoinBreakdown,
    CoinMonthlyTrendPoint,
    QuickWinRecommendation,
} from "@/lib/coinTypes";

const WAF_CATEGORIES = [
    { key: "Cost", label: "Cost", defaultTotal: 42, defaultSavings: 310.0 },
    { key: "Security", label: "Security", defaultTotal: 15, defaultSavings: 0.0 },
    { key: "Reliability", label: "Reliability", defaultTotal: 8, defaultSavings: 45.0 },
    { key: "Performance", label: "Performance", defaultTotal: 6, defaultSavings: 65.0 },
    { key: "OperationalExcellence", label: "Operational Excellence", defaultTotal: 4, defaultSavings: 0.0 },
];

/**
 * Retorna los datos mock exhaustivos y consistentes para el modo demo.
 */
function getMockCoinData(days: number): CoinIndexSummary {
    const totalCount = 75;
    const pendingCount = 75;
    const acceptedCount = 0;
    const implementedCount = 0;
    const snoozedCount = 0;
    const dismissedCount = 0;

    const totalPotentialSavingsUsd = 420.0;
    const realizedSavingsUsd = 0.0;

    const coinVolumeRate = totalCount > 0 ? Math.round((implementedCount / totalCount) * 1000) / 10 : 0;
    const coinFinancialRate = totalPotentialSavingsUsd > 0
        ? Math.round((realizedSavingsUsd / totalPotentialSavingsUsd) * 1000) / 10
        : 0;

    const breakdown: CategoryCoinBreakdown[] = WAF_CATEGORIES.map((c) => ({
        category: c.key,
        implemented: 0,
        total: c.defaultTotal,
        coinRate: 0,
        potentialSavingsUsd: c.defaultSavings,
        realizedSavingsUsd: 0,
    }));

    // Tendencia mensual últimos 6 meses
    const monthly: CoinMonthlyTrendPoint[] = Array.from({ length: 6 }).map((_, i) => {
        const d = new Date();
        d.setMonth(d.getMonth() - (5 - i));
        // En demo mostramos la progresión o inicio en 0%
        const simulatedRate = i === 5 ? 0 : Math.round(i * 4.5 * 10) / 10;
        return {
            month: d.toISOString().slice(0, 7),
            coinRate: simulatedRate,
            implementedCount: Math.round(simulatedRate * 0.75),
            totalCount: 75,
            benchmarkTarget: 70,
        };
    });

    const quickWins: QuickWinRecommendation[] = [
        {
            id: "rec-disk-unattached-01",
            name: "Eliminar discos no administrados y snapshots huérfanos",
            category: "Cost",
            impact: "High",
            impactedResource: "disk-unattached-prod-01",
            resourceGroup: "rg-finops-production",
            subscriptionName: "Producción Principal",
            estimatedMonthlySavingsUsd: 145.0,
            targetModuleUrl: "/intelligence/almacenamiento",
            status: "pending",
        },
        {
            id: "rec-vm-rightsizing-02",
            name: "Redimensionar instancias de VM infrautilizadas (Rightsizing)",
            category: "Cost",
            impact: "High",
            impactedResource: "vm-app-worker-02",
            resourceGroup: "rg-compute-core",
            subscriptionName: "Producción Principal",
            estimatedMonthlySavingsUsd: 95.0,
            targetModuleUrl: "/intelligence/computo",
            status: "pending",
        },
        {
            id: "rec-sql-serverless-03",
            name: "Migrar Azure SQL Database a nivel Serverless con auto-pausa",
            category: "Cost",
            impact: "Medium",
            impactedResource: "sql-db-reporting-shared",
            resourceGroup: "rg-databases-shared",
            subscriptionName: "Producción Principal",
            estimatedMonthlySavingsUsd: 70.0,
            targetModuleUrl: "/intelligence/bases-de-datos",
            status: "pending",
        },
        {
            id: "rec-storage-zrs-04",
            name: "Habilitar redundancia de zona (ZRS) en Storage Accounts críticos",
            category: "Reliability",
            impact: "High",
            impactedResource: "stprodsharedblob01",
            resourceGroup: "rg-storage-production",
            subscriptionName: "Producción Principal",
            estimatedMonthlySavingsUsd: 45.0,
            targetModuleUrl: "/intelligence/almacenamiento",
            status: "pending",
        },
        {
            id: "rec-network-afd-05",
            name: "Optimizar reglas de Azure Front Door y caché perimetral",
            category: "Performance",
            impact: "Medium",
            impactedResource: "afd-global-gateway",
            resourceGroup: "rg-network-perimeter",
            subscriptionName: "Producción Principal",
            estimatedMonthlySavingsUsd: 65.0,
            targetModuleUrl: "/intelligence/redes",
            status: "pending",
        },
    ];

    const statusBreakdown: RecommendationStatusBreakdown = {
        pending: pendingCount,
        accepted: acceptedCount,
        implemented: implementedCount,
        snoozed: snoozedCount,
        dismissed: dismissedCount,
        total: totalCount,
    };

    return {
        success: true,
        mock: true,
        windowDays: days,
        coinVolumeRate,
        coinFinancialRate,
        coin: coinVolumeRate,
        totalPotentialSavingsUsd,
        realizedSavingsUsd,
        statusBreakdown,
        implemented: implementedCount,
        total: totalCount,
        pending: pendingCount,
        accepted: acceptedCount,
        suppressed: snoozedCount,
        snoozed: snoozedCount,
        dismissed: dismissedCount,
        breakdown,
        monthly,
        quickWins,
    };
}

/**
 * Obtiene el resumen del Índice COIN para un tenant dado.
 */
export async function getCoinIndexSummary(tenantId: string, days = 90): Promise<CoinIndexSummary> {
    if (isMockTenant(tenantId)) {
        return getMockCoinData(days);
    }

    await initializeDatabase();

    // 1. Obtener conteos por estado en RecommendationActions
    const [statusRows]: any = await pool.query(
        `SELECT
            SUM(CASE WHEN status='implemented' THEN 1 ELSE 0 END) AS implemented,
            SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) AS accepted,
            SUM(CASE WHEN status='suppressed' OR (status='open' AND expires_at > CURRENT_TIMESTAMP) THEN 1 ELSE 0 END) AS snoozed,
            SUM(CASE WHEN status='dismissed' THEN 1 ELSE 0 END) AS dismissed,
            SUM(CASE WHEN status='open' AND (expires_at IS NULL OR expires_at <= CURRENT_TIMESTAMP) THEN 1 ELSE 0 END) AS pending,
            COUNT(*) AS total
         FROM RecommendationActions
         WHERE tenant_id=? AND updated_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)`,
        [tenantId, days]
    );

    const s = statusRows[0] || {};
    const implementedCount = Number(s.implemented || 0);
    const acceptedCount = Number(s.accepted || 0);
    const snoozedCount = Number(s.snoozed || 0);
    const dismissedCount = Number(s.dismissed || 0);
    const pendingCount = Number(s.pending || 0);
    const totalCount = Number(s.total || 0);

    // 2. Obtener desglose por categorías WAF
    const [catRows]: any = await pool.query(
        `SELECT
            COALESCE(category, 'Cost') AS category,
            SUM(CASE WHEN status='implemented' THEN 1 ELSE 0 END) AS implemented,
            COUNT(*) AS total
         FROM RecommendationActions
         WHERE tenant_id=? AND updated_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)
         GROUP BY category`,
        [tenantId, days]
    );

    const catMap = new Map<string, { implemented: number; total: number }>();
    for (const r of catRows as any[]) {
        const catKey = r.category === "HighAvailability" ? "Reliability" : r.category;
        const prev = catMap.get(catKey) || { implemented: 0, total: 0 };
        catMap.set(catKey, {
            implemented: prev.implemented + Number(r.implemented || 0),
            total: prev.total + Number(r.total || 0),
        });
    }

    // 3. Intentar enriquecer con Advisor real para ahorros monetarios y Quick Wins
    let totalPotentialSavings = 0;
    let realizedSavings = 0;
    const quickWins: QuickWinRecommendation[] = [];

    try {
        const advisorData = await collectAdvisorData(tenantId, "es");
        const grouped = advisorData?.recommendations || {};
        const allRecs: any[] = Object.values(grouped).flat() as any[];

        for (const rec of allRecs) {
            const ext = rec.extendedProperties || {};
            const savingsVal = parseFloat(
                ext.savingsAmount ||
                ext.annualSavingsAmount ? (parseFloat(ext.annualSavingsAmount) / 12).toString() : "0"
            ) || 0;

            if (savingsVal > 0) {
                totalPotentialSavings += savingsVal;
                if (rec._state === "implemented" || rec.status === "implemented") {
                    realizedSavings += savingsVal;
                }
            }

            // Quick Wins: recomendaciones de alto impacto abiertas
            if (quickWins.length < 5 && (rec._state === "active" || rec._state === "open" || !rec._state)) {
                let targetUrl = "/intelligence/computo";
                const catLower = (rec.category || "").toLowerCase();
                if (catLower.includes("cost")) targetUrl = "/intelligence/costo-por-categoria";
                else if (catLower.includes("storage") || (rec.impactedField || "").includes("storage")) targetUrl = "/intelligence/almacenamiento";
                else if (catLower.includes("sql") || (rec.impactedField || "").includes("sql")) targetUrl = "/intelligence/bases-de-datos";
                else if (catLower.includes("security")) targetUrl = "/intelligence/seguridad";
                else if (catLower.includes("network")) targetUrl = "/intelligence/redes";

                quickWins.push({
                    id: rec.id || rec.name || `rec-${quickWins.length}`,
                    name: rec.shortDescription?.problem || rec.name || "Optimización recomendada",
                    category: rec.category === "HighAvailability" ? "Reliability" : (rec.category || "Cost"),
                    impact: rec.impact || "Medium",
                    impactedResource: rec.impactedValue || rec.resourceId || "Recurso Cloud",
                    estimatedMonthlySavingsUsd: savingsVal > 0 ? Math.round(savingsVal * 100) / 100 : 0,
                    targetModuleUrl: targetUrl,
                    status: "pending",
                });
            }
        }
    } catch {
        // Fallback silencioso si Advisor API no responde
    }

    // Asegurar los 5 pilares WAF
    const breakdown: CategoryCoinBreakdown[] = WAF_CATEGORIES.map((c) => {
        const item = catMap.get(c.key) || { implemented: 0, total: 0 };
        const rate = item.total > 0 ? Math.round((item.implemented / item.total) * 1000) / 10 : 0;
        return {
            category: c.key,
            implemented: item.implemented,
            total: item.total,
            coinRate: rate,
            potentialSavingsUsd: 0,
            realizedSavingsUsd: 0,
        };
    });

    // 4. Serie mensual últimos 6 meses
    const [seriesRows]: any = await pool.query(
        `SELECT
            DATE_FORMAT(updated_at, '%Y-%m') AS month,
            SUM(CASE WHEN status='implemented' THEN 1 ELSE 0 END) AS implemented,
            COUNT(*) AS total
         FROM RecommendationActions
         WHERE tenant_id=? AND updated_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 6 MONTH)
         GROUP BY month ORDER BY month ASC`,
        [tenantId]
    );

    const monthly: CoinMonthlyTrendPoint[] = (seriesRows as any[]).map((r) => {
        const tot = Number(r.total || 0);
        const imp = Number(r.implemented || 0);
        return {
            month: r.month,
            coinRate: tot > 0 ? Math.round((imp / tot) * 1000) / 10 : 0,
            implementedCount: imp,
            totalCount: tot,
            benchmarkTarget: 70,
        };
    });

    // Si no hay meses en DB, generar al menos los últimos 6 meses con 0
    if (monthly.length === 0) {
        for (let i = 5; i >= 0; i--) {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            monthly.push({
                month: d.toISOString().slice(0, 7),
                coinRate: 0,
                implementedCount: 0,
                totalCount: 0,
                benchmarkTarget: 70,
            });
        }
    }

    const coinVolumeRate = totalCount > 0 ? Math.round((implementedCount / totalCount) * 1000) / 10 : 0;
    const coinFinancialRate = totalPotentialSavings > 0
        ? Math.round((realizedSavings / totalPotentialSavings) * 1000) / 10
        : 0;

    return {
        success: true,
        windowDays: days,
        coinVolumeRate,
        coinFinancialRate,
        coin: coinVolumeRate,
        totalPotentialSavingsUsd: Math.round(totalPotentialSavings * 100) / 100,
        realizedSavingsUsd: Math.round(realizedSavings * 100) / 100,
        statusBreakdown: {
            pending: pendingCount,
            accepted: acceptedCount,
            implemented: implementedCount,
            snoozed: snoozedCount,
            dismissed: dismissedCount,
            total: totalCount,
        },
        implemented: implementedCount,
        total: totalCount,
        pending: pendingCount,
        accepted: acceptedCount,
        suppressed: snoozedCount,
        snoozed: snoozedCount,
        dismissed: dismissedCount,
        breakdown,
        monthly,
        quickWins,
    };
}
