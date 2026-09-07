/**
 * GET /api/intelligence/compute-cost-per-core — Unit Economics y Rate
 * Optimization de cómputo (Enterprise): $/vCore, $/GiB RAM, mix de compra
 * (PAYG/Spot/AHUB), arquitectura (Intel/AMD/ARM), generación de hardware y
 * un motor de recomendaciones de tarifa (Savings Plan, migración ARM/AMD,
 * AHUB, arbitraje de región).
 *
 * RBAC app: requireTenantAccess (tenant-scoped).
 * Roles Azure:
 *   - NINGUNO adicional para el costo histórico (CostMeterSnapshots/CostSnapshots,
 *     poblados por el cron /api/cron/sync con 'Cost Management Reader').
 *   - 'Reader' (Resource Graph, ya baseline del onboarding) para enriquecer con
 *     inventario real de VMs (RAM, arquitectura, AHUB, Spot). Best-effort: si
 *     falla o no hay permisos, el panel degrada a los campos legados sin cortar.
 *   - 'Monitoring Reader' (ya baseline) para una muestra de CPU real (Azure
 *     Monitor) sobre las VMs de mayor costo. Best-effort, puede quedar null.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import {
    vmSizeToCores,
    vmSizeToMemoryGB,
    detectVmArchitecture,
    extractVmGeneration,
} from "@/modules/collectors/azure/aksCostService";
import { getRegionFriendlyName } from "@/lib/openData";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { listResourcesByTypes } from "@/app/api/intelligence/databases/diagnosticsShared";
import { getAzureResourceMetricsSummary } from "@/lib/computeMetricsShared";
import { getSubscriptionNameMap, resolveSubscriptionName, isUnattributedSubscriptionId } from "@/lib/azureSubscriptionNames";
import type {
    ComputeEfficiencySummary,
    ArchitectureMixItem,
    GenerationMixItem,
    SkuEfficiencyDetail,
    RegionEfficiencyDetail,
    SubscriptionEfficiencyDetail,
    RateOptimizationAction,
    PurchaseMixSummary,
} from "@/lib/computeEfficiencyTypes";
import { errorMessage } from '@/lib/apiErrors';

/**
 * Parses an Azure billing MeterName (e.g. "D4s v5", "E8s v5 Spot", "B2s")
 * into a vCore count using vmSizeToCores.
 */
function meterNameToCores(meterName: string | null | undefined): number {
    if (!meterName) return 0;
    // Strip usage modifiers that don't affect size
    const clean = meterName.replace(/\s+(Spot|On-Demand|Promo|Low Priority|Preemptible)$/i, '').trim();
    // "D4s v5" → "Standard_D4s_v5", "E8s v5" → "Standard_E8s_v5", "B2s" → "Standard_B2s"
    const sku = 'Standard_' + clean.replace(/\s+v(\d+)$/, '_v$1').replace(/\s+/g, '_');
    return vmSizeToCores(sku);
}

/** Normaliza un SKU (billing MeterName o vmSize de Resource Graph) a una clave comparable. */
function normalizeSkuKey(sku: string | null | undefined): string {
    return String(sku || '')
        .replace(/^Standard_/i, '')
        .replace(/[\s_]+/g, '')
        .toLowerCase();
}

/** ARM equivalent family suggestion for a given Intel SKU family letter. */
function armEquivalentSku(sku: string): string {
    const norm = sku.replace(/^Standard_/i, '');
    const m = norm.match(/^([A-Za-z]+?)(\d+)([a-zA-Z]*)(_v\d+)?$/);
    if (!m) return 'Dpsv5';
    const [, family, size, , gen] = m;
    const armFamily = family.toLowerCase().startsWith('e') ? 'Eps' : 'Dps';
    return `${armFamily}${size}${gen || '_v5'}`;
}

interface VmInventoryItem {
    id: string;
    vmSize: string;
    cores: number;
    ramGiB: number;
    architecture: ReturnType<typeof detectVmArchitecture>;
    generation: string;
    isSpot: boolean;
    ahubActive: boolean;
    osType: 'Linux' | 'Windows' | 'Unknown';
    location: string;
}

async function fetchVmInventory(tenantId: string): Promise<VmInventoryItem[]> {
    try {
        const credential = await getAzureCredential(tenantId);
        const subscriptionIds = await getSubscriptionsForTenant(tenantId, credential as any);
        if (subscriptionIds.length === 0) return [];
        const rows = await listResourcesByTypes(
            tenantId,
            ["microsoft.compute/virtualmachines"],
            subscriptionIds,
            credential,
        );
        return rows.map((row) => {
            const properties = (row.properties || {}) as Record<string, any>;
            const vmSize: string = properties?.hardwareProfile?.vmSize || "Standard_D2s_v3";
            const licenseType: string = String(properties?.licenseType || "");
            const priority: string = String(properties?.priority || "Regular");
            const osType: string = String(properties?.storageProfile?.osDisk?.osType || "");
            return {
                id: row.id,
                vmSize,
                cores: vmSizeToCores(vmSize),
                ramGiB: vmSizeToMemoryGB(vmSize),
                architecture: detectVmArchitecture(vmSize),
                generation: extractVmGeneration(vmSize),
                isSpot: priority.toLowerCase() === "spot",
                ahubActive: licenseType.toLowerCase().startsWith("windows"),
                osType: osType.toLowerCase() === "linux" ? "Linux" : osType.toLowerCase() === "windows" ? "Windows" : "Unknown",
                location: row.location || "unknown",
            };
        });
    } catch (err) {
        console.error("[compute-cost-per-core] inventory fetch failed (degrading gracefully):", (err as Error)?.message);
        return [];
    }
}

/** Ponderado por cores, sobre una muestra acotada de las VMs más "pesadas" (evita N llamadas para tenants grandes). */
async function estimateAvgCpuUtilization(tenantId: string, inventory: VmInventoryItem[]): Promise<number | null> {
    if (inventory.length === 0) return null;
    try {
        const credential = await getAzureCredential(tenantId);
        const sample = [...inventory].sort((a, b) => b.cores - a.cores).slice(0, 15);
        const results = await Promise.all(
            sample.map((vm) => getAzureResourceMetricsSummary(credential, vm.id, ["Percentage CPU"])),
        );
        let weightedSum = 0;
        let weightTotal = 0;
        results.forEach((r, i) => {
            const avg = r["Percentage CPU"];
            if (typeof avg === "number") {
                weightedSum += avg * sample[i].cores;
                weightTotal += sample[i].cores;
            }
        });
        if (weightTotal === 0) return null;
        return Number((weightedSum / weightTotal).toFixed(1));
    } catch (err) {
        console.error("[compute-cost-per-core] CPU sampling failed (degrading gracefully):", (err as Error)?.message);
        return null;
    }
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const days = Math.max(1, Math.min(365, parseInt(searchParams.get("days") || "30", 10)));

        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
        }

        try {
            await requireTenantAccess(request, tenantId);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('compute-efficiency', tenantId));
        }

        try {
            // Fuente primaria: filas a nivel de meter (CostMeterSnapshots) — traen
            // MeterName/MeterSubCategory reales para derivar SKU y cores. Fallback
            // a CostSnapshots (chargeback) para datos anteriores a esa tabla.
            let [rows]: any = await pool.query(
                `SELECT
                    MeterSubCategory,
                    MeterName,
                    resource_location AS region,
                    subscription_id AS subscriptionId,
                    cost_usd AS effectiveCost,
                    cost_usd AS billedCost,
                    DATE_FORMAT(date, '%Y-%m') AS month
                 FROM CostMeterSnapshots
                 WHERE tenant_id = ?
                   AND (
                        service_name LIKE '%Virtual Machine%'
                     OR service_name LIKE '%Compute%'
                     OR MeterCategory LIKE '%Compute%'
                     OR MeterSubCategory LIKE '%Series%'
                   )
                   AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
                [tenantId, days]
            );
            if (!Array.isArray(rows) || rows.length === 0) {
                // Fallback legacy: CostSnapshots no tiene región; resource_group NO
                // es una región, así que no lo usamos como tal (quedaría 'unknown').
                [rows] = await pool.query(
                    `SELECT
                        MeterSubCategory,
                        MeterName,
                        '' AS region,
                        COALESCE(subscription_id, 'default') AS subscriptionId,
                        COALESCE(EffectiveCost, BilledCost, cost_usd, 0) AS effectiveCost,
                        COALESCE(BilledCost, cost_usd, 0)                AS billedCost,
                        DATE_FORMAT(date, '%Y-%m')                       AS month
                     FROM CostSnapshots
                     WHERE tenant_id = ?
                       AND (
                            service_name LIKE '%Virtual Machine%'
                         OR service_name LIKE '%Compute%'
                         OR MeterCategory LIKE '%Compute%'
                         OR MeterSubCategory LIKE '%Series%'
                       )
                       AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
                    [tenantId, days]
                );
            }

            let totalEffectiveCost = 0;
            let totalBilledCost    = 0;
            let totalCoreMonths    = 0;

            const bySkuMap:    Record<string, { cores: number; cost: number }> = {};
            const byRegionMap: Record<string, { cores: number; cost: number }> = {};
            const byMonthMap:  Record<string, { cost: number; cores: number }> = {};
            const bySubMap:    Record<string, { cores: number; effectiveCost: number; billedCost: number }> = {};

            for (const row of rows as any[]) {
                const effectiveCost = parseFloat(row.effectiveCost) || 0;
                const billedCost    = parseFloat(row.billedCost)    || 0;
                const cores         = meterNameToCores(row.MeterName);
                const sku           = (row.MeterSubCategory || row.MeterName || 'Unknown').trim();
                const region        = (row.region || 'unknown').trim();
                const month: string = row.month             || '';
                const subId: string = (row.subscriptionId || 'default').trim();

                totalEffectiveCost += effectiveCost;
                totalBilledCost    += billedCost;
                totalCoreMonths    += cores;

                if (sku) {
                    if (!bySkuMap[sku]) bySkuMap[sku] = { cores: 0, cost: 0 };
                    bySkuMap[sku].cores += cores;
                    bySkuMap[sku].cost  += effectiveCost;
                }
                if (region) {
                    if (!byRegionMap[region]) byRegionMap[region] = { cores: 0, cost: 0 };
                    byRegionMap[region].cores += cores;
                    byRegionMap[region].cost  += effectiveCost;
                }
                if (month) {
                    if (!byMonthMap[month]) byMonthMap[month] = { cost: 0, cores: 0 };
                    byMonthMap[month].cost  += effectiveCost;
                    byMonthMap[month].cores += cores;
                }
                if (!isUnattributedSubscriptionId(subId)) {
                    if (!bySubMap[subId]) bySubMap[subId] = { cores: 0, effectiveCost: 0, billedCost: 0 };
                    bySubMap[subId].cores         += cores;
                    bySubMap[subId].effectiveCost += effectiveCost;
                    bySubMap[subId].billedCost    += billedCost;
                }
            }

            const costPerCore = totalCoreMonths > 0
                ? parseFloat((totalEffectiveCost / totalCoreMonths).toFixed(2))
                : 0;

            // savingsFromCommitments: % reduction from billed → effective (via RIs/SPs)
            const savingsFromCommitments = totalBilledCost > 0
                ? Math.max(0, Math.round(((totalBilledCost - totalEffectiveCost) / totalBilledCost) * 100))
                : 0;

            const bySku = Object.entries(bySkuMap)
                .sort(([, a], [, b]) => b.cost - a.cost)
                .slice(0, 10)
                .map(([sku, v]) => ({
                    sku,
                    cores: v.cores,
                    cost: parseFloat(v.cost.toFixed(2)),
                    costPerCore: v.cores > 0 ? parseFloat((v.cost / v.cores).toFixed(2)) : 0,
                }));

            // Nombre canónico de región vía Open Data del FinOps Toolkit
            // (OpenDataRegions): 'us east' → 'East US'. Fallback al valor crudo
            // si el dataset aún no está sincronizado o no mapea.
            const byRegionRaw = Object.entries(byRegionMap)
                .sort(([, a], [, b]) => b.cost - a.cost)
                .slice(0, 8);
            const byRegion = await Promise.all(byRegionRaw.map(async ([region, v]) => ({
                region: (region && region !== 'unknown' ? await getRegionFriendlyName(region) : null) || region,
                cores: v.cores,
                costPerCore: v.cores > 0 ? parseFloat((v.cost / v.cores).toFixed(2)) : 0,
            })));

            const cheapestRegionCostPerCore = byRegion.length > 0
                ? Math.min(...byRegion.filter(r => r.costPerCore > 0).map(r => r.costPerCore))
                : 0;
            const regionDetail: RegionEfficiencyDetail[] = byRegion.map((r) => ({
                ...r,
                deltaVsCheapestPct: cheapestRegionCostPerCore > 0 && r.costPerCore > 0
                    ? Math.round(((r.costPerCore - cheapestRegionCostPerCore) / cheapestRegionCostPerCore) * 100)
                    : 0,
            }));

            const trend = Object.entries(byMonthMap)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([month, v]) => ({
                    month,
                    costPerCore: v.cores > 0 ? parseFloat((v.cost / v.cores).toFixed(2)) : 0,
                }));

            // --- Enriquecimiento best-effort con inventario real (Resource Graph) ---
            const inventory = await fetchVmInventory(tenantId);
            const inventoryAvailable = inventory.length > 0;

            const totalInventoryCores = inventory.reduce((s, v) => s + v.cores, 0);
            const totalRamGiB = inventory.reduce((s, v) => s + v.ramGiB, 0);
            const costPerCoreInventory = totalInventoryCores > 0
                ? parseFloat((totalEffectiveCost / totalInventoryCores).toFixed(2))
                : null;
            const costPerGiB = totalRamGiB > 0
                ? parseFloat((totalEffectiveCost / totalRamGiB).toFixed(3))
                : null;

            const avgCpuUtilization = await estimateAvgCpuUtilization(tenantId, inventory);
            const effectiveCorePriceUtilized = avgCpuUtilization && avgCpuUtilization > 0
                ? parseFloat((costPerCore / (avgCpuUtilization / 100)).toFixed(2))
                : null;

            const spotCores = inventory.filter(v => v.isSpot).reduce((s, v) => s + v.cores, 0);
            const ahubActiveCores = inventory.filter(v => v.ahubActive).reduce((s, v) => s + v.cores, 0);
            const ahubEligibleCores = inventory.filter(v => v.osType === 'Windows' && !v.ahubActive).reduce((s, v) => s + v.cores, 0);
            const paygCores = Math.max(0, totalInventoryCores - spotCores);

            const purchaseMix: PurchaseMixSummary = {
                totalCores: totalInventoryCores,
                paygCores,
                spotCores,
                ahubActiveCores,
                ahubEligibleCores,
                commitmentCoveragePct: savingsFromCommitments,
                inventoryAvailable,
            };

            // Mapa de costo por SKU normalizado (para cruzar inventario ↔ costo)
            const costBySkuNormalized: Record<string, { cores: number; cost: number }> = {};
            for (const [sku, v] of Object.entries(bySkuMap)) {
                costBySkuNormalized[normalizeSkuKey(sku)] = v;
            }

            const archMap: Record<string, { cores: number; cost: number }> = {};
            const genMap: Record<string, { cores: number; cost: number }> = {};
            const skuInventoryMap: Record<string, { item: VmInventoryItem; count: number; cost: number }> = {};
            for (const vm of inventory) {
                const key = normalizeSkuKey(vm.vmSize);
                const matched = costBySkuNormalized[key];
                const shareOfCost = matched && matched.cores > 0 ? (vm.cores / matched.cores) * matched.cost : 0;

                if (!archMap[vm.architecture]) archMap[vm.architecture] = { cores: 0, cost: 0 };
                archMap[vm.architecture].cores += vm.cores;
                archMap[vm.architecture].cost += shareOfCost;

                if (!genMap[vm.generation]) genMap[vm.generation] = { cores: 0, cost: 0 };
                genMap[vm.generation].cores += vm.cores;
                genMap[vm.generation].cost += shareOfCost;

                if (!skuInventoryMap[vm.vmSize]) skuInventoryMap[vm.vmSize] = { item: vm, count: 0, cost: 0 };
                skuInventoryMap[vm.vmSize].count += 1;
                skuInventoryMap[vm.vmSize].cost += shareOfCost;
            }

            const architectureMix: ArchitectureMixItem[] = Object.entries(archMap).map(([architecture, v]) => ({
                architecture: architecture as ArchitectureMixItem['architecture'],
                cores: v.cores,
                cost: parseFloat(v.cost.toFixed(2)),
                costPerCore: v.cores > 0 ? parseFloat((v.cost / v.cores).toFixed(2)) : 0,
            }));

            const generationMix: GenerationMixItem[] = Object.entries(genMap)
                .sort(([a], [b]) => b.localeCompare(a))
                .map(([generation, v]) => ({
                    generation,
                    cores: v.cores,
                    costPerCore: v.cores > 0 ? parseFloat((v.cost / v.cores).toFixed(2)) : 0,
                }));

            const skuDetail: SkuEfficiencyDetail[] = Object.entries(skuInventoryMap)
                .sort(([, a], [, b]) => b.cost - a.cost)
                .slice(0, 15)
                .map(([sku, v]) => {
                    // Las columnas muestran la ficha del SKU (una instancia); los ratios
                    // $/core y $/GiB dividen por el agregado de la flota de ese SKU.
                    const skuFleetCores = v.item.cores * v.count;
                    const skuFleetRamGiB = v.item.ramGiB * v.count;
                    const isIntelLinux = v.item.architecture === 'Intel' && v.item.osType === 'Linux';
                    const isWindowsNoAhub = v.item.osType === 'Windows' && !v.item.ahubActive;
                    return {
                        sku,
                        architecture: v.item.architecture,
                        generation: v.item.generation,
                        instances: v.count,
                        cores: v.item.cores,
                        ramGiB: v.item.ramGiB || null,
                        purchaseType: v.item.isSpot ? 'Spot' : 'PAYG',
                        ahubActive: v.item.ahubActive,
                        cost: parseFloat(v.cost.toFixed(2)),
                        costPerCore: skuFleetCores > 0 ? parseFloat((v.cost / skuFleetCores).toFixed(2)) : 0,
                        costPerGiB: skuFleetRamGiB > 0 ? parseFloat((v.cost / skuFleetRamGiB).toFixed(3)) : null,
                        suggestedAction: isIntelLinux
                            ? { key: 'arm' as const, sku: armEquivalentSku(sku) }
                            : isWindowsNoAhub
                            ? { key: 'ahub' as const }
                            : null,
                    };
                });

            // --- Motor de recomendaciones de tarifa (Rate Optimization Engine) ---
            const rateOptimizationActions: RateOptimizationAction[] = [];

            if (savingsFromCommitments < 20 && totalInventoryCores > 0) {
                const projectedCostPerCore = parseFloat((costPerCore * 0.58).toFixed(2));
                rateOptimizationActions.push({
                    id: 'savings_plan',
                    type: 'savings_plan',
                    params: { cores: paygCores, from: costPerCore.toFixed(2), to: projectedCostPerCore },
                    estimated: true,
                    potentialSavingsPct: 42,
                    potentialMonthlySavings: parseFloat((totalEffectiveCost * 0.42).toFixed(2)),
                    ctaHref: '/intelligence/commitment-simulator',
                });
            }

            const armEligibleCores = inventory
                .filter(v => v.architecture === 'Intel' && v.osType === 'Linux')
                .reduce((s, v) => s + v.cores, 0);
            if (armEligibleCores > 0) {
                rateOptimizationActions.push({
                    id: 'arm_migration',
                    type: 'arm_migration',
                    params: { cores: armEligibleCores },
                    estimated: true,
                    potentialSavingsPct: 20,
                    potentialMonthlySavings: parseFloat(((archMap['Intel']?.cost || 0) * 0.20).toFixed(2)),
                    ctaHref: '/intelligence/computo/avm',
                });
            }

            if (ahubEligibleCores > 0) {
                rateOptimizationActions.push({
                    id: 'ahub',
                    type: 'ahub',
                    params: { cores: ahubEligibleCores },
                    estimated: true,
                    potentialSavingsPct: 40,
                    potentialMonthlySavings: parseFloat(((ahubEligibleCores * costPerCore) * 0.40).toFixed(2)),
                    ctaHref: '/intelligence/computo/avm',
                });
            }

            const sortedRegions = [...regionDetail].filter(r => r.cores >= 1).sort((a, b) => b.deltaVsCheapestPct - a.deltaVsCheapestPct);
            const worstRegion = sortedRegions[0];
            if (worstRegion && worstRegion.deltaVsCheapestPct >= 8) {
                rateOptimizationActions.push({
                    id: 'region_arbitrage',
                    type: 'region_arbitrage',
                    params: { region: worstRegion.region, pct: worstRegion.deltaVsCheapestPct },
                    estimated: true,
                    potentialSavingsPct: worstRegion.deltaVsCheapestPct,
                    potentialMonthlySavings: parseFloat((worstRegion.cores * (worstRegion.costPerCore - cheapestRegionCostPerCore)).toFixed(2)),
                    ctaHref: '/intelligence/compute-efficiency',
                });
            }

            // --- Desglose por suscripción (best-effort name resolution) ---
            let subscriptionNameMap = new Map<string, string>();
            try {
                const credential = await getAzureCredential(tenantId);
                subscriptionNameMap = await getSubscriptionNameMap(tenantId, credential);
            } catch { /* degradación silenciosa: se mostrará el GUID */ }

            const subscriptionDetail: SubscriptionEfficiencyDetail[] = Object.entries(bySubMap)
                .sort(([, a], [, b]) => b.effectiveCost - a.effectiveCost)
                .slice(0, 10)
                .map(([subId, v]) => {
                    const subSavings = v.billedCost > 0
                        ? Math.max(0, Math.round(((v.billedCost - v.effectiveCost) / v.billedCost) * 100))
                        : 0;
                    return {
                        subscriptionId: subId,
                        subscriptionName: resolveSubscriptionName(subId, subscriptionNameMap),
                        cores: v.cores,
                        totalCost: parseFloat(v.effectiveCost.toFixed(2)),
                        costPerCore: v.cores > 0 ? parseFloat((v.effectiveCost / v.cores).toFixed(2)) : 0,
                        commitmentCoveragePct: subSavings,
                    };
                });

            const payload: ComputeEfficiencySummary = {
                success: true,
                mock: false,
                totalCores: totalCoreMonths,
                totalCost: parseFloat(totalEffectiveCost.toFixed(2)),
                effectiveCost: parseFloat(totalEffectiveCost.toFixed(2)),
                costPerCore,
                costPerCoreNoCommitments: parseFloat((totalBilledCost > 0 ? totalBilledCost / Math.max(totalCoreMonths, 1) : costPerCore * 1.28).toFixed(2)),
                savingsFromCommitments,
                byRegion,
                bySku,
                trend,
                benchmark: 42.50,
                unitEconomics: {
                    costPerCore,
                    costPerCoreInventory,
                    costPerGiB,
                    totalRamGiB: totalRamGiB > 0 ? parseFloat(totalRamGiB.toFixed(1)) : null,
                    avgCpuUtilization,
                    effectiveCorePriceUtilized,
                },
                purchaseMix,
                architectureMix,
                generationMix,
                skuDetail,
                regionDetail,
                subscriptionDetail,
                rateOptimizationActions,
            };

            return NextResponse.json(payload);
        } catch (dbErr) {
            console.error("[compute-cost-per-core] DB error for real tenant:", tenantId, errorMessage(dbErr));
            return NextResponse.json({
                success: false, mock: false,
                totalCores: 0, totalCost: 0, effectiveCost: 0,
                costPerCore: 0, costPerCoreNoCommitments: 0, savingsFromCommitments: 0,
                byRegion: [], bySku: [], trend: [], benchmark: 42.50,
                unitEconomics: { costPerCore: 0, costPerCoreInventory: null, costPerGiB: null, totalRamGiB: null, avgCpuUtilization: null, effectiveCorePriceUtilized: null },
                purchaseMix: { totalCores: 0, paygCores: 0, spotCores: 0, ahubActiveCores: 0, ahubEligibleCores: 0, commitmentCoveragePct: 0, inventoryAvailable: false },
                architectureMix: [], generationMix: [], skuDetail: [], regionDetail: [], subscriptionDetail: [], rateOptimizationActions: [],
                error: `Sin datos disponibles: ${errorMessage(dbErr) || "error"}`,
            });
        }
    } catch (err: unknown) {
        console.error("[compute-cost-per-core] handler error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

