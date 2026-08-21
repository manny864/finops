import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { getAzureCredential } from "@/lib/azure";
import { ComputeManagementClient } from "@azure/arm-compute";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { errorMessage } from '@/lib/apiErrors';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, subscriptionId, resourceGroupName, budgetName, thresholdBreached } = body;

        if (!tenantId || !subscriptionId || !resourceGroupName) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId, subscriptionId, resourceGroupName" }, { status: 400 });
        }

        const identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

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
        let failedCount = 0;

        // Forcefully deallocate all VMs
        for (const vm of vms) {
            if (vm.name) {
                console.log(`[Kill Switch] Apagando VM ${vm.name} en RG ${resourceGroupName}`);
                try {
                    await computeClient.virtualMachines.beginDeallocateAndWait(resourceGroupName, vm.name);
                    actions.push(`Deallocated VM: ${vm.name}`);
                } catch (vmErr) {
                    failedCount++;
                    console.error(`[Kill Switch] Fallo al apagar VM ${vm.name}:`, errorMessage(vmErr));
                    actions.push(`FAILED to deallocate VM: ${vm.name} (${errorMessage(vmErr) || 'unknown error'})`);
                }
            }
        }

        const allSucceeded = failedCount === 0;

        // Log the destructive action — el status refleja si TODAS las VMs se
        // apagaron realmente, no un 'Success' fijo (antes se logueaba éxito aun
        // cuando la llamada de apagado estaba comentada / fallaba).
        await pool.query(
            `INSERT INTO ActionLogs (tenant_id, action_type, resource_id, resource_type, status, details, user_email)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                tenantId,
                'FinancialKillSwitch',
                `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}`,
                'ResourceGroup',
                allSucceeded ? 'Success' : 'PartialFailure',
                JSON.stringify({ budgetName, thresholdBreached, actionsTaken: actions, failedCount }),
                identity.email || 'system@killswitch'
            ]
        );

        return NextResponse.json({
            success: allSucceeded,
            message: allSucceeded
                ? `Kill Switch ejecutado. Se han detenido ${vms.length} recursos en ${resourceGroupName}.`
                : `Kill Switch ejecutado con errores: ${vms.length - failedCount}/${vms.length} recursos detenidos en ${resourceGroupName}.`,
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
