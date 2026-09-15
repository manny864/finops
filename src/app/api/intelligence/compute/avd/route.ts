/**
 * GET /api/intelligence/compute/avd — inventario dedicado de Azure Virtual
 * Desktop (Host Pools, Session Hosts con su VM y storage FSLogix) para
 * `/intelligence/computo/avd`. Ver `avdService.ts` para el detalle de datos.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { isMockTenant } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { redis } from "@/lib/redis";
import {
    getAvdInventory,
    evaluateSessionHostRemediations,
    evaluateHostPoolRemediations,
    type AvdInventory,
} from "@/modules/collectors/azure/avdService";
import { cappedMonthlySavings } from "@/lib/costAccrual";

function mockInventory(): AvdInventory {
    const hp1SessionHostsBase = [
        {
            id: "mock-sh-1",
            name: "avd-sh-01.contoso.com",
            vmResourceId: "mock-vm-1",
            status: "Available",
            sessions: 3,
            agentVersion: "1.0.9.0",
            osVersion: "10.0.22621",
            monthlyCostUsd: 421.25,
            costDataAvailable: true,
            cpuAvgPercent: 34.2,
            os: "Windows",
            licenseType: "None",
            ahubActive: false,
        },
        {
            id: "mock-sh-2",
            name: "avd-sh-02.contoso.com",
            vmResourceId: "mock-vm-2",
            status: "Available",
            sessions: 1,
            agentVersion: "1.0.9.0",
            osVersion: "10.0.22621",
            monthlyCostUsd: 421.25,
            costDataAvailable: true,
            cpuAvgPercent: 6.4,
            os: "Windows",
            licenseType: "None",
            ahubActive: false,
        },
    ];
    // El pool de demo corre Windows Server sin AHUB: dispara la recomendación.
    const hp1SessionHosts = hp1SessionHostsBase.map((sh) => {
        const actions = evaluateSessionHostRemediations(sh, "Pooled", true);
        return { ...sh, remediationActions: actions, potentialSavingUsd: cappedMonthlySavings(actions.map((a) => a.monthlySavingsUsd), sh.monthlyCostUsd) };
    });
    const hp1Actions = evaluateHostPoolRemediations({
        name: "hp-finanzas-pooled",
        hostPoolType: "Pooled",
        maxSessionLimit: 10,
        hasScalingPlan: false,
        sessionHostCount: hp1SessionHosts.length,
        totalSessions: 4,
        monthlyCostUsd: 842.5,
    });

    const hp2SessionHostBase = {
        id: "mock-sh-3",
        name: "avd-sh-personal-01.contoso.com",
        vmResourceId: "mock-vm-3",
        status: "Available",
        sessions: 0,
        agentVersion: "1.0.9.0",
        osVersion: "10.0.22621",
        monthlyCostUsd: 96.0,
        costDataAvailable: true,
        cpuAvgPercent: 1.1,
        os: "Windows",
        licenseType: "Windows_Client",
        ahubActive: false,
    };
    const hp2Actions0 = evaluateSessionHostRemediations(hp2SessionHostBase, "Personal");
    const hp2SessionHosts = [{ ...hp2SessionHostBase, remediationActions: hp2Actions0, potentialSavingUsd: cappedMonthlySavings(hp2Actions0.map((a) => a.monthlySavingsUsd), hp2SessionHostBase.monthlyCostUsd) }];

    return {
        hostPools: [
            {
                id: "mock-hostpool-1",
                name: "hp-finanzas-pooled",
                region: "eastus",
                resourceGroup: "rg-avd-demo",
                subscriptionId: "mock",
                friendlyName: "Finanzas - Escritorios Compartidos",
                hostPoolType: "Pooled",
                loadBalancerType: "BreadthFirst",
                maxSessionLimit: 10,
                hasScalingPlan: false,
                totalSessions: 4,
                monthlyCostUsd: 842.5,
                sessionHosts: hp1SessionHosts,
                remediationActions: hp1Actions,
                potentialSavingUsd: cappedMonthlySavings(
                    [...hp1Actions.map((a) => a.monthlySavingsUsd), ...hp1SessionHosts.map((sh) => sh.potentialSavingUsd)],
                    842.5,
                ),
            },
            {
                id: "mock-hostpool-2",
                name: "hp-desarrollo-personal",
                region: "eastus",
                resourceGroup: "rg-avd-demo",
                subscriptionId: "mock",
                friendlyName: "Desarrollo - Escritorios Personales",
                hostPoolType: "Personal",
                loadBalancerType: null,
                maxSessionLimit: 1,
                hasScalingPlan: false,
                totalSessions: 0,
                monthlyCostUsd: 96.0,
                sessionHosts: hp2SessionHosts,
                remediationActions: [],
                potentialSavingUsd: hp2SessionHosts[0].potentialSavingUsd,
            },
        ],
        workspaceCount: 1,
        storage: [
            {
                id: "mock-storage-1",
                name: "safslogixprofiles",
                type: "microsoft.storage/storageaccounts",
                region: "eastus",
                resourceGroup: "rg-avd-demo",
                monthlyCostUsd: 38.4,
                costDataAvailable: true,
            },
        ],
        summary: {
            hostPoolCount: 2,
            sessionHostCount: 3,
            totalSessions: 4,
            monthlyComputeCostUsd: 938.5,
            monthlyStorageCostUsd: 38.4,
            monthlyCostUsd: 976.9,
        },
    };
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ ok: true, mock: true, data: mockInventory() });
        }

        const cacheKey = `avd:inventory:v1:${tenantId}`;
        if (searchParams.get("bust") === "1") {
            await redis.del(cacheKey).catch(() => undefined);
        }
        const data = await getWithStaleWhileRevalidate(
            cacheKey,
            async () => {
                const credential = await getAzureCredential(tenantId);
                const subscriptionIds = await getSubscriptionsForTenant(tenantId, credential);
                if (subscriptionIds.length === 0) {
                    return {
                        hostPools: [],
                        workspaceCount: 0,
                        storage: [],
                        summary: {
                            hostPoolCount: 0,
                            sessionHostCount: 0,
                            totalSessions: 0,
                            monthlyComputeCostUsd: 0,
                            monthlyStorageCostUsd: 0,
                            monthlyCostUsd: 0,
                        },
                    } satisfies AvdInventory;
                }
                return getAvdInventory(tenantId, credential, subscriptionIds);
            },
            1800,
            600,
        );

        return NextResponse.json({ ok: true, mock: false, data });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("AVD Inventory API Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
