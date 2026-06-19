export const isMockTenant = (tenantId: string) => {
    return [
        "11111111-2222-3333-4444-555555555555",
        "22222222-3333-4444-5555-666666666666",
        "44444444-5555-6666-7777-888888888888",
        "33333333-4444-5555-6666-777777777777",
        "demo_tenant"
    ].includes(tenantId);
};

export const getMockDataForRoute = (route: string, tenantId: string) => {
    if (!isMockTenant(tenantId)) return null;
    
    switch (route) {
        case 'advisor':
            return {
                success: true,
                recommendations: { Cost: [], Security: [], HighAvailability: [], Performance: [], OperationalExcellence: [] },
                subscriptions: [{ id: "mock-sub", name: "Demo Subscription" }],
                scores: { "mock-sub": { Cost: 82 } }
            };
        case 'rightsizing':
            return {
                success: true,
                recommendations: [
                    {
                        id: "mock-rec-1",
                        name: "app-prod-vm-01",
                        type: "Virtual Machine",
                        resourceId: "/subscriptions/mock-sub/resourceGroups/prod-rg/providers/Microsoft.Compute/virtualMachines/app-prod-vm-01",
                        currentSku: "Standard_D8s_v3",
                        targetSku: "Standard_D4s_v3",
                        savings: 215.50
                    },
                    {
                        id: "mock-rec-2",
                        name: "db-stage-vm-02",
                        type: "Virtual Machine",
                        resourceId: "/subscriptions/mock-sub/resourceGroups/stage-rg/providers/Microsoft.Compute/virtualMachines/db-stage-vm-02",
                        currentSku: "Standard_E8s_v4",
                        targetSku: "Standard_E2s_v4",
                        savings: 380.00
                    },
                    {
                        id: "mock-rec-3",
                        name: "worker-batch-10",
                        type: "Virtual Machine",
                        resourceId: "/subscriptions/mock-sub/resourceGroups/batch-rg/providers/Microsoft.Compute/virtualMachines/worker-batch-10",
                        currentSku: "Standard_F16s_v2",
                        targetSku: "Standard_F8s_v2",
                        savings: 412.20
                    },
                    {
                        id: "mock-rec-4",
                        name: "cache-node-01",
                        type: "Virtual Machine",
                        resourceId: "/subscriptions/mock-sub/resourceGroups/core-rg/providers/Microsoft.Compute/virtualMachines/cache-node-01",
                        currentSku: "Standard_D4ds_v5",
                        targetSku: "Standard_D2ds_v5",
                        savings: 105.80
                    },
                    {
                        id: "mock-rec-5",
                        name: "dev-bastion-vm",
                        type: "Virtual Machine",
                        resourceId: "/subscriptions/mock-sub/resourceGroups/dev-rg/providers/Microsoft.Compute/virtualMachines/dev-bastion-vm",
                        currentSku: "Standard_B4ms",
                        targetSku: "Standard_B2ms",
                        savings: 42.10
                    }
                ],
                subscriptions: ["mock-sub"]
            };
        case 'ttl':
            return {
                success: true,
                auditResults: {
                    expiringSoon: [],
                    expired: [
                        { id: "/subscriptions/mock-sub/resourceGroups/demo-rg", name: "demo-rg", type: "Resource Group", daysOverdue: 12 }
                    ],
                    missingTags: []
                }
            };
        case 'audit_full':
            return {
                success: true,
                tenantId,
                mode: "tenant-wide",
                auditResults: {
                    unattachedDisks: [
                        { id: "mock-disk-1", name: "db-backup-disk-old", resourceGroup: "db-rg", diskSizeGB: 512, location: "eastus", sku: "Premium_LRS", estimatedMonthlyCost: 76.8 },
                        { id: "mock-disk-2", name: "temp-worker-osdisk", resourceGroup: "batch-rg", diskSizeGB: 128, location: "eastus", sku: "StandardSSD_LRS", estimatedMonthlyCost: 9.6 }
                    ],
                    unusedVNetGateways: [],
                    emptyAppServicePlans: [
                        { id: "mock-asp", name: "dev-linux-plan", resourceGroup: "dev-rg", estimatedMonthlyCost: 45.0 }
                    ],
                    unattachedPublicIps: [
                        { id: "mock-ip-1", name: "old-ingress-ip", resourceGroup: "network-rg", estimatedMonthlyCost: 3.5 },
                        { id: "mock-ip-2", name: "vpn-test-ip", resourceGroup: "network-rg", estimatedMonthlyCost: 3.5 }
                    ],
                    unattachedNics: [
                        { id: "mock-nic-1", name: "worker-nic-old", resourceGroup: "batch-rg", estimatedMonthlyCost: 0 }
                    ],
                    longStoppedVMs: [
                        { id: "mock-vm-stopped", name: "legacy-app-server", resourceGroup: "legacy-rg", estimatedMonthlyCost: 35.0 }
                    ],
                    allVirtualMachines: [
                        { id: "mock-vm-1", name: "dev-bastion", resourceGroup: "dev-rg", powerState: "PowerState/running", subscriptionId: "mock-sub", location: "eastus", sku: "Standard_B2ms" },
                        { id: "mock-vm-2", name: "prod-db-node", resourceGroup: "prod-rg", powerState: "PowerState/running", subscriptionId: "mock-sub", location: "eastus", sku: "Standard_E8s_v4" },
                        { id: "mock-vm-3", name: "test-worker", resourceGroup: "test-rg", powerState: "PowerState/deallocated", subscriptionId: "mock-sub", location: "westus", sku: "Standard_D2s_v3" }
                    ],
                    emptyRgs: [
                        { id: "mock-empty-rg", name: "test-deployment-rg", resourceGroup: "test-deployment-rg", isHygiene: true }
                    ]
                }
            };
        case 'history':
            return {
                data: [
                    { scan_date: "2023-10-01", score: 85.5, impacted_resources: 12, potential_score_increase: 5.0 },
                    { scan_date: "2023-10-08", score: 88.0, impacted_resources: 10, potential_score_increase: 3.5 },
                    { scan_date: "2023-10-15", score: 92.5, impacted_resources: 5, potential_score_increase: 1.0 },
                    { scan_date: "2023-10-22", score: 94.0, impacted_resources: 3, potential_score_increase: 0.5 }
                ]
            };
        case 'sustainability':
            return {
                footprint: 12500.5,
                avoided: 3400.2,
                vmCount: 45,
                zombieCount: 8
            };
        case 'schedules':
            return {
                success: true,
                schedules: [
                    {
                        id: "sched-1",
                        name: "Dev Environment Nightly Shutdown",
                        description: "Apaga VMs de desarrollo a las 20:00 y enciende a las 08:00 (Lun-Vie).",
                        vmsAttached: 15,
                        estimatedSavings: 840.00,
                        status: "active"
                    },
                    {
                        id: "sched-2",
                        name: "AVD Weekend Stop",
                        description: "Apaga Azure Virtual Desktops durante el fin de semana.",
                        vmsAttached: 42,
                        estimatedSavings: 1250.50,
                        status: "active"
                    },
                    {
                        id: "sched-3",
                        name: "Data Pipeline Workers",
                        description: "Enciende workers de procesamiento solo durante la ventana de carga nocturna.",
                        vmsAttached: 8,
                        estimatedSavings: 620.00,
                        status: "paused"
                    }
                ]
            };
        case 'anomalies':
            return {
                success: true,
                anomalies: [
                    {
                        id: "anom-1",
                        date: new Date().toISOString(),
                        service: "Storage",
                        metric: "Bandwidth",
                        expectedCost: 150.00,
                        actualCost: 950.00,
                        severity: "High",
                        description: "Spike repentino en costos de transferencia de salida en Storage Account 'prodassets'."
                    },
                    {
                        id: "anom-2",
                        date: new Date(Date.now() - 86400000).toISOString(),
                        service: "Virtual Machines",
                        metric: "Compute Hours",
                        expectedCost: 400.00,
                        actualCost: 520.00,
                        severity: "Medium",
                        description: "Aumento inusual en horas de cómputo en el grupo de recursos 'data-processing'."
                    }
                ]
            };
        case 'copilot_history':
            return {
                success: true,
                history: [
                    {
                        id: "msg-1",
                        role: "user",
                        content: "¿Cómo puedo reducir mis costos de almacenamiento en Azure?"
                    },
                    {
                        id: "msg-2",
                        role: "assistant",
                        content: "Para reducir costos de almacenamiento, te recomiendo:\n1. Eliminar discos huérfanos (actualmente tienes 2 discos sin asociar que cuestan $86.4/mes).\n2. Mover blobs antiguos a tiers 'Cool' o 'Archive' usando Lifecycle Management.\n3. Eliminar snapshots antiguos."
                    },
                    {
                        id: "msg-3",
                        role: "user",
                        content: "Borra esos discos huérfanos por mí."
                    },
                    {
                        id: "msg-4",
                        role: "assistant",
                        content: "¡Listo! He eliminado los 2 discos huérfanos ('db-backup-disk-old' y 'temp-worker-osdisk'). Has ahorrado $86.40 mensuales."
                    }
                ]
            };
        default:
            return { success: true, message: "Mock data not defined for this route" };
    }
};
