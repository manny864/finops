import { NextRequest, NextResponse } from 'next/server';
import { getResourceGraphClient, getAzureCredential, getSubscriptionsForTenant } from '@/lib/azure';
import { getVmUtilization } from '@/modules/collectors/azure/metricsService';
import { analyzeVmEfficiency } from '@/modules/core/rightsizingEngine';
import { getMonthlyCostEstimate } from '@/services/pricingService';
import { requireTenantRole, AuthError } from '@/lib/requestAuth';
import { getWithStaleWhileRevalidate } from '@/lib/cache';
import { isMockTenant } from '@/lib/mockData';
import { recordDailySnapshotAsync } from '@/services/snapshotService';

async function queryResourceGraphWithRetry(client: any, query: string, subscriptions: string[], retries = 3, initialDelay = 3000): Promise<any> {
    let currentDelay = initialDelay;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await client.resources({ query, subscriptions });
        } catch (e: any) {
            const isRateLimit = e.statusCode === 429 || (e.code && e.code === 'RateLimiting');
            if (isRateLimit && attempt < retries) {
                console.warn(`[Rightsizing API] Rate Limited (429). Retrying query in ${currentDelay}ms... (Attempt ${attempt}/${retries})`);
                await new Promise(resolve => setTimeout(resolve, currentDelay));
                currentDelay *= 1.5;
            } else {
                throw e;
            }
        }
    }
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id');
        const subscriptionId = request.headers.get('x-subscription-id');

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: 'Faltan credenciales del entorno' }, { status: 400 });
        }

        // Auth: validate JWT and assert caller belongs to this tenant.
        await requireTenantRole(request, tenantId, ['Admin', 'Owner', 'Reader', 'Colaborador']);

        const cacheKey = `rightsizing:${tenantId}:${subscriptionId || 'all'}`;
        const underutilizedVms = await getWithStaleWhileRevalidate(cacheKey, async () => {
            let argClient;
            let subs: string[] | undefined = undefined;
            try {
                argClient = await getResourceGraphClient(tenantId);
                if (subscriptionId && subscriptionId.toLowerCase() !== 'all') {
                    subs = [subscriptionId];
                } else {
                    const credential = await getAzureCredential(tenantId);
                    subs = await getSubscriptionsForTenant(tenantId, credential);
                }
            } catch (e: any) {
                console.warn(`[Rightsizing] Sin credenciales/acceso para ${tenantId}:`, e?.message);
                return [];
            }

            if (!subs || subs.length === 0) {
                return [];
            }

        const isAll = !subscriptionId || subscriptionId.toLowerCase() === 'all';

        const query = isAll
            ? `
                Resources
                | where type =~ 'microsoft.compute/virtualmachines'
                | project id, name, sku = properties.hardwareProfile.vmSize, location, subscriptionId
            `
            : `
                Resources
                | where type =~ 'microsoft.compute/virtualmachines'
                | where subscriptionId =~ '${subscriptionId}'
                | project id, name, sku = properties.hardwareProfile.vmSize, location, subscriptionId
            `;

        const stoppedQuery = isAll
            ? `
                Resources
                | where type =~ 'microsoft.compute/virtualmachines'
                | where properties.extended.instanceView.powerState.code == 'PowerState/deallocated'
                | project id, name, location, resourceGroup, subscriptionId, sku = properties.hardwareProfile.vmSize, osDiskId = properties.storageProfile.osDisk.managedDisk.id, dataDisks = properties.storageProfile.dataDisks
            `
            : `
                Resources
                | where type =~ 'microsoft.compute/virtualmachines'
                | where subscriptionId =~ '${subscriptionId}'
                | where properties.extended.instanceView.powerState.code == 'PowerState/deallocated'
                | project id, name, location, resourceGroup, subscriptionId, sku = properties.hardwareProfile.vmSize, osDiskId = properties.storageProfile.osDisk.managedDisk.id, dataDisks = properties.storageProfile.dataDisks
            `;

        const disksQuery = isAll
            ? `
                Resources
                | where type =~ 'microsoft.compute/disks'
                | project id = tolower(id), diskSizeGB = toint(properties.diskSizeGB), sku = sku.name, location
            `
            : `
                Resources
                | where type =~ 'microsoft.compute/disks'
                | where subscriptionId =~ '${subscriptionId}'
                | project id = tolower(id), diskSizeGB = toint(properties.diskSizeGB), sku = sku.name, location
            `;

        let vmsResponse: any, stoppedResponse: any, disksResponse: any;
        try {
            vmsResponse = await queryResourceGraphWithRetry(argClient, query, subs);
            await new Promise(resolve => setTimeout(resolve, 1000));
            stoppedResponse = await queryResourceGraphWithRetry(argClient, stoppedQuery, subs);
            await new Promise(resolve => setTimeout(resolve, 1000));
            disksResponse = await queryResourceGraphWithRetry(argClient, disksQuery, subs);
        } catch (e: any) {
            console.warn(`[Rightsizing] Query ARG falló para ${tenantId}:`, e?.message);
            return [];
        }

        const vms = vmsResponse.data as any[] || [];
        const stoppedVms = stoppedResponse.data as any[] || [];
        const disks = disksResponse.data as any[] || [];

        // Build disk details lookup map
        const disksMap = new Map<string, { sizeGB: number, sku: string, location: string }>();
        for (const d of disks) {
            if (d.id) {
                disksMap.set(d.id.toLowerCase(), {
                    sizeGB: d.diskSizeGB || 0,
                    sku: d.sku || "Standard_LRS",
                    location: d.location || "eastus"
                });
            }
        }

        const stoppedVmsIds = new Set(stoppedVms.map(v => v.id.toLowerCase()));
        const activeVms = vms.filter(vm => !stoppedVmsIds.has(vm.id.toLowerCase()));

        const activePromises = activeVms.map(async (vm) => {
            const vmSubId = vm.subscriptionId || subscriptionId;
            const metrics = await getVmUtilization(tenantId, vmSubId, vm.id);
            const analysis = analyzeVmEfficiency(vm, metrics);
            
            return {
                id: vm.id,
                name: vm.name,
                subscriptionId: vmSubId,
                currentSku: vm.sku,
                maxCpu: analysis.maxCpu,
                avgCpu: analysis.avgCpu,
                recommendedSku: analysis.recommendedSku,
                isUnderutilized: analysis.isUnderutilized,
                reason: analysis.status,
                hiddenCost: 0
            };
        });

        const stoppedPromises = stoppedVms.map(async (vm) => {
            const vmSubId = vm.subscriptionId || subscriptionId;
            let storageCost = 0;
            const attachedDiskIds: string[] = [];
            
            if (vm.osDiskId) attachedDiskIds.push(vm.osDiskId.toLowerCase());
            if (vm.dataDisks && Array.isArray(vm.dataDisks)) {
                for (const d of vm.dataDisks) {
                    if (d.managedDisk?.id) {
                        attachedDiskIds.push(d.managedDisk.id.toLowerCase());
                    }
                }
            }
            
            for (const diskId of attachedDiskIds) {
                const diskInfo = disksMap.get(diskId);
                if (diskInfo) {
                    const cost = await getMonthlyCostEstimate("Storage", diskInfo.sku, diskInfo.location || vm.location || "eastus");
                    storageCost += cost || (diskInfo.sizeGB * 0.15); // Fallback: $0.15 per GB
                }
            }

            return {
                id: vm.id,
                name: vm.name,
                subscriptionId: vmSubId,
                currentSku: vm.sku,
                maxCpu: 0,
                avgCpu: 0,
                recommendedSku: "Snapshot & Delete VM",
                isUnderutilized: true,
                reason: 'Deallocated VM with attached Storage',
                hiddenCost: parseFloat(storageCost.toFixed(2))
            };
        });

        const activeResults = await Promise.all(activePromises);
        const stoppedResults = await Promise.all(stoppedPromises);
        
        const results = [...activeResults, ...stoppedResults];
            return results.filter(r => r.isUnderutilized);
        }, 3600);

        // Write-through de historial diario (best-effort, solo tenants reales).
        if (!isMockTenant(tenantId)) {
            const potentialSavings = underutilizedVms.reduce((s, v) => s + Number(v.hiddenCost || 0), 0);
            recordDailySnapshotAsync(tenantId, 'rightsizing', {
                recommendationsCount: underutilizedVms.length,
                potentialSavings: Number(potentialSavings.toFixed(2)),
            }, subscriptionId || 'All');
        }

        return NextResponse.json({ success: true, data: underutilizedVms });
    } catch (error: any) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('Rightsizing API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
