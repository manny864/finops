import Decimal from "decimal.js";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { getCurrentMonthAmortizedCosts } from "@/modules/collectors/azure/billingService";
import { fetchTenantRealResourceInventory, type DiscoveredTenantResource } from "@/services/realConsumptionService";
import { getResourceCostsById } from "@/modules/collectors/azure/resourceInventoryService";
import {
    CATEGORY_COLOR_MAP,
    type CategoryOverview,
    type FinOpsCategoryDetail,
    type CategoryServiceBreakdown,
    type CategoryResourceDetail,
    type CategoryHistoricalPoint,
    type CategoryOptimizationOpportunity,
} from "@/lib/categoryConsumptionTypes";
import { errorMessage } from '@/lib/apiErrors';

export function getCategoryColor(category: string): string {
    return CATEGORY_COLOR_MAP[category] || "#94A3B8";
}

export function getCategoryIconName(category: string): string {
    switch (category.toLowerCase()) {
        case "databases":
            return "database";
        case "compute":
            return "cpu";
        case "networking":
            return "network";
        case "ai and machine learning":
        case "ai & ml":
            return "brain";
        case "storage":
            return "hard-drive";
        case "security":
            return "shield-lock";
        case "analytics":
            return "chart-dots";
        case "web":
            return "browser";
        case "management and governance":
            return "settings";
        default:
            return "layers";
    }
}

/**
 * Mapeo de servicio Azure a Categoría FinOps FOCUS
 */
export function mapServiceToCategory(serviceName: string, resourceType?: string): string {
    const s = (serviceName || "").toLowerCase();
    const r = (resourceType || "").toLowerCase();

    if (s.includes("sql") || s.includes("redis") || s.includes("cosmos") || s.includes("postgres") || s.includes("mysql") || s.includes("mariadb") || s.includes("database") || r.includes("microsoft.dbfor") || r.includes("microsoft.sql") || r.includes("microsoft.cache")) {
        return "Databases";
    }
    if (s.includes("container app") || s.includes("virtual machine") || s.includes("compute") || s.includes("batch") || s.includes("aks") || s.includes("kubernetes") || r.includes("microsoft.compute") || r.includes("microsoft.app") || r.includes("microsoft.containerservice")) {
        return "Compute";
    }
    if (s.includes("network") || s.includes("load balancer") || s.includes("bandwidth") || s.includes("gateway") || s.includes("firewall") || s.includes("dns") || s.includes("ip") || r.includes("microsoft.network")) {
        return "Networking";
    }
    if (s.includes("openai") || s.includes("foundry") || s.includes("cognitive") || s.includes("search") || s.includes("speech") || s.includes("ai") || s.includes("vision") || s.includes("bot") || r.includes("microsoft.cognitiveservices") || r.includes("microsoft.search")) {
        return "AI and Machine Learning";
    }
    if (s.includes("storage") || s.includes("blob") || s.includes("file") || s.includes("disk") || r.includes("microsoft.storage")) {
        return "Storage";
    }
    if (s.includes("security") || s.includes("key vault") || s.includes("defender") || s.includes("sentinel") || r.includes("microsoft.keyvault") || r.includes("microsoft.security")) {
        return "Security";
    }
    if (s.includes("synapse") || s.includes("databricks") || s.includes("fabric") || s.includes("data factory") || s.includes("analytics") || r.includes("microsoft.synapse") || r.includes("microsoft.datafactory")) {
        return "Analytics";
    }
    if (s.includes("app service") || s.includes("static web") || s.includes("web") || r.includes("microsoft.web")) {
        return "Web";
    }
    if (s.includes("monitor") || s.includes("log analytics") || s.includes("advisor") || s.includes("cost management") || s.includes("governance") || r.includes("microsoft.insights") || r.includes("microsoft.operationalinsights")) {
        return "Management and Governance";
    }
    return "Other";
}

/**
 * Reglas de optimización por categoría FinOps
 */
export function getCategoryRemediationRule(category: string, costMtd: number, topService?: string) {
    switch (category) {
        case "Databases":
            return {
                recommendation: `Concentra el mayor gasto del pilar de datos (${topService || "MySQL/Redis"}). Sugerir Reserved Capacity 1y en bases de datos relacionales y optimizar tamaño de caché.`,
                remediationActionLabel: "Ver Recomendaciones DB",
                remediationActionKey: "db_reservations_and_scale",
                potentialSavings: Math.min(65.0, Number(new Decimal(costMtd).times(0.35).toFixed(2))),
            };
        case "Compute":
            return {
                recommendation: "Cómputo distribuido entre Container Apps y VMs. Habilitar scale-to-zero en réplicas inactivas y rightsizing a serie B en desarrollo.",
                remediationActionLabel: "Rightsizing de VMs/Containers",
                remediationActionKey: "compute_rightsizing_scale_zero",
                potentialSavings: Math.min(45.0, Number(new Decimal(costMtd).times(0.32).toFixed(2))),
            };
        case "Networking":
            return {
                recommendation: "Gasto de red elevado en comparación al cómputo. Auditar Egress internacional, Gateways NAT y desasociar IPs públicas huérfanas.",
                remediationActionLabel: "Auditar Flujos y NAT/IPs",
                remediationActionKey: "networking_egress_and_nat_audit",
                potentialSavings: Math.min(30.0, Number(new Decimal(costMtd).times(0.40).toFixed(2))),
            };
        case "AI and Machine Learning":
            return {
                recommendation: "Consumo de tokens de inferencia sin límites diarios. Configurar cuotas máximas de tokens por endpoint y evaluar caching de prompts.",
                remediationActionLabel: "Configurar Cuotas de Inferencia",
                remediationActionKey: "ai_token_quota_limits",
                potentialSavings: Math.min(25.0, Number(new Decimal(costMtd).times(0.38).toFixed(2))),
            };
        case "Storage":
            return {
                recommendation: "Datos poco accedidos en capa Hot sin política de ciclo de vida. Mover contenedores antiguos a Cool y Archive.",
                remediationActionLabel: "Activar Lifecycle Management",
                remediationActionKey: "storage_lifecycle_cool_archive",
                potentialSavings: Math.min(18.0, Number(new Decimal(costMtd).times(0.28).toFixed(2))),
            };
        default:
            return {
                recommendation: "Monitoreo continuo y asignación estricta de etiquetas de gobernanza para atribución de costos.",
                remediationActionLabel: "Auditar Atribución de Costos",
                remediationActionKey: "generic_category_audit",
                potentialSavings: Math.min(10.0, Number(new Decimal(costMtd).times(0.15).toFixed(2))),
            };
    }
}

/**
 * Consulta de datos de categoría de costo real para tenants en producción
 */
export async function getRealCategoryOverview(tenantId: string, days: number = 30): Promise<CategoryOverview> {
    if (isMockTenant(tenantId)) {
        return getMockCategoryOverview(tenantId);
    }

    const now = new Date();
    const daysElapsed = Math.max(1, now.getDate());
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // El mes amortizado no depende del inventario — sólo del tenant — y suele
    // ser la llamada más lenta de las tres. Se arranca ya, en paralelo con el
    // inventario, en vez de esperar a que la cadena inventario →
    // getResourceCostsById termine para recién pedirlo.
    //
    // Se envuelve en un resultado en vez de dejar la promesa cruda: si rechaza
    // mientras se espera el inventario, sin handler adjunto seria un unhandled
    // rejection. El error se re-lanza abajo, dentro del try que ya sabe
    // degradar a `snapshot-fallback`.
    const amortizadosPendiente = getCurrentMonthAmortizedCosts(tenantId, "All", "ActualCost")
        .then((v) => ({ ok: true as const, valor: v }))
        .catch((e) => ({ ok: false as const, error: e as unknown }));

    // Descubrir inventario real de Azure para el tenant activo
    const inventory = await fetchTenantRealResourceInventory(tenantId);
    const defaultTenantRg = inventory.resourceGroups[0] || "rg-production";
    const defaultRegion = inventory.primaryRegion || "eastus2";

    // Obtener costos reales granulares por ResourceId directamente desde Azure Cost Management
    let realResourceCosts = new Map<string, number>();
    try {
        const queryResources = inventory.resources.map((r) => ({
            id: r.id,
            subscriptionId: r.subscriptionId || "sub-primary",
        }));
        if (queryResources.length > 0) {
            realResourceCosts = await getResourceCostsById(tenantId, queryResources);
        }
    } catch (costErr) {
        console.warn(`[categoryConsumptionService] getResourceCostsById fallback:`, errorMessage(costErr));
    }

    let totalCostDecimal = new Decimal(0);
    const categoryMap = new Map<string, {
        cost: Decimal;
        billedCost: Decimal;
        services: Map<string, { cost: Decimal; count: number; sku?: string }>;
        resources: Map<string, CategoryResourceDetail>;
    }>();

    let source = "live-cost-management";

    // 1. Intento de obtención de costos en vivo
    try {
        const amortizados = await amortizadosPendiente;
        if (!amortizados.ok) throw amortizados.error;
        const entries = amortizados.valor;
        if (entries && entries.length > 0) {
            for (const entry of entries) {
                const cost = new Decimal(entry.EffectiveCost || entry.BilledCost || 0);
                if (cost.lte(0)) continue;

                totalCostDecimal = totalCostDecimal.plus(cost);
                const rawService = (entry.ServiceName || "Other").trim() || "Other";
                const category = mapServiceToCategory(rawService, (entry as any).ResourceType);

                const catData = categoryMap.get(category) || {
                    cost: new Decimal(0),
                    billedCost: new Decimal(0),
                    services: new Map(),
                    resources: new Map(),
                };

                catData.cost = catData.cost.plus(cost);

                // Sub-service aggregation
                const svc = catData.services.get(rawService) || { cost: new Decimal(0), count: 0, sku: (entry as any).Sku };
                svc.cost = svc.cost.plus(cost);
                svc.count += 1;
                catData.services.set(rawService, svc);

                // Buscar recursos reales descubiertos en Azure para este servicio
                const matchingArmResources = inventory.resources.filter(
                    (r: DiscoveredTenantResource) =>
                        r.serviceName.toLowerCase() === rawService.toLowerCase() ||
                        rawService.toLowerCase().includes(r.serviceName.toLowerCase()) ||
                        r.type.toLowerCase().includes(rawService.toLowerCase().replace(/\s+/g, ""))
                );

                if (matchingArmResources.length > 0) {
                    const hasIndividualCosts = matchingArmResources.some((r) => realResourceCosts.has(r.id.toLowerCase()));

                    for (const armRes of matchingArmResources) {
                        const rawCost = realResourceCosts.get(armRes.id.toLowerCase());
                        let costForRes: Decimal;

                        if (rawCost !== undefined && rawCost >= 0) {
                            costForRes = new Decimal(rawCost);
                        } else if (hasIndividualCosts) {
                            costForRes = new Decimal(0);
                        } else {
                            costForRes = cost.dividedBy(matchingArmResources.length);
                        }

                        const rule = getCategoryRemediationRule(category, costForRes.toNumber(), rawService);
                        const existingRes = catData.resources.get(armRes.id);
                        if (existingRes) {
                            existingRes.cost = Number(new Decimal(existingRes.cost).plus(costForRes).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
                        } else {
                            catData.resources.set(armRes.id, {
                                id: armRes.id,
                                name: armRes.name,
                                service: rawService,
                                resourceGroup: armRes.resourceGroup || defaultTenantRg,
                                region: armRes.region || defaultRegion,
                                sku: armRes.sku || "Standard",
                                cost: Number(costForRes.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
                                optimizationAction: rule.recommendation,
                                optimizationKey: rule.remediationActionKey,
                                tags: {},
                            });
                        }
                    }
                } else {
                    const cleanSlug = rawService.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
                    const resRg = defaultTenantRg;
                    const resName = `${cleanSlug}-${resRg.replace(/^rg-/, "") || "primary"}`;
                    const resId = `/subscriptions/sub-primary/resourceGroups/${resRg}/providers/Microsoft.Custom/${cleanSlug}/${resName}`;
                    const rule = getCategoryRemediationRule(category, cost.toNumber(), rawService);

                    const existingRes = catData.resources.get(resId);
                    if (existingRes) {
                        existingRes.cost = Number(new Decimal(existingRes.cost).plus(cost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
                    } else {
                        catData.resources.set(resId, {
                            id: resId,
                            name: resName,
                            service: rawService,
                            resourceGroup: resRg,
                            region: defaultRegion,
                            sku: "Standard",
                            cost: Number(cost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
                            optimizationAction: rule.recommendation,
                            optimizationKey: rule.remediationActionKey,
                            tags: {},
                        });
                    }
                }

                categoryMap.set(category, catData);
            }
        } else {
            throw new Error("No live entries returned, falling back to snapshots");
        }
    } catch {
        source = "snapshot-fallback";
        const conn = await pool.getConnection();
        try {
            const query = `
                SELECT 
                    COALESCE(s.cat, 'Other') AS category,
                    COALESCE(c.service_name, 'Other') AS service_name,
                    COALESCE(c.resource_id, '') AS resource_id,
                    COALESCE(NULLIF(c.resource_group, ''), '') AS resource_group,
                    COALESCE(NULLIF(c.region, ''), '') AS region,
                    COALESCE(NULLIF(c.sku, ''), '') AS sku,
                    COALESCE(SUM(COALESCE(c.EffectiveCost, c.cost_usd, 0)), 0) AS cost
                FROM CostCategorySnapshots c
                LEFT JOIN (
                    SELECT resource_type, MAX(service_category) AS cat
                    FROM OpenDataServices GROUP BY resource_type
                ) s ON s.resource_type = c.resource_type
                WHERE c.tenant_id = ?
                  AND c.date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
                GROUP BY category, service_name, resource_id, resource_group, region, sku
            `;
            const [rows] = await conn.execute<any[]>(query, [tenantId]);
            for (const row of rows || []) {
                const cost = new Decimal(row.cost || 0);
                if (cost.lte(0)) continue;

                totalCostDecimal = totalCostDecimal.plus(cost);
                const category = row.category || mapServiceToCategory(row.service_name);
                const rawService = row.service_name || "Other";

                const catData = categoryMap.get(category) || {
                    cost: new Decimal(0),
                    billedCost: new Decimal(0),
                    services: new Map(),
                    resources: new Map(),
                };

                catData.cost = catData.cost.plus(cost);

                // Resolver Resource Group real
                let rowRg = row.resource_group;
                if (!rowRg || rowRg === "*" || rowRg === "default-rg" || rowRg === "null") {
                    rowRg = defaultTenantRg;
                }

                // Resolver Región real
                let rowRegion = row.region;
                if (!rowRegion || rowRegion === "global" || rowRegion === "null") {
                    rowRegion = defaultRegion;
                }

                // Resolver SKU real
                const rowSku = row.sku || "Standard";

                const svc = catData.services.get(rawService) || { cost: new Decimal(0), count: 0, sku: rowSku };
                svc.cost = svc.cost.plus(cost);
                svc.count += 1;
                catData.services.set(rawService, svc);

                // Resolver nombre de recurso real
                let resId = row.resource_id;
                let resName = "";
                if (resId && resId.length > 5 && !resId.startsWith("res-")) {
                    resName = resId.split("/").pop() || rawService;
                } else {
                    const cleanSlug = rawService.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
                    resName = `${cleanSlug}-${rowRg.replace(/^rg-/, "") || "primary"}`;
                    resId = `/subscriptions/sub-primary/resourceGroups/${rowRg}/providers/Microsoft.Custom/${cleanSlug}/${resName}`;
                }

                const rule = getCategoryRemediationRule(category, cost.toNumber(), rawService);

                catData.resources.set(resId, {
                    id: resId,
                    name: resName,
                    service: rawService,
                    resourceGroup: rowRg,
                    region: rowRegion,
                    sku: rowSku,
                    cost: Number(cost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
                    optimizationAction: rule.recommendation,
                    optimizationKey: rule.remediationActionKey,
                });

                categoryMap.set(category, catData);
            }
        } finally {
            conn.release();
        }
    }

    // 2. Histórico temporal de 6 meses desde CostCategorySnapshots
    const historical6Months: CategoryHistoricalPoint[] = [];
    const prevMonthCategoryCostMap = new Map<string, Decimal>();
    let prevMonthTotalCostDecimal = new Decimal(0);

    const historyConn = await pool.getConnection();
    try {
        const historyQuery = `
            SELECT 
                DATE_FORMAT(c.date, '%Y-%m') AS month_label,
                COALESCE(s.cat, 'Other') AS category,
                COALESCE(SUM(COALESCE(c.EffectiveCost, c.cost_usd, 0)), 0) AS cost
            FROM CostCategorySnapshots c
            LEFT JOIN (
                SELECT resource_type, MAX(service_category) AS cat
                FROM OpenDataServices GROUP BY resource_type
            ) s ON s.resource_type = c.resource_type
            WHERE c.tenant_id = ?
              AND c.date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
            GROUP BY month_label, category
            ORDER BY month_label ASC
        `;
        const [hRows] = await historyConn.execute<any[]>(historyQuery, [tenantId]);
        const monthGroup = new Map<string, Record<string, number>>();

        for (const row of hRows || []) {
            const m = row.month_label;
            const cat = row.category || "Other";
            const c = Number(new Decimal(row.cost || 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());

            const existing = monthGroup.get(m) || {};
            existing[cat] = (existing[cat] || 0) + c;
            monthGroup.set(m, existing);

            // Previous month capture
            const lastMonthKey = new Date(year, month - 1, 1).toISOString().slice(0, 7);
            if (m === lastMonthKey) {
                const decCost = new Decimal(c);
                prevMonthTotalCostDecimal = prevMonthTotalCostDecimal.plus(decCost);
                prevMonthCategoryCostMap.set(cat, (prevMonthCategoryCostMap.get(cat) || new Decimal(0)).plus(decCost));
            }
        }

        for (const [m, values] of monthGroup.entries()) {
            historical6Months.push({
                month: m,
                ...values,
            });
        }
    } catch {
        console.warn("[categoryConsumptionService] Historical query fallback");
    } finally {
        historyConn.release();
    }

    const total = Number(totalCostDecimal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
    const dailyBurnRate = total > 0 ? Number(totalCostDecimal.dividedBy(daysElapsed).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()) : 0;
    const projectedTotal = total > 0 ? Number(totalCostDecimal.dividedBy(daysElapsed).times(daysInMonth).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()) : 0;

    const overallMomVariation = prevMonthTotalCostDecimal.gt(0)
        ? Number(totalCostDecimal.minus(prevMonthTotalCostDecimal).dividedBy(prevMonthTotalCostDecimal).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toString())
        : 0;

    const categories: FinOpsCategoryDetail[] = [];
    const optimizationOpportunities: CategoryOptimizationOpportunity[] = [];

    for (const [categoryName, data] of categoryMap.entries()) {
        const catCostNum = Number(data.cost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
        const pct = total > 0 ? Number(data.cost.dividedBy(totalCostDecimal).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toString()) : 0;
        const catBurn = Number(data.cost.dividedBy(daysElapsed).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
        const catProj = Number(data.cost.dividedBy(daysElapsed).times(daysInMonth).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());

        // Real MoM per category
        const prevCatCost = prevMonthCategoryCostMap.get(categoryName);
        let catMom = 0;
        if (prevCatCost && prevCatCost.gt(0)) {
            catMom = Number(data.cost.minus(prevCatCost).dividedBy(prevCatCost).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toString());
        }

        const hasSpike = catMom > 15 && catCostNum > 10;

        // Sub-services list
        const servicesList: CategoryServiceBreakdown[] = Array.from(data.services.entries())
            .map(([name, svc]) => {
                const sCost = Number(svc.cost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
                const sPct = catCostNum > 0 ? Number(svc.cost.dividedBy(data.cost).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toString()) : 0;
                return {
                    name,
                    cost: sCost,
                    count: svc.count,
                    sku: svc.sku,
                    percentageOfCategory: sPct,
                };
            })
            .sort((a, b) => b.cost - a.cost);

        const resourcesList = Array.from(data.resources.values()).sort((a, b) => b.cost - a.cost);
        const topService = servicesList[0]?.name;
        const rule = getCategoryRemediationRule(categoryName, catCostNum, topService);

        // Budget calculation (baseline target based on share or projection)
        const budgetTarget = Math.max(50, Math.round(catCostNum * 0.9));
        const spentPct = budgetTarget > 0 ? Math.round((catCostNum / budgetTarget) * 100) : 0;

        // Commitment Mix calculation
        const commitmentPct = categoryName === "Compute" || categoryName === "Databases" ? 35 : 0;
        const onDemandPct = 100 - commitmentPct;

        if (rule.potentialSavings > 0) {
            optimizationOpportunities.push({
                category: categoryName,
                title: rule.remediationActionLabel,
                description: rule.recommendation,
                potentialSavings: rule.potentialSavings,
                actionKey: rule.remediationActionKey,
                actionLabel: rule.remediationActionLabel,
                impactLevel: rule.potentialSavings > 30 ? "high" : "medium",
            });
        }

        categories.push({
            category: categoryName,
            totalCost: catCostNum,
            percentage: pct,
            dailyBurnRate: catBurn,
            projectedCost: catProj,
            momVariation: catMom,
            hasSpike,
            services: servicesList,
            budget: {
                monthlyBudget: budgetTarget,
                spentPercentage: spentPct,
                isOverBudget: spentPct > 100,
                remainingBudget: Math.max(0, budgetTarget - catCostNum),
            },
            commitmentMix: {
                commitmentPct,
                onDemandPct,
                commitmentAmount: Number(new Decimal(catCostNum).times(commitmentPct / 100).toFixed(2)),
                onDemandAmount: Number(new Decimal(catCostNum).times(onDemandPct / 100).toFixed(2)),
            },
            recommendation: rule.recommendation,
            remediationActionLabel: rule.remediationActionLabel,
            remediationActionKey: rule.remediationActionKey,
            potentialSavings: rule.potentialSavings,
            resources: resourcesList,
            iconName: getCategoryIconName(categoryName),
            color: getCategoryColor(categoryName),
        });
    }

    categories.sort((a, b) => b.totalCost - a.totalCost);

    return {
        success: true,
        mock: false,
        empty: categories.length === 0,
        total,
        projectedTotal,
        dailyBurnRate,
        topCategory: categories[0]?.category || null,
        topCategoryPercentage: categories[0]?.percentage || 0,
        overallMomVariation,
        categories,
        historical6Months,
        optimizationOpportunities,
        diagnostics: {
            requestedDays: days,
            effectiveDays: days,
            rowsFound: categories.length,
            source,
        },
    };
}

/**
 * Retorna datos calibrados y de alta fidelidad para el tenant de demostración/mock
 */
export function getMockCategoryOverview(tenantId: string): CategoryOverview {
    const now = new Date();
    const daysElapsed = Math.max(1, now.getDate());
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Valores calibrados correspondientes a la distribución de la demostración
    const mockCategories: FinOpsCategoryDetail[] = [
        {
            category: "Databases",
            totalCost: 184.51,
            percentage: 49.58,
            dailyBurnRate: 5.95,
            projectedCost: 375.0,
            momVariation: 12.4,
            hasSpike: false,
            services: [
                { name: "Redis Cache", cost: 86.92, count: 1, sku: "Standard C1", percentageOfCategory: 47.11 },
                { name: "Azure Cosmos DB", cost: 59.53, count: 1, sku: "Provisioned Throughput (RU/s)", percentageOfCategory: 32.26 },
                { name: "Azure Database for MySQL", cost: 38.06, count: 1, sku: "General Purpose GP_Gen5_2", percentageOfCategory: 20.63 },
            ],
            budget: {
                monthlyBudget: 150.0,
                spentPercentage: 123,
                isOverBudget: true,
                remainingBudget: 0,
            },
            commitmentMix: {
                commitmentPct: 40,
                onDemandPct: 60,
                commitmentAmount: 73.80,
                onDemandAmount: 110.71,
            },
            recommendation: "Concentra el 50% del gasto (Redis + MySQL). Sugerir Reserved Capacity 1 año en bases relacionales y evaluar downgrade a Basic en Redis no productivo.",
            remediationActionLabel: "Ver Recomendaciones DB",
            remediationActionKey: "db_reservations_and_scale",
            potentialSavings: 65.0,
            iconName: "database",
            color: "#F59E0B",
            resources: [
                {
                    id: "/subscriptions/demo-sub/resourceGroups/rg-data/providers/Microsoft.Cache/Redis/redis-prod-primary",
                    name: "redis-prod-primary",
                    service: "Redis Cache",
                    resourceGroup: "rg-data",
                    region: "eastus2",
                    sku: "Standard C1 (1 GB)",
                    cost: 86.92,
                    optimizationAction: "Evaluar SKU Basic para ambientes no críticos",
                    optimizationKey: "redis_downgrade",
                },
                {
                    id: "/subscriptions/demo-sub/resourceGroups/rg-data/providers/Microsoft.DocumentDB/databaseAccounts/cosmos-finops-core",
                    name: "cosmos-finops-core",
                    service: "Azure Cosmos DB",
                    resourceGroup: "rg-data",
                    region: "eastus2",
                    sku: "Autoscale (1000 - 4000 RU/s)",
                    cost: 59.53,
                    optimizationAction: "Ajustar límite de autoscale de 4000 a 2000 RU/s",
                    optimizationKey: "cosmos_autoscale_tune",
                },
                {
                    id: "/subscriptions/demo-sub/resourceGroups/rg-data/providers/Microsoft.DBforMySQL/flexibleServers/mysql-finops-prod",
                    name: "mysql-finops-prod",
                    service: "Azure Database for MySQL",
                    resourceGroup: "rg-data",
                    region: "eastus2",
                    sku: "General Purpose (2 vCores / 8 GB)",
                    cost: 38.06,
                    optimizationAction: "Adquirir Reserved Capacity 1 año (~38% ahorro)",
                    optimizationKey: "mysql_reserved_capacity",
                },
            ],
        },
        {
            category: "Compute",
            totalCost: 104.24,
            percentage: 28.01,
            dailyBurnRate: 3.36,
            projectedCost: 212.0,
            momVariation: -4.2,
            hasSpike: false,
            services: [
                { name: "Azure Container Apps", cost: 72.77, count: 2, sku: "Dedicated Workload Profile D4", percentageOfCategory: 69.81 },
                { name: "Virtual Machines", cost: 31.47, count: 1, sku: "Standard_D2s_v5", percentageOfCategory: 30.19 },
            ],
            budget: {
                monthlyBudget: 120.0,
                spentPercentage: 87,
                isOverBudget: false,
                remainingBudget: 15.76,
            },
            commitmentMix: {
                commitmentPct: 30,
                onDemandPct: 70,
                commitmentAmount: 31.27,
                onDemandAmount: 72.97,
            },
            recommendation: "Cómputo repartido entre ACA y VMs. Aplicar scale-to-zero en réplicas de Container Apps y rightsizing a serie B en VMs de staging.",
            remediationActionLabel: "Rightsizing de VMs/Containers",
            remediationActionKey: "compute_rightsizing_scale_zero",
            potentialSavings: 45.0,
            iconName: "cpu",
            color: "#0054A6",
            resources: [
                {
                    id: "/subscriptions/demo-sub/resourceGroups/rg-compute/providers/Microsoft.App/containerApps/aca-api-gateway",
                    name: "aca-api-gateway",
                    service: "Azure Container Apps",
                    resourceGroup: "rg-compute",
                    region: "eastus2",
                    sku: "0.5 vCPU / 1.0 GiB",
                    cost: 44.50,
                    optimizationAction: "Configurar min-replicas = 0 para suspender fuera de horario",
                    optimizationKey: "aca_scale_zero",
                },
                {
                    id: "/subscriptions/demo-sub/resourceGroups/rg-compute/providers/Microsoft.App/containerApps/aca-worker-jobs",
                    name: "aca-worker-jobs",
                    service: "Azure Container Apps",
                    resourceGroup: "rg-compute",
                    region: "eastus2",
                    sku: "0.25 vCPU / 0.5 GiB",
                    cost: 28.27,
                    optimizationAction: "Habilitar KEDA event-driven scaling",
                    optimizationKey: "aca_keda_scale",
                },
                {
                    id: "/subscriptions/demo-sub/resourceGroups/rg-compute/providers/Microsoft.Compute/virtualMachines/vm-app-staging",
                    name: "vm-app-staging",
                    service: "Virtual Machines",
                    resourceGroup: "rg-compute",
                    region: "eastus2",
                    sku: "Standard_D2s_v5",
                    cost: 31.47,
                    optimizationAction: "Migrar a Standard_B2s (Ahorro ~45%)",
                    optimizationKey: "vm_bseries_rightsizing",
                },
            ],
        },
        {
            category: "Networking",
            totalCost: 70.59,
            percentage: 18.97,
            dailyBurnRate: 2.28,
            projectedCost: 143.0,
            momVariation: 24.0,
            hasSpike: true,
            services: [
                { name: "Virtual Network & NAT Gateway", cost: 38.30, count: 1, sku: "Standard NAT", percentageOfCategory: 54.26 },
                { name: "Azure Load Balancer", cost: 32.29, count: 1, sku: "Standard Load Balancer", percentageOfCategory: 45.74 },
            ],
            budget: {
                monthlyBudget: 50.0,
                spentPercentage: 141,
                isOverBudget: true,
                remainingBudget: 0,
            },
            commitmentMix: {
                commitmentPct: 0,
                onDemandPct: 100,
                commitmentAmount: 0,
                onDemandAmount: 70.59,
            },
            recommendation: "Gasto de red elevado (+24% MoM) para el volumen de cómputo. Auditar Egress internacional y Load Balancers sin backend activo.",
            remediationActionLabel: "Auditar Flujos y NAT/IPs",
            remediationActionKey: "networking_egress_and_nat_audit",
            potentialSavings: 30.0,
            iconName: "network",
            color: "#8B5CF6",
            resources: [
                {
                    id: "/subscriptions/demo-sub/resourceGroups/rg-network/providers/Microsoft.Network/natGateways/nat-gw-prod",
                    name: "nat-gw-prod",
                    service: "Virtual Network & NAT Gateway",
                    resourceGroup: "rg-network",
                    region: "eastus2",
                    sku: "Standard NAT Gateway",
                    cost: 38.30,
                    optimizationAction: "Revisar throughput y timeout de conexiones TCP",
                    optimizationKey: "nat_gw_tune",
                },
                {
                    id: "/subscriptions/demo-sub/resourceGroups/rg-network/providers/Microsoft.Network/loadBalancers/lb-external-ingress",
                    name: "lb-external-ingress",
                    service: "Azure Load Balancer",
                    resourceGroup: "rg-network",
                    region: "eastus2",
                    sku: "Standard Public LB",
                    cost: 32.29,
                    optimizationAction: "Consolidar reglas NAT en un único Load Balancer",
                    optimizationKey: "lb_consolidate",
                },
            ],
        },
        {
            category: "AI and Machine Learning",
            totalCost: 37.78,
            percentage: 10.15,
            dailyBurnRate: 1.22,
            projectedCost: 77.0,
            momVariation: 48.3,
            hasSpike: true,
            services: [
                { name: "Foundry Models & AI Endpoints", cost: 37.78, count: 1, sku: "Pay-as-you-go Tokens", percentageOfCategory: 100 },
            ],
            budget: {
                monthlyBudget: 25.0,
                spentPercentage: 151,
                isOverBudget: true,
                remainingBudget: 0,
            },
            commitmentMix: {
                commitmentPct: 0,
                onDemandPct: 100,
                commitmentAmount: 0,
                onDemandAmount: 37.78,
            },
            recommendation: "Pico de inferencia en últimas 48h (+48.3% MoM). Activar límite de cuota diaria de tokens por endpoint de IA.",
            remediationActionLabel: "Configurar Cuotas de Inferencia",
            remediationActionKey: "ai_token_quota_limits",
            potentialSavings: 25.0,
            iconName: "brain",
            color: "#EC4899",
            resources: [
                {
                    id: "/subscriptions/demo-sub/resourceGroups/rg-ai/providers/Microsoft.CognitiveServices/accounts/foundry-gpt4-prod",
                    name: "foundry-gpt4-prod",
                    service: "Foundry Models & AI Endpoints",
                    resourceGroup: "rg-ai",
                    region: "eastus2",
                    sku: "Standard S0 (Inference)",
                    cost: 37.78,
                    optimizationAction: "Configurar cuota diaria y habilitar caché semántico",
                    optimizationKey: "foundry_quota_limit",
                },
            ],
        },
        {
            category: "Storage",
            totalCost: 45.12,
            percentage: 12.12,
            dailyBurnRate: 1.45,
            projectedCost: 91.5,
            momVariation: 1.8,
            hasSpike: false,
            services: [
                { name: "Azure Blob Storage", cost: 45.12, count: 2, sku: "Standard LRS Hot", percentageOfCategory: 100 },
            ],
            budget: {
                monthlyBudget: 60.0,
                spentPercentage: 75,
                isOverBudget: false,
                remainingBudget: 14.88,
            },
            commitmentMix: {
                commitmentPct: 0,
                onDemandPct: 100,
                commitmentAmount: 0,
                onDemandAmount: 45.12,
            },
            recommendation: "Activar política de ciclo de vida para mover blobs antiguos a capa Cool y Archive.",
            remediationActionLabel: "Activar Lifecycle Management",
            remediationActionKey: "storage_lifecycle_cool_archive",
            potentialSavings: 18.0,
            iconName: "hard-drive",
            color: "#10B981",
            resources: [
                {
                    id: "/subscriptions/demo-sub/resourceGroups/rg-storage/providers/Microsoft.Storage/storageAccounts/stfinopsassets",
                    name: "stfinopsassets",
                    service: "Azure Blob Storage",
                    resourceGroup: "rg-storage",
                    region: "eastus2",
                    sku: "Standard_LRS (Hot)",
                    cost: 29.80,
                    optimizationAction: "Mover objetos > 30 días a capa Cool",
                    optimizationKey: "storage_lifecycle",
                },
                {
                    id: "/subscriptions/demo-sub/resourceGroups/rg-storage/providers/Microsoft.Storage/storageAccounts/stfinopsbackups",
                    name: "stfinopsbackups",
                    service: "Azure Blob Storage",
                    resourceGroup: "rg-storage",
                    region: "eastus2",
                    sku: "Standard_GRS (Hot)",
                    cost: 15.32,
                    optimizationAction: "Mover backups a capa Archive y cambiar a LRS",
                    optimizationKey: "storage_archive",
                },
            ],
        },
    ];

    // Histórico de 6 meses calibrado
    const months = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
    const historical6Months: CategoryHistoricalPoint[] = [
        { month: months[0], Databases: 145.2, Compute: 120.5, Networking: 48.0, "AI and Machine Learning": 12.0, Storage: 40.1 },
        { month: months[1], Databases: 152.0, Compute: 115.0, Networking: 51.2, "AI and Machine Learning": 18.5, Storage: 41.5 },
        { month: months[2], Databases: 160.4, Compute: 110.2, Networking: 54.0, "AI and Machine Learning": 22.0, Storage: 42.8 },
        { month: months[3], Databases: 168.9, Compute: 108.0, Networking: 56.5, "AI and Machine Learning": 25.4, Storage: 43.9 },
        { month: months[4], Databases: 172.5, Compute: 106.3, Networking: 58.0, "AI and Machine Learning": 28.0, Storage: 44.5 },
        { month: months[5], Databases: 184.51, Compute: 104.24, Networking: 70.59, "AI and Machine Learning": 37.78, Storage: 45.12 },
    ];

    const total = 442.24; // Sum of categories
    const dailyBurnRate = Number((total / daysElapsed).toFixed(2));
    const projectedTotal = Number((dailyBurnRate * daysInMonth).toFixed(2));

    const optimizationOpportunities: CategoryOptimizationOpportunity[] = [
        {
            category: "Databases",
            title: "Ver Recomendaciones DB",
            description: "Ahorro potencial en bases de datos con bajo uso.",
            actionLabel: "Ver Recomendaciones DB",
            actionKey: "db_reservations_and_scale",
            potentialSavings: 65.0,
            impactLevel: "high",
        },
        {
            category: "Compute",
            title: "Rightsizing de VMs/Containers",
            description: "Optimizar instancias sobredimensionadas.",
            actionLabel: "Rightsizing de VMs/Containers",
            actionKey: "compute_rightsizing_scale_zero",
            potentialSavings: 45.0,
            impactLevel: "high",
        },
        {
            category: "Networking",
            title: "Auditar Flujos y NAT/IPs",
            description: "Revisar costos fijos de red no utilizados.",
            actionLabel: "Auditar Flujos y NAT/IPs",
            actionKey: "networking_egress_and_nat_audit",
            potentialSavings: 30.0,
            impactLevel: "medium",
        },
    ];

    return {
        success: true,
        mock: true,
        empty: false,
        total,
        projectedTotal,
        dailyBurnRate,
        topCategory: "Databases",
        topCategoryPercentage: 49.58,
        overallMomVariation: 8.4,
        categories: mockCategories,
        historical6Months,
        optimizationOpportunities,
        diagnostics: {
            requestedDays: 30,
            effectiveDays: 30,
            rowsFound: mockCategories.length,
            source: "mock-calibrated-focus",
        },
    };
}
