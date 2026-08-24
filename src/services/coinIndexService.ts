import pool, { initializeDatabase } from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { getAdvisorExecutiveData } from "@/services/azureAdvisor.service";
import type { AdvisorCategory, AdvisorRecommendation } from "@/types/azureAdvisor.types";
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

interface DbActionRow {
    recommendation_id: string;
    category: string | null;
    resource_id: string | null;
    status: string;
    user_email: string | null;
    reason: string | null;
    expires_at: Date | string | null;
    updated_at: Date | string;
}

/**
 * Obtiene el resumen del Índice COIN para un tenant dado consumiendo telemetría real
 * deduplicada de Azure Advisor y el historial de acciones en RecommendationActions.
 */
export async function getCoinIndexSummary(tenantId: string, days = 90): Promise<CoinIndexSummary> {
    if (isMockTenant(tenantId)) {
        return getMockCoinData(days);
    }

    await initializeDatabase();

    // 1. Limpieza de supresiones expiradas (auto-reapertura)
    try {
        await pool.query(
            `UPDATE RecommendationActions SET status='open', updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=? AND status='suppressed' AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP`,
            [tenantId]
        );
    } catch (e) {
        console.warn("[coinIndexService] Error cleaning expired suppressions:", e);
    }

    // 2. Obtener acciones registradas en DB
    let dbActions: DbActionRow[] = [];
    try {
        const [actionRows]: any = await pool.query(
            `SELECT recommendation_id, category, resource_id, status, user_email, reason, expires_at, updated_at
             FROM RecommendationActions
             WHERE tenant_id=?`,
            [tenantId]
        );
        dbActions = actionRows as DbActionRow[];
    } catch (e) {
        console.warn("[coinIndexService] Error fetching RecommendationActions:", e);
    }

    const actionMap = new Map<string, DbActionRow>();
    for (const a of dbActions) {
        actionMap.set(a.recommendation_id, a);
    }

    // 3. Consultar Azure Advisor Executive Data (deduplicado por recurso + regla + sin variantes lookback redundantes)
    let advisorRecs: Record<AdvisorCategory, AdvisorRecommendation[]> = {
        Cost: [],
        Security: [],
        HighAvailability: [],
        Performance: [],
        OperationalExcellence: [],
    };

    try {
        const advisorExecutive = await getAdvisorExecutiveData(tenantId, "es");
        if (advisorExecutive?.recommendations) {
            advisorRecs = advisorExecutive.recommendations;
        }
    } catch (e) {
        console.warn("[coinIndexService] Error reading live Advisor Executive Data:", e);
    }

    // 4. Mapeo de categorías WAF
    const wafCounts = {
        Cost: { pending: 0, accepted: 0, implemented: 0, snoozed: 0, dismissed: 0, potentialSavings: 0, realizedSavings: 0 },
        Security: { pending: 0, accepted: 0, implemented: 0, snoozed: 0, dismissed: 0, potentialSavings: 0, realizedSavings: 0 },
        Reliability: { pending: 0, accepted: 0, implemented: 0, snoozed: 0, dismissed: 0, potentialSavings: 0, realizedSavings: 0 },
        Performance: { pending: 0, accepted: 0, implemented: 0, snoozed: 0, dismissed: 0, potentialSavings: 0, realizedSavings: 0 },
        OperationalExcellence: { pending: 0, accepted: 0, implemented: 0, snoozed: 0, dismissed: 0, potentialSavings: 0, realizedSavings: 0 },
    };

    const normalizeCatKey = (cat: string): keyof typeof wafCounts => {
        if (cat === "HighAvailability" || cat === "Reliability") return "Reliability";
        if (cat === "Security") return "Security";
        if (cat === "Performance") return "Performance";
        if (cat === "OperationalExcellence" || cat === "Operational Excellence") return "OperationalExcellence";
        return "Cost";
    };

    const matchedRecKeys = new Set<string>();
    const pendingQuickWinsCandidates: QuickWinRecommendation[] = [];

    // Procesar recomendaciones activas de Azure Advisor
    for (const [catName, recList] of Object.entries(advisorRecs)) {
        const catKey = normalizeCatKey(catName);

        for (const rec of recList) {
            const keysToMatch = [rec.id, rec.name, rec.dedupKey].filter(Boolean) as string[];
            let matchedAction: DbActionRow | undefined;
            for (const k of keysToMatch) {
                if (actionMap.has(k)) {
                    matchedAction = actionMap.get(k);
                    matchedRecKeys.add(k);
                    break;
                }
            }

            const monthlySav = Number(rec.monthlySavingsUSD || (rec.annualSavingsUSD ? rec.annualSavingsUSD / 12 : 0)) || 0;

            if (matchedAction) {
                const isSnoozed =
                    (matchedAction.status === "suppressed" || matchedAction.status === "snoozed") &&
                    matchedAction.expires_at !== null &&
                    new Date(matchedAction.expires_at) > new Date();

                const isDismissed =
                    matchedAction.status === "dismissed" ||
                    ((matchedAction.status === "suppressed" || matchedAction.status === "snoozed") &&
                        (matchedAction.expires_at === null || new Date(matchedAction.expires_at).getFullYear() > 8000));

                if (matchedAction.status === "implemented") {
                    wafCounts[catKey].implemented++;
                    wafCounts[catKey].realizedSavings += monthlySav;
                    wafCounts[catKey].potentialSavings += monthlySav;
                } else if (matchedAction.status === "accepted") {
                    wafCounts[catKey].accepted++;
                    wafCounts[catKey].potentialSavings += monthlySav;
                } else if (isSnoozed) {
                    wafCounts[catKey].snoozed++;
                } else if (isDismissed) {
                    wafCounts[catKey].dismissed++;
                } else {
                    wafCounts[catKey].pending++;
                    wafCounts[catKey].potentialSavings += monthlySav;
                    if (catKey === "Cost" || monthlySav > 0) {
                        pendingQuickWinsCandidates.push(buildQuickWinFromRec(rec, monthlySav, catKey));
                    }
                }
            } else {
                // Sin acción registrada -> Pendiente activa
                wafCounts[catKey].pending++;
                wafCounts[catKey].potentialSavings += monthlySav;
                pendingQuickWinsCandidates.push(buildQuickWinFromRec(rec, monthlySav, catKey));
            }
        }
    }

    // Procesar acciones históricas en DB que ya no están activas en Advisor (resueltas, descartadas o pospuestas)
    const windowCutoff = new Date(Date.now() - days * 86400000);

    for (const a of dbActions) {
        if (matchedRecKeys.has(a.recommendation_id)) continue;

        const actionDate = new Date(a.updated_at);
        if (actionDate < windowCutoff) continue;

        const catKey = normalizeCatKey(a.category || "Cost");
        const isSnoozed =
            (a.status === "suppressed" || a.status === "snoozed") &&
            a.expires_at !== null &&
            new Date(a.expires_at) > new Date();

        const isDismissed =
            a.status === "dismissed" ||
            ((a.status === "suppressed" || a.status === "snoozed") &&
                (a.expires_at === null || new Date(a.expires_at).getFullYear() > 8000));

        if (a.status === "implemented") {
            wafCounts[catKey].implemented++;
        } else if (a.status === "accepted") {
            wafCounts[catKey].accepted++;
        } else if (isSnoozed) {
            wafCounts[catKey].snoozed++;
        } else if (isDismissed) {
            wafCounts[catKey].dismissed++;
        }
    }

    // 5. Totales consolidados de estados
    let totalPending = 0;
    let totalAccepted = 0;
    let totalImplemented = 0;
    let totalSnoozed = 0;
    let totalDismissed = 0;
    let totalPotentialSavingsUsd = 0;
    let realizedSavingsUsd = 0;

    for (const counts of Object.values(wafCounts)) {
        totalPending += counts.pending;
        totalAccepted += counts.accepted;
        totalImplemented += counts.implemented;
        totalSnoozed += counts.snoozed;
        totalDismissed += counts.dismissed;
        totalPotentialSavingsUsd += counts.potentialSavings;
        realizedSavingsUsd += counts.realizedSavings;
    }

    const totalCount = totalPending + totalAccepted + totalImplemented + totalSnoozed + totalDismissed;
    const coinVolumeRate = totalCount > 0 ? Math.round((totalImplemented / totalCount) * 1000) / 10 : 0;
    const coinFinancialRate = totalPotentialSavingsUsd > 0
        ? Math.round((realizedSavingsUsd / totalPotentialSavingsUsd) * 1000) / 10
        : 0;

    // 6. Desglose WAF para gráficos de barras
    const breakdown: CategoryCoinBreakdown[] = [
        { key: "Cost", label: "Cost Optimization" },
        { key: "Security", label: "Security & Compliance" },
        { key: "Reliability", label: "Reliability & HA" },
        { key: "Performance", label: "Performance" },
        { key: "OperationalExcellence", label: "Operational Excellence" },
    ].map((item) => {
        const counts = wafCounts[item.key as keyof typeof wafCounts];
        const catTotal = counts.pending + counts.accepted + counts.implemented + counts.snoozed + counts.dismissed;
        const rate = catTotal > 0 ? Math.round((counts.implemented / catTotal) * 1000) / 10 : 0;

        return {
            category: item.key,
            implemented: counts.implemented,
            total: catTotal,
            coinRate: rate,
            potentialSavingsUsd: Math.round(counts.potentialSavings * 100) / 100,
            realizedSavingsUsd: Math.round(counts.realizedSavings * 100) / 100,
        };
    });

    // 7. Top 5 Quick Wins Pendientes (con mayor ahorro mensual y nombres legibles de recursos)
    const quickWins = pendingQuickWinsCandidates
        .sort((a, b) => (b.estimatedMonthlySavingsUsd || 0) - (a.estimatedMonthlySavingsUsd || 0))
        .slice(0, 5);

    // 8. Tendencia Mensual Últimos 6 Meses
    let monthly: CoinMonthlyTrendPoint[] = [];
    try {
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

        const seriesMap = new Map<string, { implemented: number; total: number }>();
        for (const r of (seriesRows as any[])) {
            seriesMap.set(r.month, {
                implemented: Number(r.implemented || 0),
                total: Number(r.total || 0),
            });
        }

        for (let i = 5; i >= 0; i--) {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            const mKey = d.toISOString().slice(0, 7);
            const entry = seriesMap.get(mKey) || { implemented: 0, total: 0 };
            const mTotal = Math.max(entry.total, totalCount);
            const mImp = entry.implemented;
            const rate = mTotal > 0 ? Math.round((mImp / mTotal) * 1000) / 10 : 0;

            monthly.push({
                month: mKey,
                coinRate: rate,
                implementedCount: mImp,
                totalCount: mTotal,
                benchmarkTarget: 70,
            });
        }
    } catch (e) {
        console.warn("[coinIndexService] Error generating monthly series:", e);
        monthly = Array.from({ length: 6 }).map((_, i) => {
            const d = new Date();
            d.setMonth(d.getMonth() - (5 - i));
            return {
                month: d.toISOString().slice(0, 7),
                coinRate: coinVolumeRate,
                implementedCount: totalImplemented,
                totalCount: totalCount,
                benchmarkTarget: 70,
            };
        });
    }

    const statusBreakdown: RecommendationStatusBreakdown = {
        pending: totalPending,
        accepted: totalAccepted,
        implemented: totalImplemented,
        snoozed: totalSnoozed,
        dismissed: totalDismissed,
        total: totalCount,
    };

    return {
        success: true,
        windowDays: days,
        coinVolumeRate,
        coinFinancialRate,
        coin: coinVolumeRate,
        totalPotentialSavingsUsd: Math.round(totalPotentialSavingsUsd * 100) / 100,
        realizedSavingsUsd: Math.round(realizedSavingsUsd * 100) / 100,
        statusBreakdown,
        implemented: totalImplemented,
        total: totalCount,
        pending: totalPending,
        accepted: totalAccepted,
        suppressed: totalSnoozed,
        snoozed: totalSnoozed,
        dismissed: totalDismissed,
        breakdown,
        monthly,
        quickWins,
    };
}

function buildQuickWinFromRec(rec: AdvisorRecommendation, monthlySav: number, catKey: string): QuickWinRecommendation {
    let targetUrl = "/intelligence/computo";
    const catLower = (rec.category || "").toLowerCase();
    const svcLower = (rec.serviceName || "").toLowerCase();
    const probLower = (rec.name || rec.titleTranslated || "").toLowerCase();

    if (catLower.includes("cost") || probLower.includes("saving") || probLower.includes("reserv")) {
        targetUrl = "/intelligence/optimizacion-y-ahorro";
    } else if (catLower.includes("storage") || svcLower.includes("storage") || probLower.includes("disk")) {
        targetUrl = "/intelligence/almacenamiento";
    } else if (catLower.includes("database") || svcLower.includes("sql") || svcLower.includes("mysql") || svcLower.includes("postgres")) {
        targetUrl = "/intelligence/bases-de-datos";
    } else if (catLower.includes("security")) {
        targetUrl = "/intelligence/seguridad";
    } else if (catLower.includes("network")) {
        targetUrl = "/intelligence/redes";
    }

    // Extracción limpia del recurso afectado (evitando GUIDs puros como nombre principal)
    let displayResource = rec.resourceName || rec.resource?.resourceName || "";
    if (!displayResource || displayResource === "—" || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(displayResource)) {
        if (rec.subscriptionName && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rec.subscriptionName)) {
            displayResource = rec.subscriptionName;
        } else if (rec.resourceGroup) {
            displayResource = rec.resourceGroup;
        } else if (rec.serviceName) {
            displayResource = rec.serviceName;
        } else {
            displayResource = "Recurso Cloud";
        }
    }

    return {
        id: rec.dedupKey || rec.id,
        name: rec.titleTranslated || rec.name || "Optimización recomendada",
        category: catKey,
        impact: rec.impact || "Medium",
        impactedResource: displayResource,
        resourceGroup: rec.resourceGroup || "",
        subscriptionName: rec.subscriptionName || "",
        estimatedMonthlySavingsUsd: monthlySav > 0 ? Math.round(monthlySav * 100) / 100 : 0,
        targetModuleUrl: targetUrl,
        status: "pending",
    };
}

