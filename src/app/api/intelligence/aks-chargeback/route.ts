import { NextRequest, NextResponse } from "next/server";
import { getAksChargebackCost } from "@/modules/collectors/azure/aksCostService";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { getResourceGraphClient } from "@/lib/azure";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        
        if (!tenantId) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId" }, { status: 400 });
        }

        // Feature Gate Verification
        let normalizedTier = 'Enterprise'; // Default for mock tenants
        if (!isMockTenant(tenantId)) {
            const [tenants]: any = await pool.query('SELECT * FROM Tenants WHERE tenant_id = ?', [tenantId]);
            if (!tenants || tenants.length === 0) {
                return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
            }
            
            const tier = tenants[0].tier;
            normalizedTier = tier.toLowerCase() === 'enterprise' ? 'Enterprise' : tier;
        }

        if (normalizedTier !== 'Enterprise') {
            return NextResponse.json({ error: "Feature bloqueada. Requiere plan Enterprise." }, { status: 403 });
        }

        let targetSubscriptionId = "mock-sub";
        let targetClusterName = "demo-aks-cluster";
        let targetNodeResourceGroup = "MC_demo";

        if (!isMockTenant(tenantId)) {
            const client = await getResourceGraphClient(tenantId);
            const query = `
                Resources
                | where type =~ 'microsoft.containerservice/managedclusters'
                | project name, subscriptionId, resourceGroup, nodeResourceGroup = tostring(properties.nodeResourceGroup)
                | limit 1
            `;
            const resARG = await client.resources({ query });
            const clusters = resARG.data as any[];

            if (!clusters || clusters.length === 0) {
                return NextResponse.json({ success: true, empty: true, message: "No se encontraron clústeres de AKS en el tenant." });
            }

            const cluster = clusters[0];
            targetSubscriptionId = cluster.subscriptionId;
            targetClusterName = cluster.name;
            targetNodeResourceGroup = cluster.nodeResourceGroup;
        }

        const data = await getAksChargebackCost(tenantId, targetSubscriptionId, targetClusterName, targetNodeResourceGroup);
        
        return NextResponse.json(data);
    } catch (error: any) {
        console.error("AKS Chargeback API Error:", error);
        return NextResponse.json({ error: "Fallo al obtener datos de AKS.", details: error.message }, { status: 500 });
    }
}
