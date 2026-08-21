/**
 * azureLicenseOptimization.service.ts
 *
 * Enriched service for the "Optimización de Licencias" sub-tab.
 *
 * Queries:
 *  - Microsoft Graph /v1.0/subscribedSkus → SKU inventory with pricing
 *  - Microsoft Graph /v1.0/users → user→SKU assignment + signInActivity
 *  - Azure Resource Graph → AHUB detection (VMs + SQL)
 *
 * Computes:
 *  - Unassigned pool waste: (prepaidUnits.enabled - consumedUnits) * unitPrice
 *  - Inactive user waste: users with daysInactive > 60 assigned to paid SKUs
 *  - AHUB savings: 40% VM compute / 30-55% SQL vCore
 */

import { getAzureCredential, getResourceGraphClient, getSubscriptionsForTenant } from "@/lib/azure";
import { kqlCatalog } from "@/modules/core/kqlCatalog";
import { getMonthlyCostEstimate } from "@/services/pricingService";
import { resolveSkuName, resolveSkuPrice } from "@/lib/m365SkuCatalog";
import {
    classifySkuCategory,
    type AhubResourceItem,
    type AhubResourceType,
    type SkuOptimizationItem,
    type SkuInactiveUser,
    type LicenseOptimizationSummary,
} from "@/types/licenseOptimization.types";
import { errorMessage } from '@/lib/apiErrors';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function graphToken(tenantId: string): Promise<string> {
    const credential = await getAzureCredential(tenantId);
    const tok = await credential.getToken("https://graph.microsoft.com/.default");
    if (!tok?.token) throw new Error("No se pudo autenticar con Microsoft Graph");
    return tok.token;
}

async function graphGetAll(token: string, url: string): Promise<any[]> {
    const out: any[] = [];
    let next: string | null = url;
    let guard = 0;
    while (next && guard < 50) {
        guard++;
        const res: Response = await fetch(next, {
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (!res.ok) {
            const err = await res.text().catch(() => "");
            throw Object.assign(new Error(`Graph ${res.status}: ${err.slice(0, 200)}`), { status: res.status });
        }
        const json: { value?: any[]; "@odata.nextLink"?: string | null } = await res.json();
        out.push(...(json.value || []));
        next = json["@odata.nextLink"] || null;
    }
    return out;
}

const daysSince = (iso?: string | null): number | null => {
    if (!iso) return null;
    const d = new Date(iso).getTime();
    if (Number.isNaN(d)) return null;
    return Math.max(0, Math.floor((Date.now() - d) / 86400000));
};

// ─── FREE / SYSTEM SKUs (no cost, excluded from waste calculations) ─────────

const FREE_SYSTEM_SKUS = new Set([
    "WINDOWS_STORE", "FLOW_FREE", "POWER_BI_STANDARD", "TEAMS_EXPLORATORY",
    "MCO_TEAMS_IW", "STREAM", "POWERAPPS_VIRAL", "MEE_FACULTY", "MEE_STUDENT",
    "AAD_BASIC", "CCIBOTS_PRIVPREV_VIRAL", "FABRIC_FREE", "MICROSOFT_FABRIC_FREE",
]);

// ─── Main enriched query ────────────────────────────────────────────────────

export async function getLicenseOptimizationData(tenantId: string) {
    const token = await graphToken(tenantId);

    // 1. Fetch subscribed SKUs
    const skus = await graphGetAll(token, "https://graph.microsoft.com/v1.0/subscribedSkus");

    // 2. Fetch users with signInActivity + assignedLicenses
    const select = "id,displayName,userPrincipalName,accountEnabled,assignedLicenses,signInActivity";
    let rawUsers: any[];
    try {
        rawUsers = await graphGetAll(
            token,
            `https://graph.microsoft.com/v1.0/users?$select=${select}&$top=999`
        );
    } catch {
        rawUsers = await graphGetAll(
            token,
            `https://graph.microsoft.com/v1.0/users?$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses&$top=999`
        );
    }

    // Build user→SKU map for inactive user detection
    const userSkus = new Map<string, { upn: string; name: string; daysInactive: number | null; skuIds: Set<string> }>();
    for (const u of rawUsers) {
        const lastSignIn = u.signInActivity?.lastSignInDateTime
            || u.signInActivity?.lastNonInteractiveSignInDateTime || null;
        const days = daysSince(lastSignIn);
        const skuIds = new Set<string>((u.assignedLicenses || []).map((l: any) => l.skuId as string));
        userSkus.set(u.id, {
            upn: u.userPrincipalName || "",
            name: u.displayName || u.userPrincipalName || "",
            daysInactive: days,
            skuIds,
        });
    }

    // 3. Build SKU optimization items
    const skuOptimizations: SkuOptimizationItem[] = skus.map((sku: any) => {
        const partNumber: string = sku.skuPartNumber || "";
        const isSystemSku = FREE_SYSTEM_SKUS.has(partNumber.toUpperCase());
        const unitPrice = isSystemSku ? 0 : resolveSkuPrice(partNumber);
        const totalPurchased = sku.prepaidUnits?.enabled || 0;
        const totalConsumed = sku.consumedUnits || 0;
        const unassignedCount = Math.max(0, totalPurchased - totalConsumed);

        // Find inactive users (>60d) assigned to this SKU
        const inactiveUsers: SkuInactiveUser[] = [];
        for (const [userId, u] of userSkus) {
            if (u.skuIds.has(sku.skuId) && u.daysInactive !== null && u.daysInactive > 60) {
                inactiveUsers.push({
                    userId,
                    userPrincipalName: u.upn,
                    displayName: u.name,
                    daysInactive: u.daysInactive,
                });
            }
        }

        const inactiveAssignedCount = inactiveUsers.length;
        const wastedMonthlySpendUSD = isSystemSku
            ? 0
            : Number(((unassignedCount + inactiveAssignedCount) * unitPrice).toFixed(2));

        return {
            skuId: sku.skuId,
            skuPartNumber: partNumber,
            commercialDisplayName: resolveSkuName(partNumber),
            category: classifySkuCategory(partNumber),
            unitPriceUSD: unitPrice,
            totalPurchased,
            totalConsumed,
            unassignedCount,
            inactiveAssignedCount,
            wastedMonthlySpendUSD,
            inactiveUsers,
            isSystemSku,
        };
    });

    // 4. AHUB detection via Azure Resource Graph
    const ahubResources: AhubResourceItem[] = [];
    try {
        const credential = await getAzureCredential(tenantId);
        const client = await getResourceGraphClient(tenantId);
        const subs = await getSubscriptionsForTenant(tenantId, credential);

        if (subs.length > 0) {
            const [vmsResponse, sqlResponse] = await Promise.all([
                client.resources({ query: kqlCatalog.missingAhubWindowsVMs, subscriptions: subs }),
                client.resources({ query: kqlCatalog.missingAhubSql, subscriptions: subs }),
            ]);

            const vms = (vmsResponse.data || []) as any[];
            const sqls = (sqlResponse.data || []) as any[];

            // VMs
            for (const vm of vms) {
                const sku = vm.sku || "Standard_D2s_v3";
                const loc = vm.location || "eastus";
                const price = await getMonthlyCostEstimate("Virtual Machines", sku, loc);
                const monthlyCost = price || 150;
                const savings = Number((monthlyCost * 0.4).toFixed(2));
                ahubResources.push({
                    id: vm.id,
                    name: vm.name,
                    resourceType: "Virtual Machine",
                    subscriptionId: vm.subscriptionId,
                    subscriptionName: vm.subscriptionName || vm.subscriptionId,
                    resourceGroup: vm.resourceGroup,
                    location: vm.location,
                    vCoresCount: 0,
                    currentLicenseType: "PAYG",
                    estimatedMonthlySavingsUSD: savings,
                    remediationCommand: {
                        cli: `az vm update --ids "${vm.id}" --set licenseType=Windows_Server`,
                        powershell: `Set-AzVM -ResourceId "${vm.id}" -LicenseType Windows_Server`,
                        impactSummary: `Activar AHUB en ${vm.name} ahorraría ~$${savings}/mes (40% del cómputo Windows). Requiere Software Assurance.`,
                    },
                });
            }

            // SQL — deduplicate by elastic pool
            const sqlGroups = new Map<string, any[]>();
            for (const db of sqls) {
                const groupKey = db.elasticPoolId && db.elasticPoolId.trim().length > 0
                    ? `pool::${db.elasticPoolId.toLowerCase()}`
                    : `db::${db.id.toLowerCase()}`;
                if (!sqlGroups.has(groupKey)) sqlGroups.set(groupKey, []);
                sqlGroups.get(groupKey)!.push(db);
            }

            for (const [groupKey, dbs] of sqlGroups) {
                const rep = dbs[0];
                const isPool = groupKey.startsWith("pool::");
                const sku = rep.sku || "GP_Gen5_2";
                const loc = rep.location || "eastus";
                const price = await getMonthlyCostEstimate("SQL Database", sku, loc);
                const vCores = Number(rep.capacity) || 2;
                const fallbackPerVCore = 70;
                const monthlyCost = price || (fallbackPerVCore * vCores);
                // AHUB SQL: 30% for GP, up to 55% for BC
                const tier = (rep.tier || "").toLowerCase();
                const ahubRate = tier.includes("businesscritical") ? 0.55 : 0.30;
                const savings = Number((monthlyCost * ahubRate).toFixed(2));

                const resourceType: AhubResourceType = isPool ? "SQL Elastic Pool" : "SQL Database";
                const name = isPool ? `Elastic Pool (${dbs.length} DBs)` : rep.name;

                ahubResources.push({
                    id: isPool ? rep.elasticPoolId : rep.id,
                    name,
                    resourceType,
                    subscriptionId: rep.subscriptionId,
                    subscriptionName: rep.subscriptionName || rep.subscriptionId,
                    resourceGroup: rep.resourceGroup,
                    location: rep.location,
                    vCoresCount: vCores,
                    currentLicenseType: "LicenseIncluded",
                    estimatedMonthlySavingsUSD: savings,
                    remediationCommand: {
                        cli: isPool
                            ? `az sql elastic-pool update --ids "${rep.elasticPoolId}" --license-type BasePrice`
                            : `az sql db update --ids "${rep.id}" --license-type BasePrice`,
                        powershell: isPool
                            ? `Set-AzSqlElasticPool -ResourceId "${rep.elasticPoolId}" -LicenseType BasePrice`
                            : `Set-AzSqlDatabase -ResourceId "${rep.id}" -LicenseType BasePrice`,
                        impactSummary: `Activar AHUB en ${name} ahorraría ~$${savings}/mes. Requiere Software Assurance.`,
                    },
                });
            }
        }
    } catch (e) {
        console.warn("[license-opt] AHUB Resource Graph query failed:", errorMessage(e));
    }

    // 5. Compute summary
    const paidSkus = skuOptimizations.filter(s => !s.isSystemSku);
    const summary: LicenseOptimizationSummary = {
        totalPaidLicenses: paidSkus.reduce((s, sk) => s + sk.totalPurchased, 0),
        totalAssigned: paidSkus.reduce((s, sk) => s + sk.totalConsumed, 0),
        totalUnassigned: paidSkus.reduce((s, sk) => s + sk.unassignedCount, 0),
        totalInactiveLicenses: paidSkus.reduce((s, sk) => s + sk.inactiveAssignedCount, 0),
        totalAhubSavingsUSD: Number(ahubResources.reduce((s, r) => s + r.estimatedMonthlySavingsUSD, 0).toFixed(2)),
        totalM365WastedUSD: Number(paidSkus.reduce((s, sk) => s + sk.wastedMonthlySpendUSD, 0).toFixed(2)),
        ahubResourceCount: ahubResources.length,
        skuCount: paidSkus.length,
    };

    return { summary, ahubResources, skuOptimizations };
}