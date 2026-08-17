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
    monthlyCostUsd: number;
    metricA?: string;
    metricB?: string;
}

export interface AppServiceRemediationAction {
    id: string;
    type: "zombie_plan" | "app_packing" | "modernize_sku" | "scale_workers" | "idle_slots" | "always_on";
    title: string;
    description: string;
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
    title: string;
    description: string;
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
    title: string;
    description: string;
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
    title: string;
    description: string;
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

export interface AroWorkloadItem extends ComputeWorkloadItemBase {
    metricA?: string; // node_cpu_utilization_percentage summary
    metricB?: string; // node_memory_utilization_percentage summary
}

export interface ComputeWorkloadData<TItem extends ComputeWorkloadItemBase = ComputeWorkloadItemBase> {
    summary: ComputeSummary;
    items: TItem[];
}

export interface ComputeWorkloadApiResponse<TItem extends ComputeWorkloadItemBase = ComputeWorkloadItemBase> {
    ok: boolean;
    mock: boolean;
    resourceExists: boolean;
    dataAvailable: boolean;
    message?: string;
    data: ComputeWorkloadData<TItem>;
    errors?: Array<{ code: string; detail?: string }>;
}
