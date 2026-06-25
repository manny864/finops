import { NextRequest, NextResponse } from "next/server";
import { deallocateVirtualMachine, startVirtualMachine, restartVirtualMachine } from "@/services/remediationService";
import jwt from "jsonwebtoken";
import { getAzureCredential } from "@/lib/azure";
import { MonitorClient } from "@azure/arm-monitor";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, action, vms, thresholdOptions } = body;

        if (!tenantId || !action || !vms || !Array.isArray(vms)) {
            return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }

        const email = decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "";
        const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") ;

        if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: "El token no coincide con el tenant." }, { status: 403 });
        }

        // Ejecutar las acciones asíncronamente (sin await individual bloqueante)
        const errors: any[] = [];
        const promises = vms.map(async (vm: any) => {
            try {
                if (action === 'stop') {
                    // Smart Shutdown Logic (Performance-Aware)
                    if (thresholdOptions && thresholdOptions.enabled) {
                        try {
                            const credential = await getAzureCredential(tenantId);
                            const monitorClient = new MonitorClient(credential, vm.subscriptionId);
                            const resourceUri = `/subscriptions/${vm.subscriptionId}/resourceGroups/${vm.resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vm.resourceName}`;
                            
                            const now = new Date();
                            const past = new Date(now.getTime() - (thresholdOptions.idleDurationMinutes || 60) * 60000);
                            const timespan = `${past.toISOString()}/${now.toISOString()}`;
                            
                            const metrics = await monitorClient.metrics.list(resourceUri, {
                                timespan,
                                interval: 'PT5M',
                                metricnames: 'Percentage CPU'
                            });
                            
                            let avgCpu = 0;
                            let count = 0;
                            if (metrics.value && metrics.value.length > 0 && metrics.value[0].timeseries && metrics.value[0].timeseries.length > 0) {
                                const data = metrics.value[0].timeseries[0].data || [];
                                for (const point of data) {
                                    if (point.average !== undefined) {
                                        avgCpu += point.average;
                                        count++;
                                    }
                                }
                            }
                            
                            if (count > 0) {
                                avgCpu = avgCpu / count;
                                if (avgCpu > (thresholdOptions.maxCpuPercentage || 10)) {
                                    console.log(`Skipping shutdown for ${vm.resourceName}, CPU ${avgCpu.toFixed(2)}% > ${thresholdOptions.maxCpuPercentage}%`);
                                    errors.push({ vm: vm.resourceName, error: `Skipped: CPU utilization (${avgCpu.toFixed(2)}%) is above threshold.` });
                                    return; // Skip shutting down this VM
                                }
                            }
                        } catch (metricErr: any) {
                            console.error(`Error reading metrics for ${vm.resourceName}:`, metricErr.message);
                            // Proceed with shutdown if metrics fail, or we could strict-fail.
                        }
                    }
                    await deallocateVirtualMachine(tenantId, email, vm.subscriptionId, vm.resourceGroup, vm.resourceName);
                } else if (action === 'start') {
                    await startVirtualMachine(tenantId, email, vm.subscriptionId, vm.resourceGroup, vm.resourceName);
                } else if (action === 'restart') {
                    await restartVirtualMachine(tenantId, email, vm.subscriptionId, vm.resourceGroup, vm.resourceName);
                }
            } catch (err: any) {
                console.error(`Fallo al ${action} VM ${vm.resourceName}:`, err);
                errors.push({ vm: vm.resourceName, error: err.message || err.code || "Unknown error" });
            }
        });

        // Esperamos a que los comandos 'begin' se disparen, no esperamos a que termine el apagado físico.
        await Promise.all(promises);

        if (errors.length > 0) {
            return NextResponse.json({ error: "Fallo de permisos o ejecución", details: errors }, { status: 403 });
        }

        return NextResponse.json({ success: true, message: `Comando ${action} enviado a ${vms.length} VMs.` });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno del servidor", details: e.message }, { status: 500 });
    }
}
