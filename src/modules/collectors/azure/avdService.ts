/**
 * Azure Virtual Desktop — inventario compuesto para su página dedicada
 * (`/intelligence/computo/avd`): Host Pools, sus Session Hosts (con la VM de
 * cómputo subyacente y el costo real de esa VM) y storage de perfiles FSLogix.
 *
 * Antes esto vivía sin desglose dentro de `miscServicesCostService.ts` (solo
 * costo agregado de hostpools/workspaces, sin listar host pools ni session
 * hosts). Ahora esa lista excluye AVD para no duplicar el dato.
 */
import Decimal from "decimal.js";
import {
    listResourcesByTypes,
    getMtdCostByResourceId,
    type ArgResourceRow,
} from "@/app/api/intelligence/databases/diagnosticsShared";
import { getAzureResourceMetricsSummary } from "@/lib/computeMetricsShared";
import { cappedMonthlySavings } from "@/lib/costAccrual";
import { getUsoPorHostPool, type AvdUsoHostPool } from "@/modules/collectors/azure/avdUsageService";
import type { AvdRemediationAction } from "@/lib/computeWorkloadTypes";

const HOSTPOOL_TYPE = "microsoft.desktopvirtualization/hostpools";
const WORKSPACE_TYPE = "microsoft.desktopvirtualization/workspaces";
const APPGROUP_TYPE = "microsoft.desktopvirtualization/applicationgroups";
const SESSIONHOST_TYPE = "microsoft.desktopvirtualization/hostpools/sessionhosts";
/**
 * Los session hosts NO estan en la tabla `Resources` de Resource Graph: tienen
 * tabla propia. Consultarlos en `Resources` no falla, devuelve cero filas, que
 * es indistinguible de "el host pool esta vacio" -- y asi salio a produccion el
 * 2026-09-15: dos host pools reales mostrando 0 session hosts y $0.00.
 */
const SESSIONHOST_TABLA = "desktopvirtualizationresources";
const SCALINGPLAN_TYPE = "microsoft.desktopvirtualization/scalingplans";
const COMPUTE_VM_TYPE = "microsoft.compute/virtualmachines";
const STORAGE_TYPE = "microsoft.storage/storageaccounts";
const NETAPP_TYPE = "microsoft.netapp/netappaccounts";

/**
 * No hay ningún campo ARM que marque una cuenta de storage/NetApp como
 * "esto es un perfil FSLogix": se configura por GPO/registro en el session
 * host, invisible para Resource Graph. Heurística por nombre/convención.
 * ponytail: falso negativo si el share no sigue esta convención — subir a
 * lectura de tags (`Purpose=FSLogix`) si el cliente las usa.
 */
const FSLOGIX_NAME_HINT = /fslogix|profile|perfil|avd/i;

function prop(row: ArgResourceRow, key: string): string | undefined {
    const v = row.properties?.[key];
    return typeof v === "string" ? v : undefined;
}

function propNumber(row: ArgResourceRow, key: string): number | undefined {
    const v = row.properties?.[key];
    return typeof v === "number" ? v : undefined;
}

export interface AvdSessionHost {
    id: string;
    name: string;
    vmResourceId: string | null;
    status: string;
    sessions: number;
    agentVersion: string | null;
    osVersion: string | null;
    monthlyCostUsd: number;
    costDataAvailable: boolean;
    cpuAvgPercent: number | null;
    /** "Windows" | "Linux" — de la VM subyacente; null si la VM no se pudo leer. */
    os: string | null;
    /** `properties.licenseType` de la VM: "Windows_Client", "Windows_Server", "None". */
    licenseType: string | null;
    ahubActive: boolean;
    remediationActions: AvdRemediationAction[];
    potentialSavingUsd: number;
}

/**
 * Un Application Group es lo que hace usable a un host pool: publica un
 * escritorio completo (`Desktop`) o aplicaciones sueltas (`RemoteApp`), y solo
 * llega a la gente si a su vez cuelga de una Workspace. Sin app group, o con
 * app groups que ninguna workspace publica, el host pool corre y **nadie puede
 * conectarse**: el gasto es del 100%.
 */
export interface AvdApplicationGroup {
    id: string;
    name: string;
    friendlyName: string | null;
    /** "Desktop" o "RemoteApp". */
    tipo: string | null;
    /** Workspace que lo publica; null = no se le muestra a ningún usuario. */
    workspaceId: string | null;
    workspaceName: string | null;
}

export interface AvdWorkspace {
    id: string;
    name: string;
    friendlyName: string | null;
    region: string;
    resourceGroup: string;
    applicationGroupCount: number;
}

export interface AvdHostPool {
    id: string;
    name: string;
    region: string;
    resourceGroup: string;
    subscriptionId: string;
    friendlyName: string | null;
    hostPoolType: string | null;
    loadBalancerType: string | null;
    maxSessionLimit: number | null;
    hasScalingPlan: boolean;
    applicationGroups: AvdApplicationGroup[];
    /** Falso cuando ningún app group suyo está publicado en una workspace. */
    alcanzable: boolean;
    sessionHosts: AvdSessionHost[];
    totalSessions: number;
    monthlyCostUsd: number;
    /** Uso real medido en Log Analytics; trae su propio motivo si no hay dato. */
    uso: AvdUsoHostPool;
    /**
     * Costo mensual dividido por los usuarios REALES del periodo, no por las
     * sesiones abiertas en este instante. `null` cuando no hay dato de uso: un
     * costo por usuario inventado es peor que no mostrarlo.
     */
    costoPorUsuarioUsd: number | null;
    remediationActions: AvdRemediationAction[];
    potentialSavingUsd: number;
}

export interface AvdStorageResource {
    id: string;
    name: string;
    type: string;
    region: string;
    resourceGroup: string;
    monthlyCostUsd: number;
    costDataAvailable: boolean;
    /** Bytes realmente ocupados por los perfiles (metrica FileCapacity). */
    usedBytes: number | null;
    /** Cuota aprovisionada (FileShareCapacityQuota): lo que se paga en Premium. */
    quotaBytes: number | null;
    fileCount: number | null;
    /** Porcentaje de la cuota en uso; es donde se ve el sobreaprovisionamiento. */
    utilizacionPct: number | null;
}

export interface AvdInventory {
    hostPools: AvdHostPool[];
    workspaces: AvdWorkspace[];
    workspaceCount: number;
    storage: AvdStorageResource[];
    summary: {
        hostPoolCount: number;
        applicationGroupCount: number;
        /** Host pools que corren pero a los que nadie puede conectarse. */
        hostPoolsInalcanzables: number;
        sessionHostCount: number;
        totalSessions: number;
        monthlyComputeCostUsd: number;
        monthlyStorageCostUsd: number;
        monthlyCostUsd: number;
    };
}

function parentHostPoolId(sessionHostId: string): string | null {
    const match = sessionHostId.match(/^(.*)\/sessionhosts\/[^/]+$/i);
    return match ? match[1].toLowerCase() : null;
}

/**
 * Recomendaciones por Session Host: rightsizing por CPU, desasignación de
 * desktops Personal ociosos y Azure Hybrid Benefit.
 *
 * OJO con AHUB en AVD: la licencia que corresponde NO es la misma que en una VM
 * común. Un session host con Windows 10/11 multisesión se cubre con la licencia
 * M365/Windows E3-E5 del usuario y no paga licencia de SO — ahí AHUB no aplica y
 * `licenseType` viene "Windows_Client". La recomendación sale sólo cuando el
 * session host corre **Windows Server** sin `licenseType` seteado, que es el
 * caso en que efectivamente se está pagando la licencia a tarifa completa.
 */
export function evaluateSessionHostRemediations(
    sh: Omit<AvdSessionHost, "remediationActions" | "potentialSavingUsd">,
    hostPoolType: string | null,
    isWindowsServer = false,
): AvdRemediationAction[] {
    const actions: AvdRemediationAction[] = [];

    if (isWindowsServer && !sh.ahubActive && sh.monthlyCostUsd > 15) {
        actions.push({
            id: `rec-avd-ahub-${sh.name}`,
            type: "ahub",
            titleKey: "rec_avd_ahub_title",
            descKey: "rec_avd_ahub_desc",
            params: { host: sh.name },
            monthlySavingsUsd: Number((sh.monthlyCostUsd * 0.4).toFixed(2)),
            risk: "low",
            confidence: "high",
            commandCli: sh.vmResourceId
                ? `az vm update --ids ${sh.vmResourceId} --set licenseType=Windows_Server`
                : undefined,
            commandTerraform: `license_type = "Windows_Server"`,
        });
    }

    if (sh.cpuAvgPercent !== null && sh.cpuAvgPercent < 10 && sh.monthlyCostUsd > 20) {
        actions.push({
            id: `rec-avd-rightsizing-${sh.name}`,
            type: "rightsizing_sku",
            titleKey: "rec_avd_rightsizing_sku_title",
            descKey: "rec_avd_rightsizing_sku_desc",
            params: { host: sh.name, cpu: sh.cpuAvgPercent },
            monthlySavingsUsd: Number((sh.monthlyCostUsd * 0.4).toFixed(2)),
            risk: "medium",
            confidence: "medium",
            commandCli: sh.vmResourceId
                ? `az vm resize --ids ${sh.vmResourceId} --size <TARGET_SIZE>`
                : undefined,
        });
    }

    if (hostPoolType === "Personal" && sh.sessions === 0 && sh.status === "Available" && sh.monthlyCostUsd > 5) {
        actions.push({
            id: `rec-avd-idle-personal-${sh.name}`,
            type: "idle_personal_host",
            titleKey: "rec_avd_idle_personal_host_title",
            descKey: "rec_avd_idle_personal_host_desc",
            params: { host: sh.name },
            monthlySavingsUsd: Number((sh.monthlyCostUsd * 0.9).toFixed(2)),
            risk: "low",
            confidence: "medium",
            commandCli: sh.vmResourceId ? `az vm deallocate --ids ${sh.vmResourceId}` : undefined,
        });
    }

    return actions;
}

/**
 * Recomendaciones a nivel Host Pool: activar un Scaling Plan (la palanca
 * FinOps #1 de AVD — apagar session hosts fuera de horario pico) y
 * consolidar pools Pooled sobredimensionados frente a su uso real.
 */
export function evaluateHostPoolRemediations(hp: {
    name: string;
    hostPoolType: string | null;
    maxSessionLimit: number | null;
    hasScalingPlan: boolean;
    sessionHostCount: number;
    totalSessions: number;
    monthlyCostUsd: number;
    /** Ver `alcanzable` en AvdHostPool. Por defecto true para no inventar hallazgos. */
    alcanzable?: boolean;
    applicationGroupCount?: number;
}): AvdRemediationAction[] {
    const actions: AvdRemediationAction[] = [];
    const isPooled = hp.hostPoolType === "Pooled";

    // El desperdicio mas caro de AVD y el mas facil de no ver: session hosts
    // encendidos en un pool al que NADIE puede conectarse, porque no tiene
    // application group o porque ninguno de los suyos cuelga de una workspace.
    // No es rightsizing, es gasto del 100%.
    if (hp.alcanzable === false && hp.sessionHostCount > 0 && hp.monthlyCostUsd > 0) {
        actions.push({
            id: `rec-avd-inalcanzable-${hp.name}`,
            type: "unreachable_host_pool",
            titleKey: "rec_avd_unreachable_host_pool_title",
            descKey: "rec_avd_unreachable_host_pool_desc",
            params: {
                hostPool: hp.name,
                hosts: hp.sessionHostCount,
                grupos: hp.applicationGroupCount ?? 0,
            },
            monthlySavingsUsd: Number(hp.monthlyCostUsd.toFixed(2)),
            risk: "medium",
            confidence: "medium",
            commandCli: `az desktopvirtualization applicationgroup list --query "[?hostPoolArmPath!=null]" -o table`,
        });
    }

    if (isPooled && hp.sessionHostCount > 0 && !hp.hasScalingPlan) {
        actions.push({
            id: `rec-avd-scalingplan-${hp.name}`,
            type: "enable_scaling_plan",
            titleKey: "rec_avd_enable_scaling_plan_title",
            descKey: "rec_avd_enable_scaling_plan_desc",
            params: { hostPool: hp.name },
            monthlySavingsUsd: Number((hp.monthlyCostUsd * 0.35).toFixed(2)),
            risk: "low",
            confidence: "medium",
            commandCli: `az desktopvirtualization scaling-plan create --resource-group <RG> --name sp-${hp.name} --host-pool-type Pooled --time-zone "UTC"`,
            commandTerraform: `resource "azurerm_virtual_desktop_scaling_plan" "sp_${hp.name}" {\n  name                = "sp-${hp.name}"\n  host_pool_type      = "Pooled"\n  # ramp-up / peak / ramp-down / off-peak schedule\n}`,
        });
    }

    if (isPooled && hp.sessionHostCount > 1 && hp.maxSessionLimit && hp.maxSessionLimit > 0) {
        const avgSessionsPerHost = hp.totalSessions / hp.sessionHostCount;
        if (avgSessionsPerHost < hp.maxSessionLimit * 0.3) {
            const hostsToRemove = Math.max(1, Math.floor(hp.sessionHostCount * 0.3));
            const avgCostPerHost = hp.monthlyCostUsd / hp.sessionHostCount;
            actions.push({
                id: `rec-avd-consolidate-${hp.name}`,
                type: "consolidate_host_pool",
                titleKey: "rec_avd_consolidate_host_pool_title",
                descKey: "rec_avd_consolidate_host_pool_desc",
                params: { hostPool: hp.name, hosts: hostsToRemove, avgSessions: Number(avgSessionsPerHost.toFixed(1)), maxSessions: hp.maxSessionLimit },
                monthlySavingsUsd: Number((avgCostPerHost * hostsToRemove).toFixed(2)),
                risk: "medium",
                confidence: "medium",
            });
        }
    }

    return actions;
}

export async function getAvdInventory(
    tenantId: string,
    credential: any,
    subscriptionIds: string[],
): Promise<AvdInventory> {
    const [rows, sessionHostRows] = await Promise.all([
        listResourcesByTypes(
            tenantId,
            [HOSTPOOL_TYPE, WORKSPACE_TYPE, APPGROUP_TYPE, SCALINGPLAN_TYPE, COMPUTE_VM_TYPE, STORAGE_TYPE, NETAPP_TYPE],
            subscriptionIds,
            credential,
        ),
        listResourcesByTypes(tenantId, [SESSIONHOST_TYPE], subscriptionIds, credential, SESSIONHOST_TABLA),
    ]);

    const hostPoolRows = rows.filter((r) => r.type === HOSTPOOL_TYPE);
    const workspaceRows = rows.filter((r) => r.type === WORKSPACE_TYPE);
    const scalingPlanRows = rows.filter((r) => r.type === SCALINGPLAN_TYPE);
    const appGroupRows = rows.filter((r) => r.type === APPGROUP_TYPE);

    // Una workspace publica app groups por `applicationGroupReferences`, y el
    // app group ademas apunta a su workspace por `workspaceArmPath`. Se usan
    // las dos direcciones: alcanza con que una lo confirme.
    const nombreWorkspacePorId = new Map<string, string>();
    const workspacePorAppGroup = new Map<string, string>();
    for (const w of workspaceRows) {
        nombreWorkspacePorId.set(w.id.toLowerCase(), prop(w, "friendlyName") || w.name);
        const refs = w.properties?.applicationGroupReferences;
        if (!Array.isArray(refs)) continue;
        for (const ref of refs) {
            if (typeof ref === "string") workspacePorAppGroup.set(ref.toLowerCase(), w.id);
        }
    }

    const appGroupsPorHostPool = new Map<string, AvdApplicationGroup[]>();
    for (const ag of appGroupRows) {
        const hostPoolArmPath = prop(ag, "hostPoolArmPath");
        if (!hostPoolArmPath) continue;
        const desdeWorkspace = workspacePorAppGroup.get(ag.id.toLowerCase());
        const desdeAppGroup = prop(ag, "workspaceArmPath");
        const workspaceId = desdeWorkspace || desdeAppGroup || null;
        const clave = hostPoolArmPath.toLowerCase();
        const lista = appGroupsPorHostPool.get(clave) ?? [];
        lista.push({
            id: ag.id,
            name: ag.name,
            friendlyName: prop(ag, "friendlyName") || null,
            tipo: prop(ag, "applicationGroupType") || null,
            workspaceId,
            workspaceName: workspaceId ? nombreWorkspacePorId.get(workspaceId.toLowerCase()) || null : null,
        });
        appGroupsPorHostPool.set(clave, lista);
    }

    const appGroupsPorWorkspace = new Map<string, number>();
    for (const lista of appGroupsPorHostPool.values()) {
        for (const ag of lista) {
            if (!ag.workspaceId) continue;
            const k = ag.workspaceId.toLowerCase();
            appGroupsPorWorkspace.set(k, (appGroupsPorWorkspace.get(k) ?? 0) + 1);
        }
    }
    // Trae todas las VMs del tenant en la misma consulta KQL (una sola llamada,
    // no una por session host) y se filtran acá las que son session host.
    const vmRowsById = new Map<string, ArgResourceRow>();
    for (const r of rows) {
        if (r.type === COMPUTE_VM_TYPE) vmRowsById.set(r.id.toLowerCase(), r);
    }
    const storageRows = rows.filter(
        (r) => (r.type === STORAGE_TYPE || r.type === NETAPP_TYPE) && FSLOGIX_NAME_HINT.test(r.name),
    );

    const hostPoolIdsWithScalingPlan = new Set<string>();
    for (const r of scalingPlanRows) {
        const refs = r.properties?.hostPoolReferences;
        if (!Array.isArray(refs)) continue;
        for (const ref of refs) {
            if (ref && typeof ref === "object" && (ref as any).scalingPlanEnabled && typeof (ref as any).hostPoolArmPath === "string") {
                hostPoolIdsWithScalingPlan.add(((ref as any).hostPoolArmPath as string).toLowerCase());
            }
        }
    }

    const vmResources: Array<{ id: string; subscriptionId?: string }> = [];
    for (const r of sessionHostRows) {
        const vmId = prop(r, "resourceId");
        if (vmId) vmResources.push({ id: vmId, subscriptionId: r.subscriptionId });
    }

    const storageResources = storageRows.map((r) => ({ id: r.id, subscriptionId: r.subscriptionId }));

    const [vmCosts, storageCosts] = await Promise.all([
        getMtdCostByResourceId(tenantId, credential, vmResources),
        getMtdCostByResourceId(tenantId, credential, storageResources),
    ]);

    // Métrica rápida de CPU por VM de session host, en paralelo (mismo patrón
    // que el resto de las familias de cómputo).
    const cpuByVmId = new Map<string, number | null>();
    await Promise.all(
        vmResources.map(async ({ id }) => {
            const summary = await getAzureResourceMetricsSummary(credential, id, ["Percentage CPU"]);
            cpuByVmId.set(id.toLowerCase(), summary["Percentage CPU"] ?? null);
        }),
    );

    const hostPoolsById = new Map<string, AvdHostPool>();
    for (const r of hostPoolRows) {
        hostPoolsById.set(r.id.toLowerCase(), {
            id: r.id,
            name: r.name,
            region: r.location || "unknown",
            resourceGroup: r.resourceGroup || "unknown",
            subscriptionId: r.subscriptionId || "",
            friendlyName: prop(r, "friendlyName") || null,
            hostPoolType: prop(r, "hostPoolType") || null,
            loadBalancerType: prop(r, "loadBalancerType") || null,
            maxSessionLimit: propNumber(r, "maxSessionLimit") ?? null,
            hasScalingPlan: hostPoolIdsWithScalingPlan.has(r.id.toLowerCase()),
            applicationGroups: appGroupsPorHostPool.get(r.id.toLowerCase()) ?? [],
            alcanzable: (appGroupsPorHostPool.get(r.id.toLowerCase()) ?? []).some((ag) => ag.workspaceId !== null),
            sessionHosts: [],
            totalSessions: 0,
            monthlyCostUsd: 0,
            uso: { disponible: false, motivo: "error", usuariosUnicos: 0, conexiones: 0, horasConexion: 0, picoConcurrencia: 0, diasAnalizados: 30 },
            costoPorUsuarioUsd: null,
            remediationActions: [],
            potentialSavingUsd: 0,
        });
    }

    for (const r of sessionHostRows) {
        const parentId = parentHostPoolId(r.id);
        const hostPool = parentId ? hostPoolsById.get(parentId) : undefined;
        if (!hostPool) continue; // host pool no visible en esta suscripción/tier

        const vmId = prop(r, "resourceId") || null;
        const monthlyCostUsd = vmId ? vmCosts.get(vmId.toLowerCase()) ?? 0 : 0;
        const sessions = propNumber(r, "sessions") ?? 0;

        const vmRow = vmId ? vmRowsById.get(vmId.toLowerCase()) : undefined;
        const vmProps = (vmRow?.properties || {}) as Record<string, any>;
        const licenseType = vmRow ? String(vmProps?.licenseType || "None") : null;
        const isWindows =
            Boolean(vmProps?.osProfile?.windowsConfiguration) ||
            String(vmProps?.storageProfile?.osDisk?.osType || "").toLowerCase() === "windows";
        const os = vmRow ? (isWindows ? "Windows" : "Linux") : null;
        const ahubActive = (licenseType || "").toLowerCase().includes("windows_server");
        const imageOffer = String(vmProps?.storageProfile?.imageReference?.offer || "").toLowerCase();
        const isWindowsServer = os === "Windows" && imageOffer.includes("windowsserver");

        const sessionHostBase = {
            id: r.id,
            name: r.name,
            vmResourceId: vmId,
            status: prop(r, "status") || "Unknown",
            sessions,
            agentVersion: prop(r, "agentVersion") || null,
            osVersion: prop(r, "osVersion") || null,
            monthlyCostUsd,
            costDataAvailable: vmId ? vmCosts.has(vmId.toLowerCase()) : false,
            cpuAvgPercent: vmId ? cpuByVmId.get(vmId.toLowerCase()) ?? null : null,
            os,
            licenseType,
            ahubActive,
        };
        const shActions = evaluateSessionHostRemediations(sessionHostBase, hostPool.hostPoolType, isWindowsServer);

        hostPool.sessionHosts.push({
            ...sessionHostBase,
            remediationActions: shActions,
            potentialSavingUsd: cappedMonthlySavings(shActions.map((a) => a.monthlySavingsUsd), monthlyCostUsd),
        });
        hostPool.totalSessions += sessions;
        hostPool.monthlyCostUsd = new Decimal(hostPool.monthlyCostUsd).plus(monthlyCostUsd).toNumber();
    }

    // Uso real por pool. Va despues de armar los pools porque necesita sus ids,
    // y en paralelo entre pools.
    const usoPorPool = await getUsoPorHostPool(
        credential,
        Array.from(hostPoolsById.values()).map((hp) => hp.id),
    );

    for (const hostPool of hostPoolsById.values()) {
        hostPool.uso = usoPorPool.get(hostPool.id.toLowerCase()) ?? hostPool.uso;
        hostPool.costoPorUsuarioUsd =
            hostPool.uso.disponible && hostPool.uso.usuariosUnicos > 0
                ? Number((hostPool.monthlyCostUsd / hostPool.uso.usuariosUnicos).toFixed(2))
                : null;

        hostPool.remediationActions = evaluateHostPoolRemediations({
            name: hostPool.name,
            hostPoolType: hostPool.hostPoolType,
            maxSessionLimit: hostPool.maxSessionLimit,
            hasScalingPlan: hostPool.hasScalingPlan,
            sessionHostCount: hostPool.sessionHosts.length,
            totalSessions: hostPool.totalSessions,
            monthlyCostUsd: hostPool.monthlyCostUsd,
            alcanzable: hostPool.alcanzable,
            applicationGroupCount: hostPool.applicationGroups.length,
        });
        const sessionHostSavings = hostPool.sessionHosts.reduce((acc, sh) => acc + sh.potentialSavingUsd, 0);
        hostPool.potentialSavingUsd = cappedMonthlySavings(
            [...hostPool.remediationActions.map((a) => a.monthlySavingsUsd), sessionHostSavings],
            hostPool.monthlyCostUsd,
        );
    }

    // Consumo real de los perfiles. Las metricas de Files cuelgan del
    // sub-recurso `fileServices/default`, no de la cuenta de storage.
    const storage: AvdStorageResource[] = await Promise.all(
        storageRows.map(async (r) => {
            let usedBytes: number | null = null;
            let quotaBytes: number | null = null;
            let fileCount: number | null = null;
            let utilizacionPct: number | null = null;

            if (r.type === STORAGE_TYPE) {
                const m = await getAzureResourceMetricsSummary(credential, `${r.id}/fileServices/default`, [
                    "FileCapacity",
                    "FileShareCapacityQuota",
                    "FileCount",
                    "PercentFileShareUtilization",
                ]);
                usedBytes = m["FileCapacity"] ?? null;
                quotaBytes = m["FileShareCapacityQuota"] ?? null;
                fileCount = m["FileCount"] ?? null;
                utilizacionPct =
                    m["PercentFileShareUtilization"] ??
                    (usedBytes !== null && quotaBytes && quotaBytes > 0
                        ? Number(((usedBytes / quotaBytes) * 100).toFixed(1))
                        : null);
            }

            return {
                id: r.id,
                name: r.name,
                type: r.type,
                region: r.location || "unknown",
                resourceGroup: r.resourceGroup || "unknown",
                monthlyCostUsd: storageCosts.get(r.id.toLowerCase()) ?? 0,
                costDataAvailable: storageCosts.has(r.id.toLowerCase()),
                usedBytes,
                quotaBytes,
                fileCount,
                utilizacionPct,
            };
        }),
    );

    const hostPools = Array.from(hostPoolsById.values()).sort((a, b) => b.monthlyCostUsd - a.monthlyCostUsd);
    const monthlyComputeCostUsd = hostPools.reduce((acc, hp) => acc + hp.monthlyCostUsd, 0);
    const monthlyStorageCostUsd = storage.reduce((acc, s) => acc + s.monthlyCostUsd, 0);

    const workspaces: AvdWorkspace[] = workspaceRows.map((w) => ({
        id: w.id,
        name: w.name,
        friendlyName: prop(w, "friendlyName") || null,
        region: w.location || "unknown",
        resourceGroup: w.resourceGroup || "unknown",
        applicationGroupCount: appGroupsPorWorkspace.get(w.id.toLowerCase()) ?? 0,
    }));

    return {
        hostPools,
        workspaces,
        workspaceCount: workspaceRows.length,
        storage,
        summary: {
            hostPoolCount: hostPools.length,
            applicationGroupCount: appGroupRows.length,
            hostPoolsInalcanzables: hostPools.filter((hp) => !hp.alcanzable && hp.sessionHosts.length > 0).length,
            sessionHostCount: sessionHostRows.length,
            totalSessions: hostPools.reduce((acc, hp) => acc + hp.totalSessions, 0),
            monthlyComputeCostUsd,
            monthlyStorageCostUsd,
            monthlyCostUsd: monthlyComputeCostUsd + monthlyStorageCostUsd,
        },
    };
}
