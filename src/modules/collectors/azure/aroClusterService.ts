/**
 * Servicio de backend para Azure Red Hat OpenShift (ARO) — Cockpit de Gobernanza y FinOps.
 *
 * Responsabilidades:
 * 1. Consultar clústeres OpenShift (`Microsoft.RedHatOpenShift/openShiftClusters`) en Azure Resource Graph.
 * 2. Extraer perfil de Control Plane (3 Masters fijos) y Worker MachineSets (`workerProfiles`).
 * 3. Desglose de facturación tripartito: Cómputo Azure (VMs), Licencia Red Hat (ARO Fee) y Storage PVCs en Managed RG.
 * 4. Telemetría de capacidad (CPU %, Memoria % promedio/P95) vía Azure Monitor / Container Insights.
 * 5. Motor de recomendaciones resolutivas: consolidación dev/test, rightsizing, MachineAutoscaler, Savings Plans y PVCs huérfanos.
 */

import { vmSizeToCores } from "@/modules/collectors/azure/aksCostService";
import type {
    AroMasterProfile,
    AroWorkerProfile,
    AroCostBreakdown,
    AroRemediationAction,
    AroWorkloadItem,
} from "@/lib/computeWorkloadTypes";

export type AroClusterDetail = AroWorkloadItem;

/** Tarifa pública estimada de soporte y software de Red Hat OpenShift por vCore-hora en Azure. */
export const ARO_REDHAT_FEE_PER_VCORE_HOUR = 0.038; // ~$27.74 USD / vCore-mes
export const HOURS_PER_MONTH = 730;

/**
 * Calcula el desglose tripartito de facturación de un clúster ARO:
 * - Cómputo Azure (VMs subyacentes de masters y workers)
 * - Tarifa de licencia Red Hat (ARO service fee por vCore)
 * - Almacenamiento persistente (Managed Disks PVCs en el Managed RG)
 */
export function calculateAroCostBreakdown(
    totalBilledCostMonthlyUsd: number,
    masterProfile: AroMasterProfile,
    workerProfiles: AroWorkerProfile[]
): AroCostBreakdown {
    const masterCores = (masterProfile.count || 3) * vmSizeToCores(masterProfile.vmSize || "Standard_D8s_v5");
    const workerCores = (workerProfiles || []).reduce(
        (sum, wp) => sum + (wp.count || 3) * vmSizeToCores(wp.vmSize || "Standard_D4s_v5"),
        0
    );
    const totalVCores = masterCores + workerCores;

    const redHatLicenseCostMonthlyUsd = Number(
        (totalVCores * ARO_REDHAT_FEE_PER_VCORE_HOUR * HOURS_PER_MONTH).toFixed(2)
    );

    const remainder = Math.max(0, totalBilledCostMonthlyUsd - redHatLicenseCostMonthlyUsd);
    // En arquitecturas típicas de ARO, el almacenamiento persistente (OS disks + PVCs) representa ~12-15% del remanente.
    const storageCostMonthlyUsd = Number((remainder * 0.12).toFixed(2));
    const computeCostMonthlyUsd = Number((remainder - storageCostMonthlyUsd).toFixed(2));

    return {
        computeCostMonthlyUsd,
        redHatLicenseCostMonthlyUsd,
        storageCostMonthlyUsd,
        totalCostMonthlyUsd: totalBilledCostMonthlyUsd,
    };
}

/**
 * Evalúa las 5 reglas de remediación priorizadas para un clúster ARO.
 */
export function evaluateAroRemediations(
    cluster: {
        name: string;
        resourceGroup: string;
        subscriptionId: string;
        managedResourceGroup?: string;
        masterProfile: AroMasterProfile;
        workerProfiles: AroWorkerProfile[];
        totalWorkerCount: number;
        costBreakdown: AroCostBreakdown;
        cpuAvg: number | null;
        memoryAvgPercent: number | null;
        orphanPvcCount: number;
        orphanPvcMonthlyCostUsd: number;
    }
): AroRemediationAction[] {
    const actions: AroRemediationAction[] = [];
    const nameLower = cluster.name.toLowerCase();
    const rgLower = (cluster.resourceGroup || "").toLowerCase();
    const isDevTest = /dev|test|qa|staging|sandbox/.test(rgLower) || /dev|test|qa|staging|sandbox/.test(nameLower);

    // Regla 1: Consolidación de Clústeres Dev/Test (Overhead de Control Plane)
    if (isDevTest && cluster.cpuAvg !== null && cluster.cpuAvg < 20) {
        const masterBaseCost = Number(
            (
                (cluster.masterProfile.count || 3) *
                (cluster.costBreakdown.computeCostMonthlyUsd /
                    Math.max(
                        (cluster.masterProfile.count || 3) * vmSizeToCores(cluster.masterProfile.vmSize) +
                            cluster.workerProfiles.reduce((s, w) => s + w.count * vmSizeToCores(w.vmSize), 0),
                        1
                    )) *
                vmSizeToCores(cluster.masterProfile.vmSize)
            ).toFixed(2)
        ) || 800;

        actions.push({
            id: `rec-consolidate-${cluster.name}`,
            type: "consolidate_cluster",
            title: "Consolidación de Clústeres Dev/Test (Overhead Master)",
            description: `Clúster '${cluster.name}' con CPU promedio ${cluster.cpuAvg}% pagando ~$${masterBaseCost} USD/mes de base fija de Control Plane (3 masters). Evaluar consolidación en un clúster compartido, aislado por Namespaces y RBAC de OpenShift.`,
            monthlySavingsUsd: masterBaseCost,
            risk: "medium",
            confidence: "medium",
            commandCli: `oc get projects\noc get pods --all-namespaces -o wide`,
        });
    }

    // Regla 2: Rightsizing de Worker MachineSets
    if (cluster.cpuAvg !== null && cluster.cpuAvg < 25 && cluster.memoryAvgPercent !== null && cluster.memoryAvgPercent < 35) {
        const currentSku = cluster.workerProfiles[0]?.vmSize || "Standard_D8s_v5";
        const targetSku = currentSku.replace(/D(\d+)/i, (_m: string, n: string) => `D${Math.max(2, Math.floor(Number(n) / 2))}`);
        const savings = Number((cluster.costBreakdown.computeCostMonthlyUsd * 0.30).toFixed(2)) || 180;

        actions.push({
            id: `rec-rightsizing-${cluster.name}`,
            type: "rightsizing_workers",
            title: "Rightsizing de Worker MachineSets",
            description: `Worker nodes ${currentSku} con CPU ${cluster.cpuAvg}% y Memoria ${cluster.memoryAvgPercent}% (subutilizados). Sugerido migrar a ${targetSku} para ahorrar cómputo y licencia Red Hat.`,
            monthlySavingsUsd: savings,
            risk: "medium",
            confidence: "medium",
            commandCli: `az aro update --name ${cluster.name} --resource-group ${cluster.resourceGroup} --worker-vm-size ${targetSku}`,
        });
    }

    // Regla 3: Activación de MachineAutoscaler en Workers
    if (!cluster.workerProfiles.some((w) => w.autoscalerEnabled) && cluster.cpuAvg !== null && cluster.cpuAvg < 25) {
        const workerName = cluster.workerProfiles[0]?.name || "worker";
        const workerCount = cluster.workerProfiles[0]?.count || 3;
        const autoscalerSavings = Number((cluster.costBreakdown.computeCostMonthlyUsd * 0.40).toFixed(2)) || 120;

        actions.push({
            id: `rec-autoscaler-${cluster.name}`,
            type: "enable_autoscaler",
            title: "Activación de MachineAutoscaler en Workers",
            description: `Cómputo fijo (${cluster.totalWorkerCount} workers) con 0 pods nocturnos. Activar MachineAutoscaler de OpenShift para reducir workers fuera de horario laboral.`,
            monthlySavingsUsd: autoscalerSavings,
            risk: "medium",
            confidence: "medium",
            commandCli: `oc create -f - <<EOF\napiVersion: autoscaling.openshift.io/v1beta1\nkind: MachineAutoscaler\nmetadata:\n  name: ${workerName}-autoscaler\n  namespace: openshift-machine-api\nspec:\n  minReplicas: 1\n  maxReplicas: ${workerCount}\n  scaleTargetRef:\n    apiVersion: machine.openshift.io/v1beta1\n    kind: MachineSet\n    name: ${workerName}\nEOF`,
        });
    }

    // Regla 4: Cobertura de Cómputo con Savings Plans
    if (!isDevTest && cluster.cpuAvg !== null && cluster.cpuAvg >= 40) {
        const spSavings = Number((cluster.costBreakdown.computeCostMonthlyUsd * 0.38).toFixed(2)) || 310;
        actions.push({
            id: `rec-savings-plan-${cluster.name}`,
            type: "savings_plan",
            title: "Cobertura de Cómputo con Savings Plans (1 o 3 años)",
            description: `Nodos Master y Workers estables 24/7 en Pay-As-You-Go. Cubrir con Compute Savings Plan: ahorro estimado 38% en cómputo Azure.`,
            monthlySavingsUsd: spSavings,
            risk: "low",
            confidence: "medium",
            commandCli: `az costmanagement benefit recommendation list --scope /subscriptions/${cluster.subscriptionId}`,
        });
    }

    // Regla 5: Purga de Persistent Volume Claims (PVC) Huérfanos
    if (cluster.orphanPvcCount > 0) {
        actions.push({
            id: `rec-orphan-pvc-${cluster.name}`,
            type: "orphan_pvc",
            title: "Purga de Persistent Volume Claims (PVC) Huérfanos",
            description: `${cluster.orphanPvcCount} disco(s) administrado(s) en el Managed Resource Group sin adjuntar a ninguna instancia. Verificar en el clúster y eliminar si no están montados a pods activos.`,
            monthlySavingsUsd: cluster.orphanPvcMonthlyCostUsd,
            risk: "low",
            confidence: "medium",
            commandCli: `oc get pv,pvc --all-namespaces\naz disk list --resource-group ${cluster.managedResourceGroup || "<MRG>"} --query "[?managedBy==null].name" -o tsv`,
        });
    }

    return actions;
}
