import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { calculateEmissions } from "@/services/carbonService";
import { getMockDataForRoute } from "@/lib/mockData";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const subscriptionId = searchParams.get('subscriptionId');

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan parámetros requeridos." }, { status: 400 });
        }

        const mockData = getMockDataForRoute('sustainability', tenantId);
        if (mockData) return NextResponse.json(mockData);

        const credential = await getAzureCredential(tenantId);
        const client = new ResourceGraphClient(credential);
        let subs: string[] | undefined = undefined;
        if (subscriptionId && subscriptionId.toLowerCase() !== 'all') {
            subs = [subscriptionId];
        } else {
            subs = await getSubscriptionsForTenant(tenantId, credential);
        }

        let subFilter = `| where subscriptionId =~ '${subscriptionId}'`;
        if (subscriptionId === 'All') {
            subFilter = '';
        }

        // Query VMs to calculate active footprint
        const vmQuery = `
            Resources
            | where type =~ 'Microsoft.Compute/virtualMachines'
            ${subFilter}
            | project name, location
        `;

        const vmResult = await client.resources({ query: vmQuery, subscriptions: subs });
        const vms = vmResult.data as any[];

        let totalFootprint = 0;
        // Assume active VMs ran 24/7 the past month (730 hours)
        for (const vm of vms) {
            totalFootprint += calculateEmissions(730, vm.location);
        }

        // Query Disks to calculate "Avoided Emissions" from zombies
        // (Just a rough estimation: unattached disks would have consumed power)
        const diskQuery = `
            Resources
            | where type =~ 'Microsoft.Compute/disks'
            | where properties.diskState == 'Unattached'
            ${subFilter}
            | project name, location
        `;
        const diskResult = await client.resources({ query: diskQuery, subscriptions: subs });
        const disks = diskResult.data as any[];
        
        let avoidedEmissions = 0;
        for (const disk of disks) {
            // Assume an unattached disk would have been a 50W (0.05kW) power draw if attached to a zombie VM
            // Or just reuse calculateEmissions with a smaller factor (e.g. 200 hours avoided)
            avoidedEmissions += calculateEmissions(200, disk.location);
        }

        return NextResponse.json({
            footprint: totalFootprint,
            avoided: avoidedEmissions,
            vmCount: vms.length,
            zombieCount: disks.length
        });

    } catch (error: any) {
        console.error("Sustainability Fetch Error:", error);
        return NextResponse.json({ error: "Fallo al calcular emisiones." }, { status: 500 });
    }
}
