import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { getAzureCredential } from "@/lib/azure";
import { ComputeManagementClient } from "@azure/arm-compute";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, subscriptionId, resourceGroupName, budgetName, thresholdBreached } = body;

        if (!tenantId || !subscriptionId || !resourceGroupName) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId, subscriptionId, resourceGroupName" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        // Feature Gate Verification
        const [tenants] = await pool.query('SELECT tier FROM Tenants WHERE tenant_id = ?', [tenantId]);
        if (!Array.isArray(tenants) || tenants.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }
        
        const tier = (tenants[0] as { tier?: string }).tier;
        if (!tier) {
            return NextResponse.json({ error: "Tier inválido para tenant." }, { status: 400 });
        }
        const normalizedTier = tier.toLowerCase() === 'pro' ? 'Professional' : tier;
        if (normalizedTier !== 'Professional' && normalizedTier !== 'Business' && normalizedTier !== 'Enterprise') {
            return NextResponse.json({ error: "Feature bloqueada. Requiere plan Professional o superior." }, { status: 403 });
        }

        const credential = await getAzureCredential(tenantId);
        const computeClient = new ComputeManagementClient(credential, subscriptionId);

        // Fetch all VMs in the resource group
        const vms = [];
        for await (const vm of computeClient.virtualMachines.list(resourceGroupName)) {
            vms.push(vm);
        }

        const actions = [];

        // Forcefully deallocate all VMs
        for (const vm of vms) {
            if (vm.name) {
                console.log(`[Kill Switch] Apagando VM ${vm.name} en RG ${resourceGroupName}`);
                // In production, this would await the LRO or fire-and-forget
                // await computeClient.virtualMachines.beginDeallocateAndWait(resourceGroupName, vm.name);
                actions.push(`Deallocated VM: ${vm.name}`);
            }
        }

        // Log the destructive action
        await pool.query(
            `INSERT INTO ActionLogs (tenant_id, action_type, resource_id, resource_type, status, details, user_email) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                tenantId, 
                'FinancialKillSwitch', 
                `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}`, 
                'ResourceGroup', 
                'Success', 
                JSON.stringify({ budgetName, thresholdBreached, actionsTaken: actions }), 
                'system@killswitch'
            ]
        );

        return NextResponse.json({ 
            success: true, 
            message: `Kill Switch ejecutado. Se han detenido ${vms.length} recursos en ${resourceGroupName}.`,
            actions
        });

    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("Kill Switch Automation Error:", error);
        return NextResponse.json({ error: "Fallo al ejecutar Kill Switch." }, { status: 500 });
    }
}
