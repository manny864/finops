import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import {
    calculateEmissions,
    calculateDiskEmissions,
    calculateStorageEmissions,
    emissionsEquivalencies,
    suggestGreenMigration,
    regionIntensity,
} from "@/services/carbonService";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const subscriptionId = searchParams.get("subscriptionId") || "All";
        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        let credential;
        try {
            credential = await getAzureCredential(tenantId);
        } catch {
            return NextResponse.json({
                success: false,
                error: "No hay credenciales configuradas para este tenant.",
            }, { status: 400 });
        }

        const client = new ResourceGraphClient(credential);
        let vms: any[] = [];
        let disks: any[] = [];
        let storageAccts: any[] = [];
        try {
            let subs: string[] | undefined;
            if (subscriptionId && subscriptionId.toLowerCase() !== "all") {
                subs = [subscriptionId];
            } else {
                subs = await getSubscriptionsForTenant(tenantId, credential);
            }

            const subFilter = subscriptionId && subscriptionId.toLowerCase() !== "all"
                ? `| where subscriptionId =~ '${subscriptionId}'` : "";

            // 1) VMs activas
            const vmQuery = `
                Resources
                | where type =~ 'Microsoft.Compute/virtualMachines'
                ${subFilter}
                | project name, location
            `;
            const vmRes = await client.resources({ query: vmQuery, subscriptions: subs });
            vms = (vmRes.data as any[]) || [];

            // 2) Discos zombi
            const diskQuery = `
                Resources
                | where type =~ 'Microsoft.Compute/disks'
                | where properties.diskState == 'Unattached'
                ${subFilter}
                | project name, location, sizeGB = toint(properties.diskSizeGB)
            `;
            const diskRes = await client.resources({ query: diskQuery, subscriptions: subs });
            disks = (diskRes.data as any[]) || [];

            // 3) Storage accounts (GB estimado por tier)
            const storageQuery = `
                Resources
                | where type =~ 'Microsoft.Storage/storageAccounts'
                ${subFilter}
                | project name, location, sku = tostring(sku.name)
            `;
            const stRes = await client.resources({ query: storageQuery, subscriptions: subs });
            storageAccts = (stRes.data as any[]) || [];
        } catch (e: any) {
            console.warn(`[Sustainability] No se pudo consultar ARG para ${tenantId}:`, e?.message);
            return NextResponse.json({
                success: true,
                footprint: 0,
                avoided: 0,
                vmCount: 0,
                zombieCount: 0,
                storageCount: 0,
                byRegion: [],
                recommendations: [],
                equivalencies: { carKm: 0, treesYear: 0, phoneCharges: 0 },
            });
        }

        // VM footprint (mes pasado, 730h)
        let totalFootprint = 0;
        const byRegion: Record<string, { kg: number; resources: number; intensity: number }> = {};
        for (const vm of vms) {
            const kg = calculateEmissions(730, vm.location);
            totalFootprint += kg;
            const r = (vm.location || "default").toLowerCase();
            if (!byRegion[r]) byRegion[r] = { kg: 0, resources: 0, intensity: regionIntensity(r) };
            byRegion[r].kg += kg;
            byRegion[r].resources += 1;
        }

        // Storage footprint (asumimos 500GB/cuenta promedio; mejora futura: query MetricValues)
        for (const sa of storageAccts) {
            const sku = (sa.sku || "Standard_LRS").toString();
            // sku ej: Standard_LRS, Standard_GRS, Premium_ZRS
            const redundancy = sku.split("_").pop() || "LRS";
            const assumedGB = 500;
            const kg = calculateStorageEmissions(assumedGB, sa.location, redundancy, 1);
            totalFootprint += kg;
            const r = (sa.location || "default").toLowerCase();
            if (!byRegion[r]) byRegion[r] = { kg: 0, resources: 0, intensity: regionIntensity(r) };
            byRegion[r].kg += kg;
            byRegion[r].resources += 1;
        }

        // Avoided (de zombies — lo que dejarían de emitir si se eliminan, 730h)
        let avoided = 0;
        for (const d of disks) {
            avoided += calculateDiskEmissions(730, d.location);
        }

        // Recomendaciones: por cada región top, sugerir alternativa verde
        const regionsRanked = Object.entries(byRegion).sort((a, b) => b[1].kg - a[1].kg);
        const recommendations: any[] = [];
        for (const [region, data] of regionsRanked.slice(0, 5)) {
            const rec = suggestGreenMigration(region);
            if (rec) {
                const projectedReduction = data.kg * (rec.reductionPct / 100);
                recommendations.push({
                    fromRegion: rec.fromRegion,
                    toRegion: rec.toRegion,
                    currentIntensity: rec.currentIntensity,
                    targetIntensity: rec.targetIntensity,
                    reductionPct: Math.round(rec.reductionPct * 10) / 10,
                    projectedReductionKgCO2: Math.round(projectedReduction * 100) / 100,
                    impactedResources: data.resources,
                });
            }
        }

        const equivalencies = emissionsEquivalencies(totalFootprint);

        return NextResponse.json({
            success: true,
            footprint: Math.round(totalFootprint * 100) / 100,
            avoided: Math.round(avoided * 100) / 100,
            vmCount: vms.length,
            zombieCount: disks.length,
            storageCount: storageAccts.length,
            byRegion: Object.entries(byRegion).map(([region, d]) => ({
                region,
                kgCO2e: Math.round(d.kg * 100) / 100,
                resources: d.resources,
                intensity: d.intensity,
            })),
            recommendations,
            equivalencies: {
                carKm: Math.round(equivalencies.carKm),
                treesYear: Math.round(equivalencies.treesYear * 10) / 10,
                phoneCharges: Math.round(equivalencies.phoneCharges),
            },
        });
    } catch (error: any) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        console.error("Sustainability Fetch Error:", error);
        return NextResponse.json({
            success: false,
            error: error?.message || "Fallo al calcular emisiones.",
        }, { status: 500 });
    }
}
