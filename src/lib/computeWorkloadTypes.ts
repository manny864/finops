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

export interface WebAppWorkloadItem extends ComputeWorkloadItemBase {
    metricA?: string; // CpuPercentage avg/max/total summary
    metricB?: string; // MemoryPercentage avg/max/total summary
}

export interface FunctionWorkloadItem extends ComputeWorkloadItemBase {
    metricA?: string; // FunctionExecutionCount summary
    metricB?: string; // FunctionExecutionUnits or CpuTime summary
}

export interface VirtualMachineWorkloadItem extends ComputeWorkloadItemBase {
    metricA?: string; // Percentage CPU summary
    metricB?: string; // Available Memory Bytes summary
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
