export const isMockTenant = (tenantId: string) => {
    return [
        "11111111-2222-3333-4444-555555555555",
        "22222222-3333-4444-5555-666666666666",
        "44444444-5555-6666-7777-888888888888",
        "33333333-4444-5555-6666-777777777777",
        "demo_tenant"
    ].includes(tenantId);
};

export const getMockDataForRoute = (route: string, arg2: string): any => {
    // Arg2 can be either a tenantId (from backend) or a tier string (from frontend mock override)
    const isTenantId = arg2 && arg2.length > 20; // tenantIds are GUIDs
    if (isTenantId && !isMockTenant(arg2)) {
        return null; // Return real data if it's not a mock tenant
    }
    
    const tier = (isTenantId ? 'essential' : arg2) || 'essential';
    
    let multiplier = 1;
    if (tier.toLowerCase() === 'pro') multiplier = 3;
    if (tier.toLowerCase() === 'business') multiplier = 10;
    if (tier.toLowerCase() === 'enterprise') multiplier = 50;

    switch (route) {
        case 'advisor':
            return {
                success: true,
                recommendations: { Cost: [], Security: [], HighAvailability: [], Performance: [], OperationalExcellence: [] },
                subscriptions: [{ id: "mock-sub", name: "Demo Subscription" }],
                scores: { "mock-sub": { Cost: Math.min(98, 82 + multiplier) } }
            };
        case 'rightsizing':
            return {
                success: true,
                data: [
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
                tenantId: 'mock-tenant',
                mode: "tenant-wide",
                auditResults: {
                    unattachedDisks: Array.from({length: 2 * multiplier}).map((_, i) => (
                        { id: `mock-disk-${i}`, name: `db-backup-disk-${i}`, resourceGroup: "db-rg", diskSizeGB: 512, location: "eastus", sku: "Premium_LRS", estimatedMonthlyCost: 76.8 }
                    )),
                    unusedVNetGateways: [],
                    emptyAppServicePlans: Array.from({length: multiplier}).map((_, i) => (
                        { id: `mock-asp-${i}`, name: `dev-linux-plan-${i}`, resourceGroup: "dev-rg", estimatedMonthlyCost: 45.0 }
                    )),
                    unattachedPublicIps: Array.from({length: 2 * multiplier}).map((_, i) => (
                        { id: `mock-ip-${i}`, name: `old-ingress-ip-${i}`, resourceGroup: "network-rg", estimatedMonthlyCost: 3.5 }
                    )),
                    unattachedNics: Array.from({length: 3 * multiplier}).map((_, i) => (
                        { id: `mock-nic-${i}`, name: `worker-nic-${i}`, resourceGroup: "batch-rg", estimatedMonthlyCost: 0 }
                    )),
                    longStoppedVMs: Array.from({length: multiplier}).map((_, i) => (
                        { id: `mock-vm-stopped-${i}`, name: `legacy-app-server-${i}`, resourceGroup: "legacy-rg", estimatedMonthlyCost: 35.0 }
                    )),
                    allVirtualMachines: [
                        { id: "mock-vm-1", name: "dev-bastion", resourceGroup: "dev-rg", powerState: "PowerState/running", subscriptionId: "mock-sub", location: "eastus", sku: "Standard_B2ms", tags: { CostCenter: "IT", Environment: "Dev", Owner: "TeamA" } },
                        { id: "mock-vm-2", name: "prod-db-node", resourceGroup: "prod-rg", powerState: "PowerState/running", subscriptionId: "mock-sub", location: "eastus", sku: "Standard_E8s_v4", tags: { CostCenter: "Data", Environment: "Prod" } },
                        { id: "mock-vm-3", name: "test-worker", resourceGroup: "test-rg", powerState: "PowerState/deallocated", subscriptionId: "mock-sub", location: "westus", sku: "Standard_D2s_v3", tags: {} }
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
        case 'billing':
            return {
                success: true,
                data: Array.from({length: 30}).map((_, i) => ({
                    date: new Date(Date.now() - (29 - i) * 86400000).toISOString().split('T')[0],
                    cost: (150 + Math.random() * 50) * multiplier,
                    service: i % 2 === 0 ? 'Virtual Machines' : 'Storage',
                    resourceGroup: 'demo-rg'
                }))
            };
        case 'tags_compliance':
            return {
                success: true,
                complianceScore: 85,
                resources: [
                    { id: 'res1', name: 'demo-vm', missingTags: ['Environment', 'Owner'] },
                    { id: 'res2', name: 'demo-db', missingTags: ['CostCenter'] }
                ]
            };
        case 'rates':
            return {
                success: true,
                data: [
                    { service: 'Virtual Machines', rate: 0.15, unit: '1 Hour' },
                    { service: 'Storage', rate: 0.05, unit: '1 GB/Month' }
                ]
            };
        case 'network':
            return {
                success: true,
                data: [
                    { resource: 'vnet-1', traffic: '150GB', cost: 12.50 },
                    { resource: 'vpn-gw', traffic: '500GB', cost: 45.00 }
                ]
            };
        case 'licenses':
            return {
                success: true,
                data: [
                    { name: 'Windows Server 2022', count: 15, utilization: '80%' },
                    { name: 'SQL Server Standard', count: 4, utilization: '100%' }
                ]
            };
        case 'chargeback':
            return {
                success: true,
                data: [
                    { department: 'Engineering', cost: 4500.00, percentage: 60 },
                    { department: 'Marketing', cost: 1500.00, percentage: 20 },
                    { department: 'Sales', cost: 1500.00, percentage: 20 }
                ]
            };
        case 'budgets':
            return {
                success: true,
                data: [
                    { name: 'Q3 Cloud Budget', limit: 10000 * multiplier, currentSpend: 7500 * multiplier, status: 'On Track' },
                    { name: 'Marketing Campaign', limit: 2000 * multiplier, currentSpend: 2100 * multiplier, status: 'Exceeded' }
                ]
            };
        case 'budgets_burn':
            return {
                success: true,
                burnData: [
                    { costCenter: 'IT & Ops', budget: 15000 * multiplier, actual: 12000 * multiplier },
                    { costCenter: 'Marketing', budget: 5000 * multiplier, actual: 4800 * multiplier },
                    { costCenter: 'R&D', budget: 8000 * multiplier, actual: 9500 * multiplier },
                    { costCenter: 'HR', budget: 2000 * multiplier, actual: 1200 * multiplier }
                ]
            };
        case 'tags':
            return {
                success: true,
                policies: [
                    { tag_key: 'CostCenter', required: true },
                    { tag_key: 'Environment', required: true },
                    { tag_key: 'Owner', required: true }
                ]
            };
        case 'maturity':
            return {
                success: true,
                score: Math.min(100, 40 + (multiplier * 10)),
                breakdown: {
                    visibility: Math.min(100, 50 + (multiplier * 8)),
                    optimization: Math.min(100, 40 + (multiplier * 10)),
                    governance: Math.min(100, 30 + (multiplier * 12)),
                    automation: Math.min(100, 20 + (multiplier * 15))
                }
            };
        case 'users':
            return {
                success: true,
                isSuperAdmin: true,
                users: [
                    { id: 1, email: "admin@empresa-demo.com", display_name: "Director IT", role: "Admin", entra_oid: "demo-oid-1", system_role: "USER" },
                    { id: 2, email: "devops@empresa-demo.com", display_name: "Ingeniero DevOps", role: "Colaborador", entra_oid: "demo-oid-2", system_role: "USER" },
                    { id: 3, email: "finanzas@empresa-demo.com", display_name: "Auditor Financiero", role: "Reader", entra_oid: "demo-oid-3", system_role: "USER" }
                ]
            };
        case 'zero_cost':
            return {
                success: true,
                data: [
                    { id: "/subscriptions/demo/resourceGroups/rg-webapp/providers/Microsoft.Web/serverfarms/asp-frontend-free", name: "asp-frontend-free", type: "microsoft.web/serverfarms", resourceGroup: "rg-webapp", Motivo: "Capa Gratuita (Free SKU)", skuName: "F1" },
                    { id: "/subscriptions/demo/resourceGroups/rg-backend/providers/Microsoft.Web/serverfarms/asp-backend-dev", name: "asp-backend-dev", type: "microsoft.web/serverfarms", resourceGroup: "rg-backend", Motivo: "Capa Gratuita (Free SKU)", skuName: "Free" },
                    { id: "/subscriptions/demo/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/vnet-core-hub", name: "vnet-core-hub", type: "microsoft.network/virtualnetworks", resourceGroup: "rg-network", Motivo: "Servicio de Gestión / Arquitectura (Sin costo base)", skuName: "N/A" },
                    { id: "/subscriptions/demo/resourceGroups/rg-security/providers/Microsoft.Network/networkSecurityGroups/nsg-web-inbound", name: "nsg-web-inbound", type: "microsoft.network/networksecuritygroups", resourceGroup: "rg-security", Motivo: "Servicio de Gestión / Arquitectura (Sin costo base)", skuName: "N/A" },
                    { id: "/subscriptions/demo/resourceGroups/rg-security/providers/Microsoft.Network/networkSecurityGroups/nsg-db-internal", name: "nsg-db-internal", type: "microsoft.network/networksecuritygroups", resourceGroup: "rg-security", Motivo: "Servicio de Gestión / Arquitectura (Sin costo base)", skuName: "N/A" }
                ]
            };
        case 'aks':
            return {
                success: true,
                data: [
                    {
                        id: "/subscriptions/demo/resourceGroups/rg-k8s-prod/providers/Microsoft.ContainerService/managedClusters/aks-prod-01",
                        name: "aks-prod-01",
                        resourceGroup: "rg-k8s-prod",
                        nodeResourceGroup: "MC_rg-k8s-prod_aks-prod-01_eastus",
                        location: "eastus",
                        subscriptionId: "demo",
                        totalCost: 15430.50,
                        hasCostData: true
                    },
                    {
                        id: "/subscriptions/demo/resourceGroups/rg-k8s-dev/providers/Microsoft.ContainerService/managedClusters/aks-dev-02",
                        name: "aks-dev-02",
                        resourceGroup: "rg-k8s-dev",
                        nodeResourceGroup: "MC_rg-k8s-dev_aks-dev-02_eastus",
                        location: "eastus",
                        subscriptionId: "demo",
                        totalCost: 3250.75,
                        hasCostData: true
                    },
                    {
                        id: "/subscriptions/demo/resourceGroups/rg-k8s-test/providers/Microsoft.ContainerService/managedClusters/aks-test-01",
                        name: "aks-test-01",
                        resourceGroup: "rg-k8s-test",
                        nodeResourceGroup: "MC_rg-k8s-test_aks-test-01_westus",
                        location: "westus",
                        subscriptionId: "demo",
                        totalCost: 480.00,
                        hasCostData: true
                    }
                ]
            };
        case 'unit_economics':
            // Generar 30 días de datos deterministas
            const ueData = [];
            for (let i = 29; i >= 0; i--) {
                const date = new Date(Date.now() - i * 86400000);
                const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                // El tráfico baja en fines de semana
                const dau = isWeekend ? 35000 + Math.floor(Math.random() * 5000) : 55000 + Math.floor(Math.random() * 8000);
                // El costo baja menos que el tráfico por costos fijos (esto empeora la economía unitaria el finde)
                const cost = isWeekend ? (450 + Math.random() * 50) * multiplier : (850 + Math.random() * 100) * multiplier;
                
                ueData.push({
                    date: date.toISOString().split('T')[0],
                    cost: cost,
                    dau: dau,
                    costPerUser: cost / dau // En dólares por usuario
                });
            }
            return {
                success: true,
                data: ueData
            };
        case 'scorecard':
            return {
                success: true,
                data: [
                    {
                        team: "Data Engineering",
                        score: 95,
                        totalCost: 18500,
                        penalties: [
                            { reason: "Recursos sin etiquetar (3%)", impact: -3, costImpact: 450 },
                            { reason: "Baja cobertura de RI en Worker Nodes", impact: -2, costImpact: 800 }
                        ]
                    },
                    {
                        team: "Frontend Web",
                        score: 82,
                        totalCost: 4200,
                        penalties: [
                            { reason: "App Service Plans Vacíos (Zombies)", impact: -10, costImpact: 150 },
                            { reason: "Baja cobertura de Savings Plans", impact: -8, costImpact: 320 }
                        ]
                    },
                    {
                        team: "Mobile App",
                        score: 75,
                        totalCost: 8900,
                        penalties: [
                            { reason: "Discos Huérfanos P30", impact: -15, costImpact: 580 },
                            { reason: "VMs de Dev sin apagado automático", impact: -10, costImpact: 400 }
                        ]
                    },
                    {
                        team: "Legacy Backend",
                        score: 45, // < 60 -> Alerta
                        totalCost: 34000,
                        penalties: [
                            { reason: "100% Instancias On-Demand (Sin Reservas)", impact: -30, costImpact: 8500 },
                            { reason: "Alta densidad de Discos Zombies", impact: -15, costImpact: 1200 },
                            { reason: "Falta etiqueta 'CostCenter' en 80% de RGs", impact: -10, costImpact: 0 }
                        ]
                    }
                ]
            };
        case 'hybrid-benefit':
            return {
                success: true,
                data: {
                    totalPotentialSavings: 2840.50,
                    eligibleResources: [
                        { id: 'vm-prod-sql-01', name: 'sql-prod-db-win', type: 'Virtual Machine', currentCost: 650.00, ahbCost: 320.00, savings: 330.00 },
                        { id: 'vm-dev-win-02', name: 'iis-web-dev', type: 'Virtual Machine', currentCost: 280.00, ahbCost: 140.00, savings: 140.00 },
                        { id: 'sql-mi-corp', name: 'corp-analytics-mi', type: 'SQL Managed Instance', currentCost: 4500.00, ahbCost: 2300.00, savings: 2200.00 },
                        { id: 'vm-test-win', name: 'win-jumpbox-01', type: 'Virtual Machine', currentCost: 341.00, ahbCost: 170.50, savings: 170.50 }
                    ]
                }
            };
        case 'allocation-rules':
            return {
                success: true,
                data: [
                    { id: 'rule-1', resourceName: 'ExpressRoute-Corp', targetCostCenter: 'Marketing', allocationPercentage: 35.0 },
                    { id: 'rule-2', resourceName: 'ExpressRoute-Corp', targetCostCenter: 'Engineering', allocationPercentage: 65.0 },
                    { id: 'rule-3', resourceName: 'AKS-Shared-Cluster', targetCostCenter: 'MobileApp', allocationPercentage: 80.0 },
                    { id: 'rule-4', resourceName: 'AKS-Shared-Cluster', targetCostCenter: 'WebPortal', allocationPercentage: 20.0 }
                ]
            };
        case 'commitments':
            return {
                success: true,
                data: {
                    utilization: 82.5, // 82.5% de uso
                    coverage: 45.0, // 45% de cobertura total de computo
                    recommendations: [
                        { type: 'VirtualMachines', sku: 'Standard_D4s_v3', recommendedQuantity: 12, monthlySavings: 1240.50, term: 'P3Y' },
                        { type: 'VirtualMachines', sku: 'Standard_E8s_v4', recommendedQuantity: 4, monthlySavings: 890.00, term: 'P1Y' },
                        { type: 'AppService', sku: 'PremiumV3', recommendedQuantity: 2, monthlySavings: 310.25, term: 'P3Y' }
                    ]
                }
            };
        default:
            return { success: true, message: "Mock data not defined for this route" };
    }
};
