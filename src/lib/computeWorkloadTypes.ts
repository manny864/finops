export type ComputeFamily = "webapps" | "functions" | "vms" | "vmss" | "aro";

export interface ComputeSummary {
    resourceCount: number;
    totalMonthlyCostUsd: number;
    advisorRecommendations?: number;
}

export interface ComputeWorkloadItemBase {
    id: string;
    name: string;
    type: string;
    region: string;
    resourceGroup: string;
    subscriptionName: string;
    state: string;
    sku: string;
    /** Gasto ACUMULADO del mes en curso (MTD), no la tarifa mensual del SKU. */
    monthlyCostUsd: number;
    /**
     * Proyección a fin de mes de este recurso.
     *
     * La calcula la API y no el board porque el run-rate depende de la fecha de
     * creación: para un plan de 5 horas hay que dividir el acumulado por esas
     * horas, no por los días transcurridos del mes. El board sólo conoce el
     * total agregado y proyectaría de menos.
     */
    forecastMonthEndUsd?: number;
    /**
     * false cuando Cost Management todavía no tiene facturación de este recurso
     * (creado hace horas, o la suscripción sin permiso de lectura de costos).
     *
     * Antes en ese caso se mostraba el precio de lista del SKU como si fuera
     * gasto real. La UI ahora distingue "no gastó nada" de "no sabemos": un
     * importe inventado en un cockpit de costos es peor que un vacío honesto.
     */
    costDataAvailable?: boolean;
    metricA?: string;
    metricB?: string;
}

export interface AppServiceRemediationAction {
    id: string;
    type: "zombie_plan" | "app_packing" | "modernize_sku" | "scale_workers" | "idle_slots" | "always_on";
    /**
     * Claves i18n del titulo y la descripcion, en el namespace
     * `ComputeRecommendations`. Van claves y no la frase armada porque **este
     * payload se cachea en Redis con una clave que no incluye el locale**: armar
     * el texto en el servidor le sirve al segundo lector el idioma del primero.
     */
    titleKey: string;
    descKey: string;
    /** Valores a interpolar en las dos claves. Numeros y nombres, nunca frases. */
    params?: Record<string, string | number>;
    monthlySavingsUsd: number;
    risk: "low" | "medium" | "high";
    confidence: "low" | "medium" | "high";
    commandCli?: string;
    commandTerraform?: string;
    commandArm?: string;
}

export interface HostedWebAppSummary {
    name: string;
    state: "Running" | "Stopped" | string;
    slotsCount: number;
    slotNames?: string[];
    alwaysOn?: boolean;
    httpRequests?: number;
    http5xx?: number;
    http4xx?: number;
}

export interface AppServiceWorkloadItem extends ComputeWorkloadItemBase {
    os: "Linux" | "Windows" | string;
    tier: string;
    numberOfWorkers: number;
    autoscaleMode: "manual" | "metric" | "schedule";
    zoneRedundant: boolean;
    appsCount: number;
    slotsCount: number;
    hostedApps: HostedWebAppSummary[];
    cpuAvg?: number;
    cpuMax?: number;
    memoryPercentAvg?: number;
    memoryPercentMax?: number;
    totalRequests?: number;
    http5xxRate?: number;
    http4xxRate?: number;
    isZombie?: boolean;
    potentialSavingUsd?: number;
    remediationActions?: AppServiceRemediationAction[];
}

export interface WebAppWorkloadItem extends AppServiceWorkloadItem {
    metricA?: string; // CpuPercentage avg/max/total summary
    metricB?: string; // MemoryPercentage avg/max/total summary
}

export type FunctionHostingPlanType =
    | "Consumption (Y1)"
    | "Elastic Premium (EP1)"
    | "Elastic Premium (EP2)"
    | "Elastic Premium (EP3)"
    | "Dedicated (App Service Plan)"
    | "Flex Consumption"
    | string;

export interface FunctionAppRemediationAction {
    id: string;
    type: "downgrade_consumption" | "telemetry_sampling" | "optimize_memory" | "zombie_app" | "storage_polling";
    /**
     * Claves i18n del titulo y la descripcion, en el namespace
     * `ComputeRecommendations`. Van claves y no la frase armada porque **este
     * payload se cachea en Redis con una clave que no incluye el locale**: armar
     * el texto en el servidor le sirve al segundo lector el idioma del primero.
     */
    titleKey: string;
    descKey: string;
    /** Valores a interpolar en las dos claves. Numeros y nombres, nunca frases. */
    params?: Record<string, string | number>;
    monthlySavingsUsd: number;
    risk: "low" | "medium" | "high";
    confidence: "low" | "medium" | "high";
    commandCli?: string;
    commandTerraform?: string;
    commandHostJson?: string;
    commandArm?: string;
}

export interface FunctionAppWorkloadItem extends ComputeWorkloadItemBase {
    hostingPlan: FunctionHostingPlanType;
    hostingPlanType: "consumption" | "elastic_premium" | "dedicated" | "flex_consumption";
    runtimeStack: string; // e.g. "Node.js 20", ".NET 8", "Python 3.11", "Java 17"
    os: "Linux" | "Windows" | string;
    preWarmedInstances?: number;
    // Execution Serverless Metrics
    executionCountMtd?: number;
    executionUnitsGbs?: number; // GB-seconds
    avgDurationMs?: number;
    errorRatePercent?: number;
    http5xxCount?: number;
    http4xxCount?: number;
    // Linked Dependencies & Costs
    storageAccountName?: string;
    storageCostMonthlyUsd?: number;
    appInsightsName?: string;
    appInsightsCostMonthlyUsd?: number;
    telemetryIngestionGbMonthly?: number;
    computeCostMonthlyUsd?: number;
    totalCostMonthlyUsd?: number;
    // Governance & Remediation
    isZombie?: boolean;
    isOverprovisioned?: boolean;
    hasTelemetryLeak?: boolean;
    potentialSavingUsd?: number;
    remediationActions?: FunctionAppRemediationAction[];
}

export interface FunctionWorkloadItem extends FunctionAppWorkloadItem {
    metricA?: string; // FunctionExecutionCount summary
    metricB?: string; // FunctionExecutionUnits or CpuTime summary
}

export interface VmRemediationAction {
    id: string;
    type: "rightsizing_sku" | "deallocated_disk" | "power_schedule" | "ahub" | "abandoned_vm";
    /**
     * Claves i18n del titulo y la descripcion, en el namespace
     * `ComputeRecommendations`. Van claves y no la frase armada porque **este
     * payload se cachea en Redis con una clave que no incluye el locale**: armar
     * el texto en el servidor le sirve al segundo lector el idioma del primero.
     */
    titleKey: string;
    descKey: string;
    /** Valores a interpolar en las dos claves. Numeros y nombres, nunca frases. */
    params?: Record<string, string | number>;
    targetSku?: string;
    monthlySavingsUsd: number;
    risk: "low" | "medium" | "high";
    confidence: "low" | "medium" | "high";
    commandCli?: string;
    commandTerraform?: string;
    commandPowerShell?: string;
    commandArm?: string;
}

export interface VirtualMachineWorkloadItem extends ComputeWorkloadItemBase {
    // Hardware Profile
    vCpu: number;
    ramGb: number;
    os: "Linux" | "Windows" | string;
    powerState: "running" | "deallocated" | "stopped" | string;
    // Storage Profile
    osDiskType: "Premium_LRS" | "StandardSSD_LRS" | "Standard_LRS" | string;
    osDiskSizeGb: number;
    dataDisksCount: number;
    dataDisksTotalGb: number;
    // Licensing & Networking
    licenseType: "Windows_Server" | "Windows_Client" | "None" | string;
    ahubActive: boolean;
    priority: "Regular" | "Spot" | "LowPriority" | string;
    publicIp?: string | null;
    hasPublicIp: boolean;
    // Performance & Operational Metrics
    cpuAvg?: number;
    cpuMax?: number;
    memoryInUsePercent?: number;
    memoryTotalGb?: number;
    memoryAvailableGb?: number;
    uptimePercent?: number;
    iops?: number;
    // Cost Breakdown
    computeCostMonthlyUsd: number;
    storageCostMonthlyUsd: number;
    totalCostMonthlyUsd: number;
    // FinOps Governance
    isZombie?: boolean;
    potentialSavingUsd?: number;
    remediationActions?: VmRemediationAction[];
    metricA?: string; // Percentage CPU summary
    metricB?: string; // MemoryInUsePercentage or Available Memory Bytes summary
}

export interface VmssRemediationAction {
    id: string;
    type: "rightsizing" | "autoscale" | "spot" | "ahub" | "os_disk";
    /**
     * Claves i18n del titulo y la descripcion, en el namespace
     * `ComputeRecommendations`. Van claves y no la frase armada porque **este
     * payload se cachea en Redis con una clave que no incluye el locale**: armar
     * el texto en el servidor le sirve al segundo lector el idioma del primero.
     */
    titleKey: string;
    descKey: string;
    /** Valores a interpolar en las dos claves. Numeros y nombres, nunca frases. */
    params?: Record<string, string | number>;
    monthlySavingsUsd: number;
    risk: "low" | "medium" | "high";
    confidence: "low" | "medium" | "high";
    commandCli?: string;
    commandTerraform?: string;
    commandArm?: string;
}

export interface VmssWorkloadItem extends ComputeWorkloadItemBase {
    metricA?: string; // Percentage CPU summary (Avg)
    metricB?: string; // Inbound/Outbound flow or IOPS summary
    capacity: number; // Instancias actuales
    minCapacity: number;
    maxCapacity: number;
    autoscaleMode: "manual" | "metric" | "schedule";
    orchestrationMode: "Flexible" | "Uniform";
    priority: "Regular" | "Spot";
    spotPercentage: number;
    licenseType: "Windows_Server" | "Windows_Client" | "None" | string;
    ahubActive: boolean;
    osDiskType: "Premium_LRS" | "StandardSSD_LRS" | "Standard_LRS" | string;
    zones?: string[];
    cpuAvg?: number;
    cpuMax?: number;
    memoryUsagePercent?: number;
    iops?: number;
    networkFlows?: number;
    recommendedSku?: string;
    potentialSavingUsd?: number;
    remediationActions?: VmssRemediationAction[];
}

export interface AroMasterProfile {
    vmSize: string; // ej. "Standard_D8s_v5"
    count: number; // fijo en 3 por diseño de OpenShift (etcd quorum)
}

export interface AroWorkerProfile {
    name: string; // nombre del MachineSet/worker profile
    vmSize: string; // ej. "Standard_D4s_v5"
    count: number; // capacidad actual de workers
    diskSizeGb?: number;
    autoscalerEnabled: boolean;
    minCount?: number;
    maxCount?: number;
}

export interface AroManagedRgResource {
    name: string;
    type: string;
    category: "master_vm" | "worker_vm" | "load_balancer" | "storage" | "network" | "disk";
    sku?: string;
    status?: string;
    location?: string;
    costMonthlyUsd?: number;
}

export interface AroCostBreakdown {
    computeCostMonthlyUsd: number; // VMs de Azure (master + workers)
    redHatLicenseCostMonthlyUsd: number; // ARO service fee por vCore
    storageCostMonthlyUsd: number; // Managed Disks (OS + PVCs) en el Managed Resource Group
    totalCostMonthlyUsd: number;
}

export interface AroRemediationAction {
    id: string;
    type: "consolidate_cluster" | "rightsizing_workers" | "enable_autoscaler" | "savings_plan" | "orphan_pvc";
    /**
     * Claves i18n del titulo y la descripcion, en el namespace
     * `ComputeRecommendations`. Van claves y no la frase armada porque **este
     * payload se cachea en Redis con una clave que no incluye el locale**: armar
     * el texto en el servidor le sirve al segundo lector el idioma del primero.
     */
    titleKey: string;
    descKey: string;
    /** Valores a interpolar en las dos claves. Numeros y nombres, nunca frases. */
    params?: Record<string, string | number>;
    monthlySavingsUsd: number;
    risk: "low" | "medium" | "high";
    confidence: "low" | "medium" | "high";
    commandCli?: string;
    commandTerraform?: string;
    commandArm?: string;
    yamlManifest?: string;
}

export interface AvdRemediationAction {
    id: string;
    type: "rightsizing_sku" | "ahub" | "enable_scaling_plan" | "consolidate_host_pool" | "idle_personal_host";
    /**
     * Claves i18n del titulo y la descripcion, en el namespace
     * `ComputeRecommendations`. Van claves y no la frase armada porque **este
     * payload se cachea en Redis con una clave que no incluye el locale**: armar
     * el texto en el servidor le sirve al segundo lector el idioma del primero.
     */
    titleKey: string;
    descKey: string;
    /** Valores a interpolar en las dos claves. Numeros y nombres, nunca frases. */
    params?: Record<string, string | number>;
    monthlySavingsUsd: number;
    risk: "low" | "medium" | "high";
    confidence: "low" | "medium" | "high";
    commandCli?: string;
    commandTerraform?: string;
    commandArm?: string;
}

/* Union type for all remediation actions across compute workload families */
export type RemediationAction = VmRemediationAction | AroRemediationAction | AvdRemediationAction;

export interface AroWorkloadItem extends ComputeWorkloadItemBase {
    // Identidad & Red
    openshiftVersion: string; // ej. "4.21.22"
    openShiftLifecycleStatus?: "active_support" | "extended_support" | "end_of_life";
    apiVisibility: "Public" | "Private" | string;
    ingressVisibility: "Public" | "Private" | string;
    provisioningState: string;
    managedResourceGroup?: string;
    managedRgResources?: AroManagedRgResource[];
    // Arquitectura & MachineSets
    masterProfile: AroMasterProfile;
    workerProfiles: AroWorkerProfile[];
    totalWorkerCount: number;
    autoscalerActive: boolean;
    orphanPvcCount: number;
    orphanPvcMonthlyCostUsd: number;
    storagePvcCount?: number;
    storagePvcDescription?: string;
    // Métricas de capacidad (best-effort, requiere Container Insights o Azure Monitor VMs; puede ser null)
    cpuAvg?: number | null;
    cpuMax?: number | null;
    memoryAvgPercent?: number | null;
    metricsAvailable: boolean;
    // FinOps
    costBreakdown: AroCostBreakdown;
    isDevTestCandidate?: boolean;
    potentialSavingUsd?: number;
    remediationActions?: AroRemediationAction[];
    metricA?: string; // CPU % avg summary (o "N/D")
    metricB?: string; // Memoria % avg summary (o "N/D")
}

export type AroClusterDetail = AroWorkloadItem;

export interface ComputeWorkloadData<TItem extends ComputeWorkloadItemBase = ComputeWorkloadItemBase> {
    summary: ComputeSummary;
    items: TItem[];
}

export interface ComputeWorkloadApiResponse<TItem extends ComputeWorkloadItemBase = ComputeWorkloadItemBase> {
    ok: boolean;
    mock: boolean;
    resourceExists: boolean;
    dataAvailable: boolean;
    /**
     * Suscripciones cuya consulta de costos falló, con el motivo de Azure.
     *
     * Se expone la CAUSA clasificada, sin GUIDs ni el texto crudo de Azure:
     * "Customer does not have the privilege to see the cost (Request ID: ...)"
     * no le dice nada a quien usa el producto y filtra detalle interno. El
     * mensaje completo queda en los logs del servidor.
     */
    costIssues?: Array<{ kind: "no_access" | "throttled" | "unknown" }>;
    message?: string;
    data: ComputeWorkloadData<TItem>;
    errors?: Array<{ code: string; detail?: string }>;
}
