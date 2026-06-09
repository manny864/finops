import { NextRequest, NextResponse } from 'next/server';
import { getResourceGraphClient } from '@/lib/azure';
import { getVmUtilization } from '@/services/metricsService';
import { analyzeVmEfficiency } from '@/lib/rightsizingEngine';

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id');
        const subscriptionId = request.headers.get('x-subscription-id');

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: 'Faltan credenciales del entorno' }, { status: 400 });
        }

        const argClient = await getResourceGraphClient(tenantId);

        const query = subscriptionId === 'All'
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

        const response = await argClient.resources({ query });
        const vms = response.data as any[];

        if (!vms || vms.length === 0) {
            return NextResponse.json({ success: true, data: [] });
        }

        const rightsizingPromises = vms.map(async (vm) => {
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
                isUnderutilized: analysis.isUnderutilized
            };
        });

        const results = await Promise.all(rightsizingPromises);
        
        const underutilizedVms = results.filter(r => r.isUnderutilized);

        return NextResponse.json({ success: true, data: underutilizedVms });
    } catch (error: any) {
        console.error('Rightsizing API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
