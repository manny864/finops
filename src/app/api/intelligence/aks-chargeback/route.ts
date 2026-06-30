import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getAksChargebackCost } from "@/modules/collectors/azure/aksCostService";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { getResourceGraphClient } from "@/lib/azure";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');

        if (!tenantId) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId" }, { status: 400 });
        }

        const identity = await requireTenantAccess(request, tenantId);
        const isSuperAdmin = identity.isCorporateDomain;

        // --- Feature gate (tier Enterprise) ---
        let normalizedTier = 'Enterprise';
        if (!isMockTenant(tenantId)) {
            const [tenants]: any = await pool.query('SELECT tier FROM Tenants WHERE tenant_id = ?', [tenantId]);
            if (!tenants || tenants.length === 0) {
                return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
            }
            const tier = String(tenants[0].tier || '');
            normalizedTier = tier.toLowerCase() === 'enterprise' ? 'Enterprise' : tier;
        }
        if (normalizedTier !== 'Enterprise' && !isSuperAdmin) {
            return NextResponse.json({ error: "Feature bloqueada. Requiere plan Enterprise." }, { status: 403 });
        }

        // --- Cluster selection ---
        // Para tenants mock, getMockDataForRoute responde por una rama previa; aquí
        // sólo entran tenants reales. Si no hay clusters, salimos con empty:true.
        let targetSubscriptionId = "";
        let targetClusterName = "";
        let targetNodeResourceGroup = "";
        let availableClusters: Array<{ name: string; subscriptionId: string; resourceGroup: string; nodeResourceGroup: string }> = [];

        if (!isMockTenant(tenantId)) {
            const client = await getResourceGraphClient(tenantId);
            const query = `
                Resources
                | where type =~ 'microsoft.containerservice/managedclusters'
                | project name, subscriptionId, resourceGroup, nodeResourceGroup = tostring(properties.nodeResourceGroup)
            `;
            const resARG: any = await client.resources({ query, options: { resultFormat: "objectArray", top: 1000 } });
            const clusters = (resARG.data as any[]) || [];

            if (clusters.length === 0) {
                return NextResponse.json({ success: true, empty: true, message: "No se encontraron clústeres de AKS en el tenant." });
            }

            availableClusters = clusters.map(c => ({
                name: c.name,
                subscriptionId: c.subscriptionId,
                resourceGroup: c.resourceGroup,
                nodeResourceGroup: c.nodeResourceGroup
            }));

            // Cluster específico opcional vía ?clusterName=
            const requested = searchParams.get('clusterName');
            const cluster = requested
                ? (availableClusters.find(c => c.name === requested) || availableClusters[0])
                : availableClusters[0];

            targetSubscriptionId = cluster.subscriptionId;
            targetClusterName = cluster.name;
            targetNodeResourceGroup = cluster.nodeResourceGroup;
        }

        const data = await getWithStaleWhileRevalidate(
            `aks:chargeback:v1:${tenantId}:${targetSubscriptionId}:${targetClusterName}`,
            () => getAksChargebackCost(tenantId, targetSubscriptionId, targetClusterName, targetNodeResourceGroup),
            1800,
            600
        );

        return NextResponse.json({ ...data, availableClusters });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("AKS Chargeback API Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
