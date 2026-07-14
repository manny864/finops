import { NextRequest, NextResponse } from "next/server";
import { deallocateVirtualMachine, startVirtualMachine, restartVirtualMachine } from "@/services/remediationService";
import { getAzureCredential } from "@/lib/azure";
import { MonitorClient } from "@azure/arm-monitor";
import { getResourceGraphClient, getSubscriptionsForTenant } from "@/lib/azure";
import { AuthError, requireTenantAccess, requireTenantRole } from "@/lib/requestAuth";
import { withArgLimit } from "@/lib/argConcurrency";

type VmRow = {
    id: string;
    name: string;
    location?: string;
    resourceGroup?: string;
    subscriptionId?: string;
    powerState?: string;
    tags?: Record<string, string>;
};

const vmCache = new Map<string, { timestamp: number; data: VmRow[] }>();
const VM_CACHE_TTL_MS = 30 * 1000;
// Fase 0 (docs/vps-infra-improvement-plan.md): tope de tamaño + eviccion
// FIFO para no crecer sin limite (una entrada por combinacion tenant+sub).
const MAX_VM_CACHE_ENTRIES = 500;

function evictVmCacheIfFull(): void {
    while (vmCache.size > MAX_VM_CACHE_ENTRIES) {
        const firstKey = vmCache.keys().next().value;
        if (firstKey === undefined) break;
        vmCache.delete(firstKey);
    }
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const subscriptionId = searchParams.get("subscriptionId");

        if (!tenantId) {
            return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        const normalizedSubscription = subscriptionId && subscriptionId.toLowerCase() !== "all"
            ? subscriptionId
            : null;
        const cacheKey = `${tenantId}:${normalizedSubscription || "all"}`;
        const now = Date.now();
        const cached = vmCache.get(cacheKey);
        if (cached && now - cached.timestamp < VM_CACHE_TTL_MS) {
            return NextResponse.json({ success: true, auditResults: { allVirtualMachines: cached.data }, cached: true });
        }

        const client = await getResourceGraphClient(tenantId);
        const credential = await getAzureCredential(tenantId);
        let subscriptions: string[] = [];

        if (normalizedSubscription) {
            subscriptions = [normalizedSubscription];
        } else {
            subscriptions = await getSubscriptionsForTenant(tenantId, credential);
        }

        if (subscriptions.length === 0) {
            return NextResponse.json({ success: true, auditResults: { allVirtualMachines: [] } });
        }

        const query = `
            Resources
            | where type =~ 'microsoft.compute/virtualmachines'
            | project id, name, location, resourceGroup, subscriptionId, tags, powerState = tostring(properties.extended.instanceView.powerState.code)
        `;

        const response = await withArgLimit(() => client.resources({ query, subscriptions }));
        const rows = Array.isArray(response.data) ? (response.data as VmRow[]) : [];
        vmCache.set(cacheKey, { timestamp: now, data: rows });
        evictVmCacheIfFull();

        return NextResponse.json({ success: true, auditResults: { allVirtualMachines: rows } });
    } catch (e: unknown) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        const message = e instanceof Error ? e.message : String(e);
        const lowered = message.toLowerCase();
        const isRecoverableAzureError =
            lowered.includes("tenant no registrado en la base de datos") ||
            lowered.includes("faltan credenciales") ||
            lowered.includes("failed to fetch subscriptions") ||
            lowered.includes("authorization") ||
            lowered.includes("accessdenied") ||
            lowered.includes("no hay suscripciones disponibles");

        if (isRecoverableAzureError) {
            console.warn("Power GET degraded mode:", message);
            return NextResponse.json({
                success: true,
                auditResults: { allVirtualMachines: [] },
                degraded: true,
                message: "No se pudieron cargar VMs por credenciales/permisos del tenant."
            });
        }

        // Error no reconocido (bug, fallo de DB, etc.): antes se enmascaraba
        // igual como 200 degraded, ocultando fallos reales de monitoreo/alerting
        // detrás de una respuesta "exitosa" con lista vacía.
        console.error("Power GET error:", e);
        return NextResponse.json({ error: "No se pudieron cargar VMs en este momento." }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, action, vms, thresholdOptions } = body;

        if (!tenantId || !action || !vms || !Array.isArray(vms)) {
            return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
        }

        // RBAC mínimo: Owner/Admin (gestión del tenant) u Operator (rol operativo).
        const identity = await requireTenantRole(request, tenantId, ['Owner', 'Admin', 'Operator']);
        const email = identity.email || "unknown@tenant.local";

        // Ejecutar las acciones asíncronamente (sin await individual bloqueante)
        const errors: Array<{ vm: string; error: string }> = [];
        // Skips intencionales (p.ej. Smart Shutdown: CPU por encima del umbral).
        // NO son fallos, pero SÍ significan que la VM no se apagó — hay que
        // reportarlos al usuario para no mostrar un falso "apagado exitoso".
        const skipped: Array<{ vm: string; reason: string }> = [];
        const promises = vms.map(async (vm: { subscriptionId: string; resourceGroup: string; resourceName: string }) => {
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
                                    skipped.push({ vm: vm.resourceName, reason: `CPU en uso (${avgCpu.toFixed(2)}%) por encima del umbral (${thresholdOptions.maxCpuPercentage || 10}%).` });
                                    return; // Skip shutting down this VM
                                }
                            }
                        } catch (metricErr: unknown) {
                            const metricMessage = metricErr instanceof Error ? metricErr.message : String(metricErr);
                            console.error(`Error reading metrics for ${vm.resourceName}:`, metricMessage);
                            // Proceed with shutdown if metrics fail, or we could strict-fail.
                        }
                    }
                    await deallocateVirtualMachine(tenantId, email, vm.subscriptionId, vm.resourceGroup, vm.resourceName);
                } else if (action === 'start') {
                    await startVirtualMachine(tenantId, email, vm.subscriptionId, vm.resourceGroup, vm.resourceName);
                } else if (action === 'restart') {
                    await restartVirtualMachine(tenantId, email, vm.subscriptionId, vm.resourceGroup, vm.resourceName);
                }
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                console.error(`Fallo al ${action} VM ${vm.resourceName}:`, err);
                errors.push({ vm: vm.resourceName, error: errorMessage || "Unknown error" });
            }
        });

        // Esperamos a que los comandos 'begin' se disparen, no esperamos a que termine el apagado físico.
        await Promise.all(promises);

        // Invalidar cache de VMs para que el siguiente GET refleje el nuevo powerState.
        vmCache.delete(`${tenantId}:all`);
        for (const vm of vms) {
            if (vm?.subscriptionId) vmCache.delete(`${tenantId}:${vm.subscriptionId}`);
        }

        if (errors.length > 0 || skipped.length > 0) {
            // Distinguir errores de permisos (AuthorizationFailed/403) de skips por threshold.
            const isPermError = errors.some(e => /authoriz|forbid|denied|403/i.test(e.error));
            // Sólo devolvemos error HTTP si hubo fallos reales de permisos. Los
            // skips por umbral (o fallos parciales) van con 200 PERO el body deja
            // en claro qué VMs NO se apagaron, para que el frontend no muestre
            // un falso "apagado exitoso".
            const succeeded = vms.length - errors.length - skipped.length;
            const status = isPermError ? 403 : 200;
            return NextResponse.json({
                success: errors.length === 0,
                error: isPermError
                    ? "Fallo de permisos: el Service Principal del tenant no tiene rol con acción Microsoft.Compute/virtualMachines/deallocate (o start/restart). Asigne 'Virtual Machine Contributor' o superior en la suscripción."
                    : undefined,
                message: `Acción ${action}: ${succeeded} ejecutada(s), ${skipped.length} omitida(s), ${errors.length} con error.`,
                succeeded,
                skipped,
                failed: errors,
                // Compat: algunos consumidores leen `details`.
                details: errors,
                partial: !isPermError && (errors.length > 0 || skipped.length > 0),
            }, { status });
        }

        return NextResponse.json({ success: true, succeeded: vms.length, skipped: [], failed: [], message: `Comando ${action} enviado a ${vms.length} VMs.` });

    } catch (e: unknown) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        const details = e instanceof Error ? e.message : "Unknown error";
        return NextResponse.json({ error: "Error interno del servidor", details }, { status: 500 });
    }
}
