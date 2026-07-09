export const isMockTenant = (tenantId: string) => {
    return [
        "11111111-2222-3333-4444-555555555555",
        "22222222-3333-4444-5555-666666666666",
        "44444444-5555-6666-7777-888888888888",
        "33333333-4444-5555-6666-777777777777",
        "demo_tenant"
    ].includes(tenantId);
};

/**
 * Genera una serie histórica diaria simulada para un dominio/tier, usada por
 * /api/history cuando el tenant es de demo/mock. Determinista (misma fecha => mismo
 * valor) para que la demo sea estable. Escala por tier y aplica una tendencia suave
 * de mejora (costo baja, cobertura sube) más ruido pseudoaleatorio acotado.
 */
export const getMockSnapshotHistory = (
    domain: string,
    tier: string,
    from: string,
    to: string,
): Array<{ date: string; payload: Record<string, number> }> => {
    const t = (tier || 'essential').toLowerCase();
    const mult = t === 'enterprise' ? 50 : t === 'business' ? 10 : t === 'pro' || t === 'professional' ? 3 : 1;

    // Ruido determinista en [-1,1] a partir de un string.
    const noise = (seed: string): number => {
        let h = 2166136261;
        for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
        return ((h >>> 0) / 0xffffffff) * 2 - 1;
    };

    const start = new Date(from + 'T00:00:00Z');
    const end = new Date(to + 'T00:00:00Z');
    const days: Array<{ date: string; payload: Record<string, number> }> = [];
    const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));

    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const date = d.toISOString().slice(0, 10);
        // progress: 0 (más antiguo) -> 1 (hoy)
        const progress = Math.min(1, Math.max(0, (d.getTime() - start.getTime()) / (totalDays * 86400000)));
        const n = noise(`${domain}:${date}`);
        const round2 = (x: number) => Math.round(x * 100) / 100;

        let payload: Record<string, number>;
        switch (domain) {
            case 'dashboard_summary':
                payload = {
                    actualCost: round2((1000 * mult) * (1 - 0.15 * progress) * (1 + 0.05 * n)),
                    forecastCost: round2((1000 * mult) * (1.1 - 0.1 * progress)),
                    savingsOpportunity: round2((180 * mult) * (1 + 0.2 * progress) * (1 + 0.04 * n)),
                };
                break;
            case 'commitments':
                payload = {
                    coveragePct: round2(Math.min(98, 55 + 30 * progress + 3 * n)),
                    utilizationPct: round2(Math.min(99, 70 + 20 * progress + 2 * n)),
                    activeReservations: Math.round(2 + mult / 5),
                };
                break;
            case 'rightsizing':
                payload = {
                    potentialSavings: round2((240 * mult) * (1 - 0.3 * progress) * (1 + 0.05 * n)),
                    candidates: Math.max(0, Math.round((8 + mult) * (1 - 0.4 * progress))),
                };
                break;
            case 'anomalies':
                payload = {
                    anomaliesDetected: Math.max(0, Math.round(3 + 3 * n + mult / 20)),
                    impactUsd: round2(Math.max(0, (120 * mult / 10) * (1 + 0.3 * n))),
                };
                break;
            case 'budgets':
                payload = {
                    totalBudget: round2(1200 * mult),
                    totalSpent: round2((1200 * mult) * Math.min(1.05, 0.4 + 0.6 * progress + 0.03 * n)),
                    burnPct: round2(Math.min(105, 40 + 60 * progress + 3 * n)),
                };
                break;
            case 'governance':
                payload = {
                    complianceScore: round2(Math.min(100, 62 + 28 * progress + 2 * n)),
                    untaggedResources: Math.max(0, Math.round((40 + mult) * (1 - 0.5 * progress))),
                };
                break;
            case 'sustainability':
                payload = {
                    co2Kg: round2((90 * mult / 10) * (1 - 0.2 * progress) * (1 + 0.04 * n)),
                    zombieResources: Math.max(0, Math.round((6 + mult / 5) * (1 - 0.5 * progress))),
                };
                break;
            case 'zombies':
                payload = {
                    zombieCount: Math.max(0, Math.round((10 + mult / 3) * (1 - 0.5 * progress))),
                    wastedUsd: round2((150 * mult / 10) * (1 - 0.4 * progress) * (1 + 0.05 * n)),
                };
                break;
            default:
                payload = { value: round2((100 * mult) * (1 + 0.1 * n)) };
        }
        days.push({ date, payload });
    }
    return days;
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
        case 'academy': {
            const modules = [
                {
                    id: "module-1",
                    title: "Conceptos Básicos de Presupuesto",
                    description: "Aprende a leer y configurar las alertas de presupuesto (Burn Rate) antes de que el dinero se agote.",
                    content: "### Bienvenido a FinOps 101\n\nEl presupuesto es la base de cualquier estrategia FinOps. No se trata solo de limitar el gasto, sino de **predecir** cuándo te quedarás sin fondos usando el *Burn Rate*.\n\n#### ¿Qué es el Burn Rate?\nEs la velocidad a la que consumes tu presupuesto.\n\n#### Mejores Prácticas:\n1. **Configura múltiples umbrales:** No avises solo al 100%.\n2. **Alertas a los responsables:** Envía el webhook directo al canal de Slack.\n3. **Revisa los picos:** Usa el módulo de **Anomalías** para investigar.",
                    duration: "5 min",
                    suggestOnboardingScript: true,
                    isCompleted: true,
                },
                {
                    id: "module-2",
                    title: "Cómo entender tu factura de Azure",
                    description: "Desmitificando los recursos Zombie y los costos ocultos de transferencia de red (Egress).",
                    content: "### Desenmascarando a Azure\n\n#### 1. Recursos Zombis 🧟\nSon recursos que estás pagando pero que no hacen nada.\n\n#### 2. Costos de Egress 🌐\nSacar datos de Azure cuesta mucho dinero.",
                    duration: "8 min",
                    suggestOnboardingScript: false,
                    isCompleted: true,
                },
                {
                    id: "module-3",
                    title: "Derecho de Uso (Hybrid Benefit)",
                    description: "No pagues doble. Reutiliza tus licencias de Windows y SQL Server.",
                    content: "### El Secreto Mejor Guardado de Microsoft\n\n#### Azure Hybrid Benefit (AHB)\nAplicá licencias que ya poseés directamente en la nube. ¡Podés ahorrar hasta un 45% del costo de cómputo!",
                    duration: "10 min",
                    suggestOnboardingScript: false,
                    isCompleted: false,
                },
            ];
            return {
                success: true,
                mock: true,
                modules,
                totalCompleted: modules.filter(m => m.isCompleted).length,
                isCertified: false,
            };
        }
        case 'advisor':
            return {
                success: true,
                recommendations: {
                    Cost: [
                        {
                            id: "mock-cost-1",
                            category: "Cost",
                            subscriptionId: "mock-sub",
                            impactedField: "Microsoft.Compute/virtualMachines",
                            resourceMetadata: { resourceId: "/subscriptions/mock-sub/resourceGroups/prod-rg/providers/Microsoft.Compute/virtualMachines/app-prod-vm-01" },
                            shortDescription: {
                                problem: "Right-size or shutdown underutilized virtual machines",
                                solution: "Resize Standard_D8s_v3 to Standard_D4s_v3 to reduce monthly spend."
                            },
                            extendedProperties: { savingsAmount: String(Math.round(215.5 * multiplier)) }
                        },
                        {
                            id: "mock-cost-2",
                            category: "Cost",
                            subscriptionId: "mock-sub",
                            impactedField: "Microsoft.Compute/disks",
                            resourceMetadata: { resourceId: "/subscriptions/mock-sub/resourceGroups/storage-rg/providers/Microsoft.Compute/disks/orphan-disk-01" },
                            shortDescription: {
                                problem: "Delete unattached managed disks",
                                solution: "Delete 3 unattached disks to stop incurring storage costs."
                            },
                            extendedProperties: { savingsAmount: String(Math.round(86.4 * multiplier)) }
                        },
                        {
                            id: "mock-cost-3",
                            category: "Cost",
                            subscriptionId: "mock-sub",
                            impactedField: "Microsoft.Network/virtualNetworkGateways",
                            resourceMetadata: { resourceId: "/subscriptions/mock-sub/resourceGroups/net-rg/providers/Microsoft.Network/virtualNetworkGateways/idle-gw-01" },
                            shortDescription: {
                                problem: "Repurpose or delete idle virtual network gateways",
                                solution: "Delete idle VNet gateway to avoid unnecessary charges."
                            },
                            extendedProperties: { savingsAmount: String(Math.round(132.0 * multiplier)) }
                        }
                    ],
                    Security: [
                        {
                            id: "mock-sec-1",
                            category: "Security",
                            subscriptionId: "mock-sub",
                            impactedField: "Microsoft.Subscriptions/subscriptions",
                            resourceMetadata: { resourceId: "/subscriptions/mock-sub" },
                            shortDescription: {
                                problem: "Enable multi-factor authentication for privileged accounts",
                                solution: "Configure MFA via Conditional Access for all admin roles."
                            },
                            extendedProperties: {}
                        }
                    ],
                    HighAvailability: [
                        {
                            id: "mock-ha-1",
                            category: "HighAvailability",
                            subscriptionId: "mock-sub",
                            impactedField: "Microsoft.Storage/storageAccounts",
                            resourceMetadata: { resourceId: "/subscriptions/mock-sub/resourceGroups/storage-rg/providers/Microsoft.Storage/storageAccounts/prodstorage01" },
                            shortDescription: {
                                problem: "Enable soft delete to protect your data",
                                solution: "Enable Blob soft delete with 14-day retention."
                            },
                            extendedProperties: {}
                        }
                    ],
                    Performance: [
                        {
                            id: "mock-perf-1",
                            category: "Performance",
                            subscriptionId: "mock-sub",
                            impactedField: "Microsoft.Compute/disks",
                            resourceMetadata: { resourceId: "/subscriptions/mock-sub/resourceGroups/db-rg/providers/Microsoft.Compute/disks/db-data-disk-01" },
                            shortDescription: {
                                problem: "Upgrade to Premium SSD disks to improve performance",
                                solution: "Migrate Standard HDD to Premium SSD on workloads with high IOPS."
                            },
                            extendedProperties: {}
                        }
                    ],
                    OperationalExcellence: []
                },
                subscriptions: [{ id: "mock-sub", name: "Demo Subscription" }],
                scores: { "mock-sub": { Cost: Math.min(98, 82 + multiplier) } }
            };
        case 'rightsizing':
            return {
                success: true,
                mock: true,
                data: [
                    { id: "/subscriptions/mock-sub/resourceGroups/prod-rg/providers/Microsoft.Compute/virtualMachines/app-prod-vm-01", name: "app-prod-vm-01", subscriptionId: "mock-sub", currentSku: "Standard_D8s_v3", recommendedSku: "Standard_D4s_v3", savings: 215.50, maxCpu: 8.2, hiddenCost: 0, reason: "Low CPU utilization" },
                    { id: "/subscriptions/mock-sub/resourceGroups/stage-rg/providers/Microsoft.Compute/virtualMachines/db-stage-vm-02", name: "db-stage-vm-02", subscriptionId: "mock-sub", currentSku: "Standard_E8s_v4", recommendedSku: "Standard_E2s_v4", savings: 380.00, maxCpu: 4.1, hiddenCost: 0, reason: "Low CPU utilization" },
                    { id: "/subscriptions/mock-sub/resourceGroups/batch-rg/providers/Microsoft.Compute/virtualMachines/worker-batch-10", name: "worker-batch-10", subscriptionId: "mock-sub", currentSku: "Standard_F16s_v2", recommendedSku: "Standard_F8s_v2", savings: 412.20, maxCpu: 18.5, hiddenCost: 0, reason: "Low CPU utilization" },
                    { id: "/subscriptions/mock-sub/resourceGroups/core-rg/providers/Microsoft.Compute/virtualMachines/cache-node-01", name: "cache-node-01", subscriptionId: "mock-sub", currentSku: "Standard_D4ds_v5", recommendedSku: "Standard_D2ds_v5", savings: 105.80, maxCpu: 12.0, hiddenCost: 0, reason: "Low CPU utilization" },
                    { id: "/subscriptions/mock-sub/resourceGroups/dev-rg/providers/Microsoft.Compute/virtualMachines/dev-bastion-vm", name: "dev-bastion-vm", subscriptionId: "mock-sub", currentSku: "Standard_B4ms", recommendedSku: "Standard_B2ms", savings: 42.10, maxCpu: 2.5, hiddenCost: 0, reason: "Low CPU utilization" },
                    { id: "/subscriptions/mock-sub/resourceGroups/legacy-rg/providers/Microsoft.Compute/virtualMachines/old-deallocated-vm", name: "old-deallocated-vm", subscriptionId: "mock-sub", currentSku: "Standard_D2s_v3", recommendedSku: "DELETE", savings: 0, maxCpu: 0, hiddenCost: 38.50, reason: "Deallocated VM with attached Storage" }
                ],
                subscriptions: [{ id: "mock-sub", name: "Demo Subscription" }]
            };
        case 'rates':
            return {
                mock: true,
                recommendations: [
                    { resourceName: 'app-prod-vm-01', resourceType: 'Virtual Machine', sku: 'Standard_D8s_v3', region: 'eastus', monthlyCost: 280 * multiplier, monthlyCostLicenseIncluded: 560 * multiplier, annualCost: 3360 * multiplier, annualCost1Y: 2016 * multiplier, annualCost3Y: 1411 * multiplier, savings1Y: 1344 * multiplier, savings3Y: 1949 * multiplier },
                    { resourceName: 'app-prod-vm-02', resourceType: 'Virtual Machine', sku: 'Standard_D8s_v3', region: 'eastus', monthlyCost: 280 * multiplier, monthlyCostLicenseIncluded: 560 * multiplier, annualCost: 3360 * multiplier, annualCost1Y: 2016 * multiplier, annualCost3Y: 1411 * multiplier, savings1Y: 1344 * multiplier, savings3Y: 1949 * multiplier },
                    { resourceName: 'db-stage-vm-02', resourceType: 'Virtual Machine', sku: 'Standard_E8s_v4', region: 'eastus', monthlyCost: 420 * multiplier, monthlyCostLicenseIncluded: 840 * multiplier, annualCost: 5040 * multiplier, annualCost1Y: 3024 * multiplier, annualCost3Y: 2116 * multiplier, savings1Y: 2016 * multiplier, savings3Y: 2924 * multiplier },
                    { resourceName: 'web-frontend-vmss', resourceType: 'VM Scale Set', sku: 'Standard_F4s_v2', region: 'westus2', monthlyCost: 195 * multiplier, monthlyCostLicenseIncluded: 390 * multiplier, annualCost: 2340 * multiplier, annualCost1Y: 1404 * multiplier, annualCost3Y: 982 * multiplier, savings1Y: 936 * multiplier, savings3Y: 1358 * multiplier },
                    { resourceName: 'analytics-dw-vm', resourceType: 'Virtual Machine', sku: 'Standard_E16s_v5', region: 'eastus2', monthlyCost: 920 * multiplier, monthlyCostLicenseIncluded: 1840 * multiplier, annualCost: 11040 * multiplier, annualCost1Y: 6624 * multiplier, annualCost3Y: 4636 * multiplier, savings1Y: 4416 * multiplier, savings3Y: 6404 * multiplier },
                    { resourceName: 'sqldb-main', resourceType: 'SQL Database', sku: 'vCore_Gen5_8', region: 'westus', monthlyCost: 850 * multiplier, monthlyCostLicenseIncluded: 1700 * multiplier, annualCost: 10200 * multiplier, annualCost1Y: 6120 * multiplier, annualCost3Y: 4284 * multiplier, savings1Y: 4080 * multiplier, savings3Y: 5916 * multiplier },
                    { resourceName: 'sqldb-reports', resourceType: 'SQL Database', sku: 'vCore_Gen5_4', region: 'westus', monthlyCost: 425 * multiplier, monthlyCostLicenseIncluded: 850 * multiplier, annualCost: 5100 * multiplier, annualCost1Y: 3060 * multiplier, annualCost3Y: 2142 * multiplier, savings1Y: 2040 * multiplier, savings3Y: 2958 * multiplier },
                    { resourceName: 'cosmos-prod-account', resourceType: 'Cosmos DB', sku: 'RU_10000', region: 'eastus', monthlyCost: 584 * multiplier, monthlyCostLicenseIncluded: 584 * multiplier, annualCost: 7008 * multiplier, annualCost1Y: 4205 * multiplier, annualCost3Y: 2943 * multiplier, savings1Y: 2803 * multiplier, savings3Y: 4065 * multiplier },
                    { resourceName: 'aks-prod-cluster', resourceType: 'AKS Node Pool', sku: 'Standard_D4s_v5', region: 'eastus', monthlyCost: 175 * multiplier, monthlyCostLicenseIncluded: 350 * multiplier, annualCost: 2100 * multiplier, annualCost1Y: 1260 * multiplier, annualCost3Y: 882 * multiplier, savings1Y: 840 * multiplier, savings3Y: 1218 * multiplier },
                    { resourceName: 'redis-cache-prod', resourceType: 'Redis Cache', sku: 'Premium_P2', region: 'eastus', monthlyCost: 410 * multiplier, monthlyCostLicenseIncluded: 410 * multiplier, annualCost: 4920 * multiplier, annualCost1Y: 2952 * multiplier, annualCost3Y: 2066 * multiplier, savings1Y: 1968 * multiplier, savings3Y: 2854 * multiplier },
                    { resourceName: 'synapse-pool-dw', resourceType: 'Synapse Dedicated Pool', sku: 'DW500c', region: 'eastus2', monthlyCost: 5760 * multiplier, monthlyCostLicenseIncluded: 5760 * multiplier, annualCost: 69120 * multiplier, annualCost1Y: 41472 * multiplier, annualCost3Y: 29030 * multiplier, savings1Y: 27648 * multiplier, savings3Y: 40090 * multiplier },
                    { resourceName: 'storage-backups-sa', resourceType: 'Storage Account', sku: 'GRS_Hot', region: 'eastus', monthlyCost: 145 * multiplier, monthlyCostLicenseIncluded: 145 * multiplier, annualCost: 1740 * multiplier, annualCost1Y: 1044 * multiplier, annualCost3Y: 731 * multiplier, savings1Y: 696 * multiplier, savings3Y: 1009 * multiplier }
                ],
                reservations: [
                    { skuName: 'Standard_D8s_v3', resourceType: 'VirtualMachines', recommendedQuantity: 4 * multiplier, totalMonthlyPAYGCost: 1120 * multiplier, costWith1YReservation: 672 * multiplier, netSavings1Y: 448 * multiplier, costWith3YReservation: 470 * multiplier, netSavings3Y: 650 * multiplier },
                    { skuName: 'Standard_E8s_v4', resourceType: 'VirtualMachines', recommendedQuantity: 2 * multiplier, totalMonthlyPAYGCost: 840 * multiplier, costWith1YReservation: 504 * multiplier, netSavings1Y: 336 * multiplier, costWith3YReservation: 353 * multiplier, netSavings3Y: 487 * multiplier },
                    { skuName: 'Standard_F4s_v2', resourceType: 'VirtualMachines', recommendedQuantity: 3 * multiplier, totalMonthlyPAYGCost: 585 * multiplier, costWith1YReservation: 351 * multiplier, netSavings1Y: 234 * multiplier, costWith3YReservation: 246 * multiplier, netSavings3Y: 339 * multiplier },
                    { skuName: 'Standard_E16s_v5', resourceType: 'VirtualMachines', recommendedQuantity: 1 * multiplier, totalMonthlyPAYGCost: 920 * multiplier, costWith1YReservation: 552 * multiplier, netSavings1Y: 368 * multiplier, costWith3YReservation: 386 * multiplier, netSavings3Y: 534 * multiplier },
                    { skuName: 'vCore_Gen5_8', resourceType: 'SQLDatabase', recommendedQuantity: 2 * multiplier, totalMonthlyPAYGCost: 1700 * multiplier, costWith1YReservation: 1020 * multiplier, netSavings1Y: 680 * multiplier, costWith3YReservation: 714 * multiplier, netSavings3Y: 986 * multiplier },
                    { skuName: 'vCore_Gen5_4', resourceType: 'SQLDatabase', recommendedQuantity: 3 * multiplier, totalMonthlyPAYGCost: 1275 * multiplier, costWith1YReservation: 765 * multiplier, netSavings1Y: 510 * multiplier, costWith3YReservation: 536 * multiplier, netSavings3Y: 739 * multiplier },
                    { skuName: 'RU_10000', resourceType: 'CosmosDB', recommendedQuantity: 1 * multiplier, totalMonthlyPAYGCost: 584 * multiplier, costWith1YReservation: 350 * multiplier, netSavings1Y: 234 * multiplier, costWith3YReservation: 245 * multiplier, netSavings3Y: 339 * multiplier },
                    { skuName: 'Premium_P2', resourceType: 'RedisCache', recommendedQuantity: 2 * multiplier, totalMonthlyPAYGCost: 820 * multiplier, costWith1YReservation: 492 * multiplier, netSavings1Y: 328 * multiplier, costWith3YReservation: 344 * multiplier, netSavings3Y: 476 * multiplier },
                    { skuName: 'DW500c', resourceType: 'SynapseAnalytics', recommendedQuantity: 1 * multiplier, totalMonthlyPAYGCost: 5760 * multiplier, costWith1YReservation: 3456 * multiplier, netSavings1Y: 2304 * multiplier, costWith3YReservation: 2419 * multiplier, netSavings3Y: 3341 * multiplier },
                    { skuName: 'Standard_D4s_v5', resourceType: 'VirtualMachines', recommendedQuantity: 6 * multiplier, totalMonthlyPAYGCost: 1050 * multiplier, costWith1YReservation: 630 * multiplier, netSavings1Y: 420 * multiplier, costWith3YReservation: 441 * multiplier, netSavings3Y: 609 * multiplier }
                ]
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
            // Genera 12 puntos semanales terminando hoy, con score creciente
            // según el tier (multiplier). Refleja "evolución de optimización"
            // y evita fechas obsoletas en demos.
            return {
                data: (() => {
                    const points = 12;
                    const baseScore = Math.max(40, 70 - multiplier * 2); // arranca más bajo en tiers altos para mostrar mejora
                    const finalScore = Math.min(97, 80 + multiplier);
                    const baseImpacted = Math.max(3, 25 - multiplier);
                    const finalImpacted = Math.max(1, Math.floor(baseImpacted / 3));
                    return Array.from({ length: points }).map((_, i) => {
                        const t = i / (points - 1);
                        const date = new Date(Date.now() - (points - 1 - i) * 7 * 86400000);
                        const score = baseScore + (finalScore - baseScore) * t;
                        const impacted = Math.round(baseImpacted + (finalImpacted - baseImpacted) * t);
                        const potential = Math.max(0, 8 - i * 0.7);
                        return {
                            scan_date: date.toISOString().split('T')[0],
                            score: parseFloat(score.toFixed(1)),
                            impacted_resources: impacted,
                            potential_score_increase: parseFloat(potential.toFixed(1))
                        };
                    });
                })()
            };
        case 'sustainability': {
            const vmCount = 12 * multiplier;
            const storageCount = 5 * multiplier;
            const zombieCount = 3 * multiplier;
            const byRegion = [
                { region: 'eastus', resources: 8 * multiplier, intensity: 379, kgCO2e: 4200.5 * multiplier },
                { region: 'westeurope', resources: 5 * multiplier, intensity: 88, kgCO2e: 1100.2 * multiplier },
                { region: 'northeurope', resources: 3 * multiplier, intensity: 42, kgCO2e: 520.8 * multiplier },
                { region: 'southeastasia', resources: 4 * multiplier, intensity: 408, kgCO2e: 2680.0 * multiplier },
                { region: 'brazilsouth', resources: 2 * multiplier, intensity: 95, kgCO2e: 640.3 * multiplier },
            ];
            const footprint = byRegion.reduce((s, r) => s + r.kgCO2e, 0);
            const avoided = 340.2 * multiplier;
            const recommendations = [
                { fromRegion: 'eastus', currentIntensity: 379, toRegion: 'northeurope', targetIntensity: 42, reductionPct: 89, projectedReductionKgCO2: 1580.4 * multiplier, impactedResources: 6 * multiplier },
                { fromRegion: 'southeastasia', currentIntensity: 408, toRegion: 'westeurope', targetIntensity: 88, reductionPct: 78, projectedReductionKgCO2: 980.6 * multiplier, impactedResources: 3 * multiplier },
            ];
            return {
                success: true,
                mock: true,
                footprint,
                avoided,
                vmCount,
                storageCount,
                zombieCount,
                byRegion,
                recommendations,
                equivalencies: {
                    carKm: Math.round(footprint * 4.6),
                    treesYear: Math.round(footprint / 21),
                    phoneCharges: Math.round(footprint * 121),
                },
            };
        }
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
        case 'anomalies': {
            const baseMean = 520 * multiplier;
            const std = 78 * multiplier;
            const today = new Date();
            const dailyCosts: Array<{date: string, amount: number}> = [];
            // Deterministic pseudo-random so chart is stable across renders
            const rand = (i: number) => {
                const x = Math.sin(i * 12.9898) * 43758.5453;
                return x - Math.floor(x);
            };
            const spikeDays = new Set([7, 22, 41, 55, 58]);
            for (let i = 59; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(today.getDate() - i);
                const idx = 59 - i;
                const noise = (rand(idx) - 0.5) * std * 1.4;
                let amount = baseMean + noise + Math.sin(idx / 7) * std * 0.4;
                if (spikeDays.has(idx)) {
                    amount = baseMean + std * (4 + rand(idx + 100) * 2);
                }
                dailyCosts.push({ date: d.toISOString().slice(0, 10), amount: Math.max(50, Math.round(amount * 100) / 100) });
            }
            const upperBound = baseMean + 3 * std;
            const spikes = dailyCosts.filter(d => d.amount > upperBound);
            const services = ['Virtual Machines', 'Storage', 'SQL Database', 'App Service', 'Cosmos DB'];
            const subs = ['sub-prod-eastus', 'sub-prod-westus', 'sub-staging', 'sub-data-analytics', 'sub-dev'];
            // Estados del ciclo de vida de la anomalía (Open/Postponed/Dismissed/Completed)
            // repartidos de forma determinística para que las pestañas del dashboard
            // (Detección de Anomalías) muestren datos en todas las categorías.
            const STATUS_CYCLE = ['Open', 'Postponed', 'Dismissed', 'Completed', 'Completed', 'Open'] as const;
            const anomalies = spikes.map((s, i) => {
                const status = STATUS_CYCLE[i % STATUS_CYCLE.length];
                const detectedAt = new Date(`${s.date}T06:00:00.000Z`);
                const resolvedAt = status !== 'Open'
                    ? new Date(detectedAt.getTime() + (4 + rand(i + 200) * 36) * 60 * 60 * 1000)
                    : null;
                return {
                    id: i + 1,
                    date: s.date,
                    status,
                    service: services[i % services.length],
                    subscription_id: subs[i % subs.length],
                    amount: s.amount,
                    expected_amount: baseMean,
                    z_score: (s.amount - baseMean) / std,
                    metric: ['Bandwidth', 'Compute Hours', 'DTU', 'RU/s', 'GB-month'][i % 5],
                    severity: s.amount > baseMean + 5 * std ? 'Critical' : 'High',
                    description: `Pico inusual detectado en ${services[i % services.length]} — desviación de +$${(s.amount - baseMean).toFixed(0)} vs media móvil.`,
                    detected_at: detectedAt.toISOString(),
                    resolved_at: resolvedAt ? resolvedAt.toISOString() : null,
                };
            });
            return {
                success: true,
                mock: true,
                mean: baseMean,
                stdDev: std,
                dailyCosts,
                anomalies
            };
        }
        case 'coin': {
            const breakdown = [
                { category: 'Cost', implemented: 18, total: 24, coin: 75 },
                { category: 'Performance', implemented: 6, total: 12, coin: 50 },
                { category: 'Reliability', implemented: 4, total: 9, coin: 44.4 },
                { category: 'Security', implemented: 9, total: 10, coin: 90 },
            ];
            const totalImplemented = breakdown.reduce((s, b) => s + b.implemented, 0);
            const totalAll = breakdown.reduce((s, b) => s + b.total, 0);
            const monthly = Array.from({ length: 6 }).map((_, i) => {
                const d = new Date();
                d.setMonth(d.getMonth() - (5 - i));
                const total = 8 + i * 2;
                const implementedM = Math.round(total * (0.5 + i * 0.07));
                return { month: d.toISOString().slice(0, 7), coin: Math.round((implementedM / total) * 1000) / 10, implemented: implementedM, total };
            });
            return {
                success: true, mock: true, windowDays: 90,
                coin: Math.round((totalImplemented / totalAll) * 1000) / 10,
                implemented: totalImplemented, total: totalAll,
                suppressed: 3, dismissed: 2, accepted: 5,
                breakdown, monthly,
            };
        }
        case 'tenant_health': {
            // Tiers más altos tienden a tener mejor postura (más automatización
            // activada) — igual que el resto de los mocks, escalado por `multiplier`.
            const maturityBoost = Math.min(20, multiplier * 2);
            const score = Math.min(100, Math.round(52 + maturityBoost));
            return {
                success: true,
                mock: true,
                overallScore: score,
                grade: score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D',
                signals: [
                    { key: 'tagging', label: 'Cumplimiento de Etiquetas', score: Math.min(100, 50 + maturityBoost * 2), weight: 20, detail: 'Recursos con tags obligatorios completos' },
                    { key: 'waste', label: 'Recursos Zombis', score: Math.max(20, 85 - multiplier), weight: 20, detail: 'Inventario sin desperdicio detectado' },
                    { key: 'budget', label: 'Cumplimiento de Presupuesto', score: Math.min(100, 60 + maturityBoost), weight: 20, detail: 'Burn rate vs. presupuesto asignado' },
                    { key: 'credentials', label: 'Credenciales por Expirar', score: Math.min(100, 65 + maturityBoost), weight: 15, detail: 'Secrets/certificados dentro de la ventana segura' },
                    { key: 'savings', label: 'Ahorro Aplicado vs Potencial', score: Math.min(100, 35 + maturityBoost * 2), weight: 15, detail: 'Recomendaciones implementadas sobre el total detectado' },
                    { key: 'security', label: 'Postura de Seguridad (MFA)', score: Math.min(100, 72 + maturityBoost), weight: 10, detail: 'Usuarios administradores con MFA activo' },
                ],
                trend: Array.from({ length: 6 }).map((_, i) => {
                    const d = new Date();
                    d.setMonth(d.getMonth() - (5 - i));
                    return { month: d.toISOString().slice(0, 7), score: Math.min(100, Math.round(45 + i * 5 + maturityBoost)) };
                }),
            };
        }
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
                mock: true,
                data: Array.from({length: 30}).map((_, i) => {
                    const services = ['Virtual Machines', 'Storage', 'SQL Database', 'App Service', 'Networking', 'AKS', 'Functions'];
                    const svc = services[i % services.length];
                    const cost = (150 + Math.random() * 50) * multiplier;
                    const isoDate = new Date(Date.now() - (29 - i) * 86400000).toISOString().split('T')[0];
                    return {
                        date: isoDate,
                        UsageDate: isoDate,
                        cost,
                        BilledCost: cost,
                        EffectiveCost: cost * 0.92,
                        service: svc,
                        ServiceName: svc,
                        ServiceFamily: svc,
                        resourceGroup: ['rg-prod', 'rg-dev', 'rg-data', 'rg-net'][i % 4],
                        ResourceGroup: ['rg-prod', 'rg-dev', 'rg-data', 'rg-net'][i % 4],
                        ResourceId: `/subscriptions/demo/resourceGroups/rg/providers/Microsoft.Compute/${svc}/r${i}`,
                        tags: { Environment: i % 2 ? 'prod' : 'dev', Owner: 'demo@company.com' }
                    };
                })
            };
        case 'tags_compliance': {
            const mkRes = (id: string, name: string, missing: string[], type?: string, sub?: string) => ({
                resourceId: id, id, name,
                type: type || 'microsoft.compute/virtualmachines',
                subscriptionId: sub || 'demo', location: 'eastus',
                reason: missing.length === 0 ? 'Cumple con las políticas' : `Faltan etiquetas obligatorias: ${missing.join(', ')}`,
                missingTags: missing, isCompliant: missing.length === 0,
            });
            const allResources = [
                mkRes('/subscriptions/demo/rg/prod/vm-app-01', 'vm-app-01', []),
                mkRes('/subscriptions/demo/rg/prod/vm-app-02', 'vm-app-02', ['Owner']),
                mkRes('/subscriptions/demo/rg/data/sql-main', 'sql-main', [], 'microsoft.sql/servers'),
                mkRes('/subscriptions/demo/rg/data/st-archive', 'st-archive', ['Environment', 'CostCenter'], 'microsoft.storage/storageaccounts'),
                mkRes('/subscriptions/demo/rg/net/gw-hub', 'gw-hub', ['CostCenter'], 'microsoft.network/virtualnetworkgateways'),
            ];
            const resourceGroups = [
                { resourceId: '/subscriptions/demo/rg/prod', id: '/subscriptions/demo/rg/prod', name: 'rg-prod-core', type: 'microsoft.resources/subscriptions/resourcegroups', subscriptionId: 'demo', location: 'eastus', reason: 'Cumple con las políticas', missingTags: [], isCompliant: true },
                { resourceId: '/subscriptions/demo/rg/data', id: '/subscriptions/demo/rg/data', name: 'rg-data-lake', type: 'microsoft.resources/subscriptions/resourcegroups', subscriptionId: 'demo', location: 'westeurope', reason: 'Faltan etiquetas obligatorias: CostCenter', missingTags: ['CostCenter'], isCompliant: false },
            ];
            const cc = allResources.filter(r => r.isCompliant).length;
            const rgc = resourceGroups.filter(r => r.isCompliant).length;
            return {
                success: true,
                data: {
                    complianceScore: Math.round((cc / allResources.length) * 100),
                    allResources,
                    rgComplianceScore: Math.round((rgc / resourceGroups.length) * 100),
                    resourceGroups,
                },
            };
        }
        case 'ai-analytics':
            return {
                success: true, mock: true,
                summary: { totalCost: 8420.50 * multiplier, totalInputTokens: 42500000 * multiplier, totalOutputTokens: 18300000 * multiplier, costPer1kTokens: 0.139, activeModels: 4, activeApplications: 7 },
                byModel: [
                    { model: 'gpt-4o', cost: 5200 * multiplier, inputTokens: 25000000 * multiplier, outputTokens: 12000000 * multiplier, costPer1k: 0.140 },
                    { model: 'gpt-4-turbo', cost: 2100 * multiplier, inputTokens: 10000000 * multiplier, outputTokens: 4500000 * multiplier, costPer1k: 0.145 },
                    { model: 'gpt-35-turbo', cost: 850 * multiplier, inputTokens: 6500000 * multiplier, outputTokens: 1500000 * multiplier, costPer1k: 0.106 },
                    { model: 'text-embedding-3-large', cost: 270.50 * multiplier, inputTokens: 1000000 * multiplier, outputTokens: 300000 * multiplier, costPer1k: 0.208 },
                ],
                byApplication: [
                    { application: 'customer-support-bot', cost: 3200 * multiplier, model: 'gpt-4o' },
                    { application: 'doc-summarizer', cost: 1800 * multiplier, model: 'gpt-4o' },
                    { application: 'sales-assistant', cost: 1100 * multiplier, model: 'gpt-4-turbo' },
                    { application: 'embeddings-pipeline', cost: 850 * multiplier, model: 'text-embedding-3-large' },
                    { application: 'internal-search', cost: 650 * multiplier, model: 'gpt-35-turbo' },
                    { application: 'code-helper', cost: 520 * multiplier, model: 'gpt-4-turbo' },
                    { application: 'qa-eval', cost: 300.50 * multiplier, model: 'gpt-35-turbo' },
                ],
                byTeam: [
                    { team: 'cx', cost: 3200 * multiplier },
                    { team: 'product', cost: 2520 * multiplier },
                    { team: 'sales', cost: 1100 * multiplier },
                    { team: 'data-eng', cost: 850 * multiplier },
                    { team: 'engineering', cost: 750.50 * multiplier },
                ],
                trend: [
                    { date: '2026-06-01', cost: 265 * multiplier, inputTokens: 1350000 * multiplier, outputTokens: 580000 * multiplier },
                    { date: '2026-06-08', cost: 285 * multiplier, inputTokens: 1450000 * multiplier, outputTokens: 620000 * multiplier },
                    { date: '2026-06-15', cost: 305 * multiplier, inputTokens: 1530000 * multiplier, outputTokens: 670000 * multiplier },
                    { date: '2026-06-22', cost: 295 * multiplier, inputTokens: 1490000 * multiplier, outputTokens: 640000 * multiplier },
                    { date: '2026-06-27', cost: 310 * multiplier, inputTokens: 1560000 * multiplier, outputTokens: 680000 * multiplier },
                ],
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
                mock: true,
                data: [
                    { resource: 'pip-prod-lb-01', subCategory: 'Public IP (Standard)', cost: 4.20 * multiplier, resourceGroup: 'rg-prod-front', region: 'eastus' },
                    { resource: 'pip-staging-app-02', subCategory: 'Public IP (Standard)', cost: 4.20 * multiplier, resourceGroup: 'rg-staging', region: 'eastus' },
                    { resource: 'lb-prod-frontend', subCategory: 'Load Balancer', cost: 18.50 * multiplier, resourceGroup: 'rg-prod-front', region: 'eastus' },
                    { resource: 'lb-api-internal', subCategory: 'Load Balancer', cost: 22.10 * multiplier, resourceGroup: 'rg-api', region: 'eastus' },
                    { resource: 'agw-waf-corp', subCategory: 'Application Gateway (WAF v2)', cost: 248.40 * multiplier, resourceGroup: 'rg-prod-front', region: 'eastus' },
                    { resource: 'vpn-gw-corp-vpn', subCategory: 'VPN Gateway (VpnGw2)', cost: 365.00 * multiplier, resourceGroup: 'rg-net-hub', region: 'eastus' },
                    { resource: 'er-circuit-onprem', subCategory: 'ExpressRoute Circuit (1 Gbps)', cost: 950.00 * multiplier, resourceGroup: 'rg-net-hub', region: 'eastus' },
                    { resource: 'nat-gw-prod', subCategory: 'NAT Gateway', cost: 65.80 * multiplier, resourceGroup: 'rg-prod-front', region: 'eastus' },
                    { resource: 'fd-cdn-public', subCategory: 'Azure Front Door (Premium)', cost: 184.20 * multiplier, resourceGroup: 'rg-edge', region: 'global' },
                    { resource: 'fd-bandwidth-out', subCategory: 'Front Door Data Transfer Out', cost: 312.40 * multiplier, resourceGroup: 'rg-edge', region: 'global' },
                    { resource: 'pe-storage-sa01', subCategory: 'Private Endpoint', cost: 7.30 * multiplier, resourceGroup: 'rg-data', region: 'eastus' },
                    { resource: 'pe-sql-db01', subCategory: 'Private Endpoint', cost: 7.30 * multiplier, resourceGroup: 'rg-data', region: 'eastus' },
                    { resource: 'ddos-plan-corp', subCategory: 'DDoS Protection Standard', cost: 2944.00 * multiplier, resourceGroup: 'rg-net-hub', region: 'global' },
                    { resource: 'tm-failover-app', subCategory: 'Traffic Manager Profile', cost: 5.50 * multiplier, resourceGroup: 'rg-edge', region: 'global' },
                    { resource: 'egress-internet-eastus', subCategory: 'Data Transfer Out (Internet)', cost: 487.60 * multiplier, resourceGroup: 'rg-prod-front', region: 'eastus' },
                    { resource: 'egress-cross-region', subCategory: 'Inter-region Data Transfer', cost: 156.20 * multiplier, resourceGroup: 'rg-data', region: 'eastus' },
                    { resource: 'peering-vnet-hub-spoke1', subCategory: 'VNet Peering', cost: 32.10 * multiplier, resourceGroup: 'rg-net-hub', region: 'eastus' },
                    { resource: 'peering-vnet-hub-spoke2', subCategory: 'VNet Peering', cost: 28.50 * multiplier, resourceGroup: 'rg-net-hub', region: 'eastus' },
                    { resource: 'bastion-host-mgmt', subCategory: 'Azure Bastion', cost: 138.70 * multiplier, resourceGroup: 'rg-mgmt', region: 'eastus' },
                    { resource: 'firewall-hub-azfw', subCategory: 'Azure Firewall (Standard)', cost: 912.30 * multiplier, resourceGroup: 'rg-net-hub', region: 'eastus' }
                ]
            };
        case 'licenses':
            return {
                success: true,
                mock: true,
                data: {
                    licenses: [
                        { id: 'sku-1', skuPartNumber: 'ENTERPRISEPACK', isSystemSku: false, total: 50 * multiplier, consumed: 42 * multiplier, available: 8 * multiplier, underutilized: 12 * multiplier, wastedCost: 432.00 * multiplier },
                        { id: 'sku-2', skuPartNumber: 'SPE_E5', isSystemSku: false, total: 25 * multiplier, consumed: 18 * multiplier, available: 7 * multiplier, underutilized: 6 * multiplier, wastedCost: 342.00 * multiplier },
                        { id: 'sku-3', skuPartNumber: 'EMS', isSystemSku: false, total: 30 * multiplier, consumed: 28 * multiplier, available: 2 * multiplier, underutilized: 4 * multiplier, wastedCost: 35.60 * multiplier },
                        { id: 'sku-4', skuPartNumber: 'POWER_BI_PRO', isSystemSku: false, total: 20 * multiplier, consumed: 11 * multiplier, available: 9 * multiplier, underutilized: 7 * multiplier, wastedCost: 70.00 * multiplier },
                        { id: 'sku-5', skuPartNumber: 'PROJECT_PROFESSIONAL', isSystemSku: false, total: 8 * multiplier, consumed: 5 * multiplier, available: 3 * multiplier, underutilized: 2 * multiplier, wastedCost: 60.00 * multiplier },
                        { id: 'sku-6', skuPartNumber: 'VISIOCLIENT', isSystemSku: false, total: 6 * multiplier, consumed: 3 * multiplier, available: 3 * multiplier, underutilized: 3 * multiplier, wastedCost: 45.00 * multiplier },
                        { id: 'sku-7', skuPartNumber: 'DEFENDER_ENDPOINT_P2', isSystemSku: false, total: 60 * multiplier, consumed: 55 * multiplier, available: 5 * multiplier, underutilized: 8 * multiplier, wastedCost: 44.00 * multiplier },
                        { id: 'sku-8', skuPartNumber: 'INTUNE_A', isSystemSku: false, total: 40 * multiplier, consumed: 33 * multiplier, available: 7 * multiplier, underutilized: 5 * multiplier, wastedCost: 30.00 * multiplier },
                        { id: 'sku-9', skuPartNumber: 'Windows_Store', isSystemSku: true, total: 1000000, consumed: 0, available: 1000000, underutilized: 0, wastedCost: 0 }
                    ],
                    inactiveUsers: [
                        { userPrincipalName: 'jperez@demo.local', assignedProducts: 'ENTERPRISEPACK', lastActivityDate: '2025-02-14', daysInactive: 134 },
                        { userPrincipalName: 'mlopez@demo.local', assignedProducts: 'SPE_E5, POWER_BI_PRO', lastActivityDate: '2024-11-03', daysInactive: 237 },
                        { userPrincipalName: 'rgarcia@demo.local', assignedProducts: 'ENTERPRISEPACK', lastActivityDate: '2024-08-22', daysInactive: 310 },
                        { userPrincipalName: 'aramirez@demo.local', assignedProducts: 'PROJECT_PROFESSIONAL, VISIOCLIENT', lastActivityDate: null, daysInactive: 950 },
                        { userPrincipalName: 'consultor1@demo.local', assignedProducts: 'ENTERPRISEPACK', lastActivityDate: '2024-05-10', daysInactive: 414 },
                        { userPrincipalName: 'externo@demo.local', assignedProducts: 'EMS, INTUNE_A', lastActivityDate: '2025-01-08', daysInactive: 171 },
                        { userPrincipalName: 'soporte_old@demo.local', assignedProducts: 'SPE_E5', lastActivityDate: '2023-12-15', daysInactive: 561 }
                    ],
                    missingAhub: [
                        { name: 'app-prod-vm-01', type: 'microsoft.compute/virtualmachines', resourceGroup: 'rg-prod-front', location: 'eastus', subscriptionId: 'mock-sub', potentialLicenseSavings: 145.00 * multiplier },
                        { name: 'app-prod-vm-02', type: 'microsoft.compute/virtualmachines', resourceGroup: 'rg-prod-front', location: 'eastus', subscriptionId: 'mock-sub', potentialLicenseSavings: 145.00 * multiplier },
                        { name: 'web-iis-srv-01', type: 'microsoft.compute/virtualmachines', resourceGroup: 'rg-web', location: 'westus2', subscriptionId: 'mock-sub', potentialLicenseSavings: 87.20 * multiplier },
                        { name: 'sqldb-reports', type: 'microsoft.sql/servers/databases', resourceGroup: 'rg-data', location: 'eastus', subscriptionId: 'mock-sub', tier: 'GeneralPurpose', vCores: 4, potentialLicenseSavings: 220.50 * multiplier },
                        { name: 'sqldb-main', type: 'microsoft.sql/servers/databases', resourceGroup: 'rg-data', location: 'eastus', subscriptionId: 'mock-sub', tier: 'BusinessCritical', vCores: 8, potentialLicenseSavings: 441.00 * multiplier },
                        { name: 'sqlpool-shared', type: 'microsoft.sql/servers/databases', resourceGroup: 'rg-data', location: 'eastus', subscriptionId: 'mock-sub', scope: 'elasticPool', tier: 'GeneralPurpose', vCores: 8, potentialLicenseSavings: 320.40 * multiplier }
                    ]
                }
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
        case 'aks_chargeback': {
            const rawNamespaces = [
                { namespace: 'payments-api', totalCost: 3120 * multiplier, cpuCores: 8 },
                { namespace: 'checkout-web', totalCost: 1890 * multiplier, cpuCores: 4 },
                { namespace: 'analytics-batch', totalCost: 2450 * multiplier, cpuCores: 6 },
                { namespace: 'data-streaming', totalCost: 1740 * multiplier, cpuCores: 4 },
                { namespace: 'identity', totalCost: 520 * multiplier, cpuCores: 1 },
                { namespace: 'monitoring', totalCost: 610 * multiplier, cpuCores: 2 },
                { namespace: 'ingress-nginx', totalCost: 420 * multiplier, cpuCores: 1 },
                { namespace: 'kube-system', totalCost: 380 * multiplier, cpuCores: 1 },
            ];
            const namespaces = rawNamespaces.map(n => ({
                ...n,
                computeCost: Math.round(n.totalCost * 0.8 * 100) / 100,
                storageCost: Math.round(n.totalCost * 0.2 * 100) / 100,
            }));
            const totalClusterCost = namespaces.reduce((s, n) => s + n.totalCost, 0);
            return {
                success: true,
                mock: true,
                clusterName: 'aks-prod-01',
                availableClusters: [
                    { name: 'aks-prod-01', subscriptionId: 'demo', resourceGroup: 'rg-k8s-prod', nodeResourceGroup: 'MC_rg-k8s-prod_aks-prod-01_eastus' },
                    { name: 'aks-dev-02', subscriptionId: 'demo', resourceGroup: 'rg-k8s-dev', nodeResourceGroup: 'MC_rg-k8s-dev_aks-dev-02_eastus' },
                ],
                namespaceBreakdownAvailable: true,
                totalClusterCost,
                totalClusterCpuCores: 16 * (multiplier >= 50 ? 8 : multiplier >= 10 ? 4 : multiplier >= 3 ? 2 : 1),
                chargebackData: namespaces,
            };
        }
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
                    { costCenter: 'IT & Ops', subscriptionId: 'mock-sub', budget: 15000 * multiplier, actual: 12000 * multiplier },
                    { costCenter: 'Marketing', subscriptionId: 'mock-sub', budget: 5000 * multiplier, actual: 4800 * multiplier },
                    { costCenter: 'R&D', subscriptionId: 'mock-sub', budget: 8000 * multiplier, actual: 9500 * multiplier },
                    { costCenter: 'HR', subscriptionId: 'mock-sub', budget: 2000 * multiplier, actual: 1200 * multiplier }
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

        case 'forecast':
            return {
                data: [
                    { date: "2026-06-01", actualCost: 350 * multiplier },
                    { date: "2026-06-02", actualCost: 380 * multiplier },
                    { date: "2026-06-03", actualCost: 390 * multiplier },
                    { date: "2026-06-04", actualCost: 310 * multiplier },
                    { date: "2026-06-05", actualCost: 340 * multiplier },
                    { date: "2026-06-06", forecastCost: 360 * multiplier },
                    { date: "2026-06-07", forecastCost: 360 * multiplier },
                    { date: "2026-06-08", forecastCost: 360 * multiplier },
                    { date: "2026-06-09", forecastCost: 360 * multiplier },
                    { date: "2026-06-10", forecastCost: 360 * multiplier },
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
        case 'unit_economics': {
            // 30 días deterministas (sin Math.random para evitar flakiness en tests/SSR).
            const ueRows = [];
            for (let i = 29; i >= 0; i--) {
                const date = new Date(Date.now() - i * 86400000);
                const dow = date.getDay();
                const isWeekend = dow === 0 || dow === 6;
                // Variación pseudo-determinista derivada del índice del día.
                const wob = (i * 7919) % 8000;
                const dau = isWeekend ? 35000 + (wob % 5000) : 55000 + wob;
                // El costo baja menos que el tráfico en fin de semana (costos fijos),
                // por eso el costo unitario empeora los findes.
                const cost = (isWeekend ? 450 + (wob % 50) : 850 + (wob % 100)) * multiplier;
                ueRows.push({
                    date: date.toISOString().split('T')[0],
                    cost,
                    dau,
                    costPerUser: cost / dau,
                });
            }
            return {
                success: true,
                mock: true,
                data: { rows: ueRows, estimatedDau: 55000 },
            };
        }
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
        case 'governance-policies':
            return {
                success: true,
                managementGroups: [
                    { id: 'mg-root', name: 'Tenant Root Group' },
                    { id: 'mg-landingzones', name: 'Landing Zones' },
                    { id: 'mg-sandbox', name: 'Sandbox Environments' },
                    { id: 'mg-corp', name: 'Corporate Systems' }
                ],
                data: [
                    { id: 'pol-tag', name: 'Requiere Etiqueta "CostCenter"', description: 'Evita la creación de cualquier recurso en Azure si no incluye la etiqueta CostCenter.', status: 'Active', targetMg: 'mg-root' },
                    { id: 'pol-sku', name: 'Restringir Familias de VMs (GPU/Memoria)', description: 'Bloquea el aprovisionamiento de series M, NC, G, NV (Alta densidad de costo).', status: 'Inactive', targetMg: null },
                    { id: 'pol-loc', name: 'Restricción de Regiones Geográficas', description: 'Obliga a que todos los despliegues ocurran exclusivamente en East US y West Europe.', status: 'Active', targetMg: 'mg-landingzones' },
                    { id: 'pol-lrs', name: 'Forzar LRS en Entornos No Productivos', description: 'Evita la creación de Storage Accounts con redundancia geográfica (GRS) en entornos de Dev/Test para recortar costos a la mitad.', status: 'Inactive', targetMg: null },
                    { id: 'pol-ttl', name: 'Requerir Etiqueta de Expiración (TTL)', description: 'Obliga a que todos los recursos en Sandbox contengan la etiqueta ExpireOn para su eliminación automática.', status: 'Inactive', targetMg: null },
                    { id: 'pol-log', name: 'Límite de Retención en Log Analytics', description: 'Previene la configuración de Workspaces con retención superior a 30 días, evitando acumulación de logs basura.', status: 'Inactive', targetMg: null },
                    { id: 'pol-pip', name: 'Prevención de IPs Públicas Huérfanas', description: 'Prohíbe asignar direcciones IP públicas directamente a interfaces de red de Máquinas Virtuales.', status: 'Inactive', targetMg: null },
                    { id: 'pol-asp', name: 'Restricción de App Service Plans (Premium)', description: 'Bloquea el aprovisionamiento de las capas de precios Premium V3 (Pv3) de App Service sin una excepción explícita.', status: 'Inactive', targetMg: null }
                ]
            };
        case 'billing-markup':
            return {
                success: true,
                markupPercentage: 15.00
            };
        case 'commitments': {
            const now = Date.now();
            const day = 86400000;
            const iso = (ms: number) => new Date(ms).toISOString();
            // Catálogo base de reservas mock; se recorta según el tier (multiplier).
            const catalog = [
                { name: 'ri-vm-prod-eastus', type: 'VirtualMachines', productName: 'Reserved VM Instance, Standard_D4s_v3', region: 'eastus', scopeType: 'Shared', scope: 'Shared', term: 'P3Y', quantity: 12, status: 'Succeeded', renew: true, expiryMs: now + 420 * day, u1: 96.4, u7: 94.1 },
                { name: 'ri-sql-prod', type: 'SqlDatabases', productName: 'SQL Database Reserved Capacity, GP_Gen5', region: 'eastus', scopeType: 'Single', scope: 'sub-prod-01', term: 'P1Y', quantity: 4, status: 'Succeeded', renew: false, expiryMs: now + 45 * day, u1: 71.2, u7: 68.9 },
                { name: 'ri-vm-web-westus', type: 'VirtualMachines', productName: 'Reserved VM Instance, Standard_E8s_v4', region: 'westus2', scopeType: 'Single', scope: 'sub-web-02', term: 'P3Y', quantity: 8, status: 'Succeeded', renew: true, expiryMs: now + 610 * day, u1: 88.7, u7: 90.3 },
                { name: 'ri-redis-cache', type: 'RedisCache', productName: 'Azure Cache for Redis Reserved, Premium P2', region: 'westeurope', scopeType: 'Shared', scope: 'Shared', term: 'P1Y', quantity: 2, status: 'Succeeded', renew: false, expiryMs: now + 12 * day, u1: 54.0, u7: 58.6 },
                { name: 'sp-compute-shared', type: 'VirtualMachines', productName: 'Compute Savings Plan', region: 'Global', scopeType: 'Shared', scope: 'Shared', term: 'P3Y', quantity: 1, status: 'Succeeded', renew: true, expiryMs: now + 900 * day, u1: 99.1, u7: 97.8 },
                { name: 'ri-postgres-prod', type: 'PostgreSqlDatabases', productName: 'Azure Database for PostgreSQL Reserved, GP_Gen5_8', region: 'eastus2', scopeType: 'Single', scope: 'sub-data-03', term: 'P1Y', quantity: 3, status: 'Expired', renew: false, expiryMs: now - 5 * day, u1: null, u7: null },
            ];
            const takeCount = multiplier >= 50 ? 6 : multiplier >= 10 ? 4 : multiplier >= 3 ? 3 : 2;
            const reservationDetails = catalog.slice(0, takeCount).map((r, i) => ({
                reservationId: `res-mock-${i + 1}`,
                orderId: `order-mock-${i + 1}`,
                name: r.name,
                status: r.status,
                expiryDate: iso(r.expiryMs),
                scopeType: r.scopeType,
                scope: r.scope,
                type: r.type,
                productName: r.productName,
                region: r.region,
                renew: r.renew,
                quantity: r.quantity,
                term: r.term,
                utilizationLastDay: r.u1,
                utilizationLast7Days: r.u7,
            }));
            const activeReservations = reservationDetails
                .filter(r => r.status !== 'Expired')
                .map(r => ({ serviceName: r.type, reservationName: r.name, cost: Math.round(r.quantity * 320 * (multiplier >= 10 ? 1.4 : 1)) }));
            return {
                success: true,
                data: {
                    utilization: 82.5, // 82.5% de uso
                    coverage: 45.0, // 45% de cobertura total de computo
                    hasReservations: reservationDetails.length > 0,
                    activeReservations,
                    reservationDetails,
                    recommendations: [
                        { type: 'VirtualMachines', sku: 'Standard_D4s_v3', recommendedQuantity: 12, monthlySavings: 1240.50, term: 'P3Y' },
                        { type: 'VirtualMachines', sku: 'Standard_E8s_v4', recommendedQuantity: 4, monthlySavings: 890.00, term: 'P1Y' },
                        { type: 'AppService', sku: 'PremiumV3', recommendedQuantity: 2, monthlySavings: 310.25, term: 'P3Y' }
                    ]
                }
            };
        }
        case 'reservation_utilization': {
            const today = Date.now();
            const day = 86400000;
            const trend = Array.from({ length: 30 }).map((_, i) => {
                const d = new Date(today - (29 - i) * day);
                const base = 90 + Math.sin(i / 3) * 6;
                return { date: d.toISOString().slice(0, 10), utilization: Math.max(0, Math.min(100, Number(base.toFixed(1)))) };
            });
            const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
            return {
                aggregates: {
                    oneDay: Number(trend[trend.length - 1].utilization.toFixed(1)),
                    sevenDays: Number(avg(trend.slice(-7).map(t => t.utilization)).toFixed(1)),
                    thirtyDays: Number(avg(trend.map(t => t.utilization)).toFixed(1)),
                },
                trend,
            };
        }
        case 'dashboard_summary': {
            const tierMult = (arg2 || '').toLowerCase() === 'enterprise' ? 5
                : (arg2 || '').toLowerCase() === 'business' ? 2.5
                : (arg2 || '').toLowerCase().startsWith('pro') ? 1.5 : 1;
            const base = 12500 * tierMult;
            const proj = base * 1.18;
            const sav = base * 0.22;
            // Histograma diario de los últimos 13 meses (~400 días) para que el
            // selector "hasta 13 meses" (límite histórico de Azure Cost
            // Management) tenga datos. El frontend espera { date, cost } (NO
            // { name, value }): la forma anterior dejaba el histograma vacío.
            // Determinista-ish: gasto diario base con tendencia + estacionalidad
            // semanal (fines de semana más bajos) + ruido acotado.
            const dailyBase = base / 30; // ~gasto diario del mes actual
            const HIST_DAYS = 400;
            const histogram = Array.from({ length: HIST_DAYS }).map((_, i) => {
                const d = new Date(Date.now() - (HIST_DAYS - 1 - i) * 86400000);
                const iso = d.toISOString().slice(0, 10);
                const dow = d.getUTCDay(); // 0=domingo, 6=sábado
                const weekendFactor = (dow === 0 || dow === 6) ? 0.72 : 1;
                const trend = 0.82 + 0.36 * (i / (HIST_DAYS - 1)); // crecimiento suave a lo largo del período
                const noise = 0.9 + 0.2 * Math.abs(Math.sin(i * 1.7));
                return { date: iso, cost: Number((dailyBase * trend * weekendFactor * noise).toFixed(2)) };
            });
            return {
                success: true,
                mock: true,
                actualCost: Math.round(base),
                projectedCost: Math.round(proj),
                zombieCount: Math.round(48 * tierMult),
                totalSavings: Math.round(sav),
                environmentalImpact: Number(((sav / 100) * 15).toFixed(1)),
                // Score de gobernanza pre-calculado: el frontend lo prefiere sobre
                // el cálculo por-recurso cuando viene presente (ver page.tsx). Sin
                // esto, el cálculo sobre los recursos zombie —que legítimamente no
                // tienen tags— arrojaba ~0%, dando la impresión de "sin datos".
                complianceScore: (arg2 || '').toLowerCase() === 'enterprise' ? 86
                    : (arg2 || '').toLowerCase() === 'business' ? 78
                    : (arg2 || '').toLowerCase().startsWith('pro') ? 71 : 64,
                histogram,
                dashboardData: [
                    { type: 'Disk', name: 'orphan-disk-01', issueType: 'cost', potentialSavings: 78, sizeGB: 512 },
                    { type: 'Public IP', name: 'pip-legacy', issueType: 'cost', potentialSavings: 4.2 },
                    { type: 'NAT Gateway', name: 'nat-old-east', issueType: 'cost', potentialSavings: 32 },
                    { type: 'App Service Plan', name: 'asp-dev-empty', issueType: 'cost', potentialSavings: 45 },
                    { type: 'NIC', name: 'nic-zombie-04', issueType: 'governance', potentialSavings: 0 }
                ],
                auditResults: getMockDataForRoute('audit_full', arg2)?.auditResults || {}
            };
        }
        case 'approvals':
            return {
                success: true,
                mock: true,
                data: [
                    { id: 1, resource_id: '/subscriptions/demo/resourceGroups/rg-prod/providers/Microsoft.Compute/disks/orphan-disk-01', resource_name: 'orphan-disk-01 (Premium SSD 512GB)', action_type: 'DELETE_RESOURCE', estimated_savings: 78.40, status: 'Pending', requested_by: 'advisor-bot@demo.local', requested_at: new Date(Date.now() - 1000*60*60*3).toISOString(), resolved_at: null, resolved_by: null },
                    { id: 2, resource_id: '/subscriptions/demo/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/vm-dev-04', resource_name: 'vm-dev-04 (Standard_D8s_v5 → D4s_v5)', action_type: 'RIGHTSIZE_VM', estimated_savings: 142.10, status: 'Pending', requested_by: 'rightsizing-engine@demo.local', requested_at: new Date(Date.now() - 1000*60*60*9).toISOString(), resolved_at: null, resolved_by: null },
                    { id: 3, resource_id: '/subscriptions/demo/resourceGroups/rg-net/providers/Microsoft.Network/publicIPAddresses/pip-legacy', resource_name: 'pip-legacy (Public IP huérfana)', action_type: 'DELETE_RESOURCE', estimated_savings: 4.20, status: 'Approved', requested_by: 'zombie-scanner@demo.local', requested_at: new Date(Date.now() - 1000*60*60*48).toISOString(), resolved_at: new Date(Date.now() - 1000*60*60*47).toISOString(), resolved_by: 'admin@demo.local' },
                    { id: 4, resource_id: '/subscriptions/demo/resourceGroups/rg-data/providers/Microsoft.Storage/storageAccounts/saoldlogs', resource_name: 'saoldlogs (Hot → Cool tier)', action_type: 'CHANGE_TIER', estimated_savings: 65.00, status: 'Approved', requested_by: 'storage-efficiency@demo.local', requested_at: new Date(Date.now() - 1000*60*60*72).toISOString(), resolved_at: new Date(Date.now() - 1000*60*60*70).toISOString(), resolved_by: 'admin@demo.local' },
                    { id: 5, resource_id: '/subscriptions/demo/resourceGroups/rg-test/providers/Microsoft.Compute/virtualMachines/vm-stress-test', resource_name: 'vm-stress-test (Power Off por inactividad)', action_type: 'POWER_OFF', estimated_savings: 28.60, status: 'Rejected', requested_by: 'smart-shutdown@demo.local', requested_at: new Date(Date.now() - 1000*60*60*96).toISOString(), resolved_at: new Date(Date.now() - 1000*60*60*95).toISOString(), resolved_by: 'admin@demo.local' }
                ]
            };
        case 'payments':
            return {
                mock: true,
                tier: 'Enterprise',
                status: 'active',
                renewsAt: new Date(Date.now() + 1000*60*60*24*22).toISOString(),
                monthlyAmount: 1499.00,
                currency: 'USD',
                paymentMethod: { brand: 'Visa', last4: '4242', exp: '12/28' },
                portalUrl: 'https://billing.stripe.com/p/login/test_demo',
                invoices: [
                    { id: 'INV-2026-05', date: '2026-05-01', amount: 1499.00, status: 'paid', pdfUrl: '#' },
                    { id: 'INV-2026-04', date: '2026-04-01', amount: 1499.00, status: 'paid', pdfUrl: '#' },
                    { id: 'INV-2026-03', date: '2026-03-01', amount: 1499.00, status: 'paid', pdfUrl: '#' }
                ]
            };
        case 'macc': {
            // MACC scales by tier: Enterprise = large multi-commitment, Business = mid, Pro/Essential = small atRisk
            const today = new Date();
            const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

            const makeCommitment = (
                id: number,
                billingAccountId: string,
                commitmentAmount: number,
                progressPct: number,
                startMonthsAgo: number,
                durationMonths: number
            ) => {
                const startDate = new Date(today);
                startDate.setMonth(startDate.getMonth() - startMonthsAgo);
                const endDate = new Date(startDate);
                endDate.setMonth(endDate.getMonth() + durationMonths);
                const daysTotal = (endDate.getTime() - startDate.getTime()) / 86400000;
                const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - today.getTime()) / 86400000));
                const consumedAmount = Math.round(commitmentAmount * (progressPct / 100));
                const remainingAmount = commitmentAmount - consumedAmount;
                const burnRateMonthly = Math.round(consumedAmount / Math.max(1, startMonthsAgo));
                const projectedConsumption = Math.round(consumedAmount + burnRateMonthly * (daysRemaining / 30));
                const monthlyTarget = Math.round(commitmentAmount / durationMonths);
                const status: "onTrack" | "atRisk" | "overConsumption" =
                    projectedConsumption > commitmentAmount ? "overConsumption"
                    : projectedConsumption < commitmentAmount * 0.9 ? "atRisk"
                    : "onTrack";
                return {
                    id,
                    billingAccountId,
                    billingProfileId: `BP-${billingAccountId}`,
                    commitmentAmount,
                    consumedAmount,
                    remainingAmount,
                    burnRateMonthly,
                    startDate: fmtDate(startDate),
                    endDate: fmtDate(endDate),
                    currency: "USD",
                    progressPercent: progressPct,
                    daysRemaining,
                    projectedConsumption,
                    status,
                    monthlyTarget,
                };
            };

            let commitments: ReturnType<typeof makeCommitment>[];
            if (multiplier >= 50) {
                // Enterprise: two large MACCs, multi-year
                commitments = [
                    makeCommitment(1, "EA-87654321", 10_000_000, 62, 10, 24),
                    makeCommitment(2, "EA-99001234", 5_000_000,  45, 4,  12),
                ];
            } else if (multiplier >= 10) {
                // Business: one mid MACC, 2-year
                commitments = [
                    makeCommitment(1, "EA-55443322", 2_000_000, 55, 7, 24),
                ];
            } else if (multiplier >= 3) {
                // Pro: smaller commitment, near-atRisk to show the alert
                commitments = [
                    makeCommitment(1, "EA-33221100", 500_000, 40, 5, 12),
                ];
            } else {
                // Essential: very small, atRisk (under-consumption)
                commitments = [
                    makeCommitment(1, "EA-11220033", 100_000, 28, 4, 12),
                ];
            }

            const totalCommitment  = commitments.reduce((s, c) => s + c.commitmentAmount, 0);
            const totalConsumed    = commitments.reduce((s, c) => s + c.consumedAmount, 0);
            const totalRemaining   = commitments.reduce((s, c) => s + c.remainingAmount, 0);
            const overallProgress  = totalCommitment > 0 ? Math.round((totalConsumed / totalCommitment) * 100) : 0;
            const totalProjected   = commitments.reduce((s, c) => s + c.projectedConsumption, 0);
            const overallStatus: "onTrack" | "atRisk" | "overConsumption" =
                totalProjected > totalCommitment ? "overConsumption"
                : totalProjected < totalCommitment * 0.9 ? "atRisk"
                : "onTrack";

            return {
                success: true,
                mock: true,
                commitments,
                aggregates: { totalCommitment, totalConsumed, totalRemaining, overallProgress, overallStatus },
            };
        }
        case 'alerts': {
            const now = Date.now();
            const h = 3600000;
            const baseThreshold = multiplier === 1 ? 2000 : multiplier === 3 ? 10000 : multiplier === 10 ? 50000 : 250000;
            const allRules = [
                // Essential+: budget % alert
                { id: 'mock-alert-1', ruleName: 'Budget Alert > 80%', ruleType: 'budget', thresholdValue: 80, thresholdUnit: 'percent', channel: 'email', channelTarget: 'finops@contoso.com', enabled: true, lastTriggeredAt: new Date(now - 15 * 24 * h).toISOString(), triggerCount: 3 },
                // Essential+: threshold USD
                { id: 'mock-alert-2', ruleName: `Threshold $${baseThreshold.toLocaleString()} USD`, ruleType: 'threshold', thresholdValue: baseThreshold, thresholdUnit: 'usd', channel: 'webhook', channelTarget: 'https://hooks.contoso.com/finops', enabled: true, lastTriggeredAt: new Date(now - 3 * 24 * h).toISOString(), triggerCount: 1 },
                // Pro+: anomaly
                { id: 'mock-alert-3', ruleName: 'Cost Anomaly Detection (25%)', ruleType: 'anomaly', thresholdValue: 25, thresholdUnit: 'percent', channel: 'teams', channelTarget: 'https://hooks.teams.example/webhook-finops', enabled: true, lastTriggeredAt: new Date(now - 10 * h).toISOString(), triggerCount: 7 },
                // Pro+: forecast overrun
                { id: 'mock-alert-4', ruleName: 'Forecast Overrun > 110%', ruleType: 'forecast', thresholdValue: 110, thresholdUnit: 'percent', channel: 'slack', channelTarget: '#finops-alerts', enabled: false, lastTriggeredAt: null, triggerCount: 0 },
                // Pro+: budget crítico
                { id: 'mock-alert-5', ruleName: 'Budget CRÍTICO > 95%', ruleType: 'budget', thresholdValue: 95, thresholdUnit: 'percent', channel: 'email', channelTarget: 'director@contoso.com', enabled: true, lastTriggeredAt: new Date(now - 48 * h).toISOString(), triggerCount: 2 },
                // Business+: anomaly tight
                { id: 'mock-alert-6', ruleName: 'Cost Anomaly Detection (15%)', ruleType: 'anomaly', thresholdValue: 15, thresholdUnit: 'percent', channel: 'servicenow', channelTarget: 'https://contoso.service-now.com/api/finops/alert', enabled: true, lastTriggeredAt: new Date(now - 6 * h).toISOString(), triggerCount: 12 },
                // Business+: Threshold por suscripción
                { id: 'mock-alert-7', ruleName: 'Prod Subscription > $' + Math.round(baseThreshold * 0.6).toLocaleString(), ruleType: 'threshold', thresholdValue: Math.round(baseThreshold * 0.6), thresholdUnit: 'usd', channel: 'teams', channelTarget: 'https://hooks.teams.example/webhook-ops', enabled: true, lastTriggeredAt: null, triggerCount: 0 },
                // Enterprise: multiple high-value rules
                { id: 'mock-alert-8', ruleName: 'Enterprise Total > $' + Math.round(baseThreshold * 1.5).toLocaleString(), ruleType: 'threshold', thresholdValue: Math.round(baseThreshold * 1.5), thresholdUnit: 'usd', channel: 'servicenow', channelTarget: 'https://contoso.service-now.com/api/finops/critical', enabled: true, lastTriggeredAt: new Date(now - 2 * h).toISOString(), triggerCount: 4 },
                { id: 'mock-alert-9', ruleName: 'AI Anomaly Confidence > 90%', ruleType: 'anomaly', thresholdValue: 10, thresholdUnit: 'percent', channel: 'teams', channelTarget: 'https://hooks.teams.example/webhook-exec', enabled: true, lastTriggeredAt: new Date(now - 30 * h).toISOString(), triggerCount: 19 },
                { id: 'mock-alert-10', ruleName: 'Monthly Forecast Overrun > 105%', ruleType: 'forecast', thresholdValue: 105, thresholdUnit: 'percent', channel: 'email', channelTarget: 'cfo@contoso.com', enabled: true, lastTriggeredAt: null, triggerCount: 0 },
            ];
            const count = multiplier === 1 ? 2 : multiplier === 3 ? 5 : multiplier === 10 ? 7 : 10;
            return { success: true, mock: true, rules: allRules.slice(0, count) };
        }
        case 'governance-reporting': {
            const m = multiplier;
            return {
                success: true,
                mock: true,
                subscriptionsEvaluated: m >= 10 ? 4 : m === 3 ? 2 : 1,
                policyCompliance: {
                    nonCompliantResources: 3 * m,
                    nonCompliantPolicies: Math.max(1, Math.round(m / 2)),
                    policyAssignments: 4 + m,
                    available: true,
                    detail: {
                        nonCompliantResources: Array.from({ length: Math.min(3 * m, 25) }, (_, i) => ({
                            resourceId: `/subscriptions/mock-sub/resourceGroups/rg-demo/providers/Microsoft.Compute/virtualMachines/vm-demo-${i + 1}`,
                            name: `vm-demo-${i + 1}`,
                            type: i % 3 === 0 ? 'microsoft.compute/virtualmachines' : i % 3 === 1 ? 'microsoft.storage/storageaccounts' : 'microsoft.network/publicipaddresses',
                            policyName: i % 2 === 0 ? 'Require a tag on resources (CostCenter)' : 'Allowed virtual machine size SKUs',
                            assignmentName: i % 2 === 0 ? 'Tag Governance Baseline' : 'Cost Control - VM SKUs',
                        })),
                        nonCompliantPolicies: [
                            { name: 'Require a tag on resources (CostCenter)', count: 2 * m },
                            { name: 'Allowed virtual machine size SKUs', count: m },
                        ],
                        assignments: [
                            { name: 'Tag Governance Baseline', scope: '/subscriptions/mock-sub', nonCompliantCount: 2 * m },
                            { name: 'Cost Control - VM SKUs', scope: '/subscriptions/mock-sub', nonCompliantCount: m },
                            { name: 'Security Baseline (ASC)', scope: '/subscriptions/mock-sub', nonCompliantCount: 0 },
                            { name: 'Diagnostic Settings Required', scope: '/subscriptions/mock-sub', nonCompliantCount: 0 },
                        ],
                    },
                },
                resourceInventory: {
                    total: 40 * m,
                    byType: [
                        { type: 'microsoft.compute/virtualmachines', count: 8 * m },
                        { type: 'microsoft.storage/storageaccounts', count: 6 * m },
                        { type: 'microsoft.network/networkinterfaces', count: 6 * m },
                        { type: 'microsoft.network/publicipaddresses', count: 4 * m },
                        { type: 'microsoft.sql/servers/databases', count: 3 * m },
                    ],
                    byLocation: [
                        { location: 'eastus', count: 22 * m },
                        { location: 'westeurope', count: 12 * m },
                        { location: 'brazilsouth', count: 6 * m },
                    ],
                },
                identities: {
                    totalAssignments: 12 * m,
                    byPrincipalType: [
                        { principalType: 'User', count: 7 * m },
                        { principalType: 'ServicePrincipal', count: 3 * m },
                        { principalType: 'Group', count: 2 * m },
                    ],
                },
            };
        }
        case 'commitment-simulator': {
            // Ahorro mensual estimado por RI y por SP, escalado por tier.
            const riY1 = 120 * multiplier, riY3 = 210 * multiplier;
            const spY1 = 135 * multiplier, spY3 = 195 * multiplier;
            return {
                success: true,
                mock: true,
                currency: 'USD',
                subscriptionsEvaluated: multiplier >= 10 ? 4 : multiplier === 3 ? 2 : 1,
                reservation: {
                    oneYear: { monthlySavings: riY1, recommendations: Math.max(1, multiplier) },
                    threeYear: { monthlySavings: riY3, recommendations: Math.max(1, multiplier) },
                },
                savingsPlan: {
                    oneYear: { monthlySavings: spY1, savingsPct: 17, coveragePct: 62, hourlyCommitment: parseFloat((spY1 / 30 / 24).toFixed(2)) },
                    threeYear: { monthlySavings: spY3, savingsPct: 24, coveragePct: 68, hourlyCommitment: parseFloat((spY3 / 30 / 24).toFixed(2)) },
                },
                // Y1: SP gana (flexibilidad); Y3: RI gana (mayor profundidad si es estable).
                verdict: { oneYear: 'savingsPlan', threeYear: 'reservation' },
                hasData: true,
            };
        }
        case 'cost-by-category': {
            // Reparto por categoría FinOps, escalado por tier. Shares realistas:
            // Compute domina, seguido de Storage/Networking/Databases.
            const monthlyTotal = 1800 * multiplier;
            const shares: Array<{ category: string; share: number }> = [
                { category: 'Compute', share: 0.42 },
                { category: 'Storage', share: 0.17 },
                { category: 'Networking', share: 0.13 },
                { category: 'Databases', share: 0.11 },
                { category: 'Management and Governance', share: 0.06 },
                { category: 'Web', share: 0.05 },
                { category: 'Analytics', share: 0.04 },
                { category: 'AI and Machine Learning', share: 0.02 },
            ];
            const categories = shares.map(s => ({
                category: s.category,
                cost: parseFloat((monthlyTotal * s.share).toFixed(2)),
                percent: Math.round(s.share * 100),
            }));
            return {
                success: true,
                mock: true,
                categories,
                total: parseFloat(monthlyTotal.toFixed(2)),
                topCategory: 'Compute',
                diagnostics: { requestedDays: 30, effectiveDays: 30, rowsFound: categories.length },
            };
        }
        case 'cost-projection': {
            // 13 meses (~400 días) de gasto diario real (con tendencia +
            // estacionalidad semanal) para el histograma de "Gastos y
            // Proyección" en modo demo; el agregado mensual se deriva de él.
            const monthlyBase = 12500 * multiplier / 30 * 30.44; // consistente con dashboard_summary
            const dailyBase = monthlyBase / 30.44;
            const DAYS = 400;
            const dailyHistory = Array.from({ length: DAYS }).map((_, i) => {
                const d = new Date(Date.now() - (DAYS - 1 - i) * 86400000);
                const iso = d.toISOString().slice(0, 10);
                const dow = d.getUTCDay();
                const weekendFactor = (dow === 0 || dow === 6) ? 0.72 : 1;
                const trend = 0.85 + 0.3 * (i / (DAYS - 1));
                const noise = 0.95 + 0.1 * Math.abs(Math.sin(i * 1.3));
                return { date: iso, cost: Number((dailyBase * trend * weekendFactor * noise).toFixed(2)) };
            });
            const byMonth = new Map<string, number>();
            for (const { date, cost } of dailyHistory) {
                const m = date.slice(0, 7);
                byMonth.set(m, (byMonth.get(m) || 0) + cost);
            }
            const monthlyHistory = Array.from(byMonth.entries())
                .map(([month, cost]) => ({ month, cost: Number(cost.toFixed(2)) }))
                .sort((a, b) => a.month.localeCompare(b.month));
            return { success: true, mock: true, dailyHistory, monthlyHistory };
        }
        case 'compute-efficiency': {
            const baseCores       = 40 * multiplier;
            const baseCostPerCore = multiplier === 1 ? 28 : multiplier === 3 ? 33 : multiplier === 10 ? 38 : 45;
            const effectiveCost   = Math.round(baseCores * baseCostPerCore);
            const totalCost       = Math.round(effectiveCost * 1.28); // sin compromisos
            const benchmark       = 42.50;
            const now = new Date();
            const trend = Array.from({ length: 6 }).map((_, i) => {
                const d = new Date(now);
                d.setMonth(d.getMonth() - (5 - i));
                const drift = 1 + (5 - i) * 0.06; // trending down toward present
                return {
                    month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
                    costPerCore: parseFloat((baseCostPerCore * drift).toFixed(2)),
                };
            });
            const regionSplit: { region: string; share: number; costPerCore: number }[] =
                multiplier === 1
                    ? [{ region: 'eastus', share: 1.0, costPerCore: 27 }]
                    : multiplier === 3
                    ? [{ region: 'eastus', share: 0.55, costPerCore: 31 }, { region: 'westeurope', share: 0.3, costPerCore: 36 }, { region: 'brazilsouth', share: 0.15, costPerCore: 40 }]
                    : multiplier === 10
                    ? [{ region: 'eastus', share: 0.4, costPerCore: 34 }, { region: 'westeurope', share: 0.25, costPerCore: 38 }, { region: 'brazilsouth', share: 0.2, costPerCore: 42 }, { region: 'southeastasia', share: 0.15, costPerCore: 36 }]
                    : [{ region: 'eastus', share: 0.3, costPerCore: 40 }, { region: 'westeurope', share: 0.22, costPerCore: 44 }, { region: 'brazilsouth', share: 0.15, costPerCore: 48 }, { region: 'southeastasia', share: 0.13, costPerCore: 43 }, { region: 'australiaeast', share: 0.12, costPerCore: 46 }, { region: 'japaneast', share: 0.08, costPerCore: 45 }];
            const skuSplit: { sku: string; share: number; coreSize: number; costPerCore: number }[] =
                multiplier === 1
                    ? [{ sku: 'Standard_B2s', share: 0.5, coreSize: 2, costPerCore: 13 }, { sku: 'Standard_D4s_v5', share: 0.5, coreSize: 4, costPerCore: 38 }]
                    : multiplier === 3
                    ? [{ sku: 'Standard_D4s_v5', share: 0.45, coreSize: 4, costPerCore: 38 }, { sku: 'Standard_E8s_v5', share: 0.35, coreSize: 8, costPerCore: 52 }, { sku: 'Standard_B2s', share: 0.2, coreSize: 2, costPerCore: 13 }]
                    : [{ sku: 'Standard_D4s_v5', share: 0.35, coreSize: 4, costPerCore: 38 }, { sku: 'Standard_E8s_v5', share: 0.3, coreSize: 8, costPerCore: 52 }, { sku: 'Standard_F16s_v2', share: 0.2, coreSize: 16, costPerCore: 44 }, { sku: 'Standard_B2s', share: 0.1, coreSize: 2, costPerCore: 13 }, { sku: 'Standard_D16s_v5', share: 0.05, coreSize: 16, costPerCore: 41 }];
            return {
                success: true,
                mock: true,
                totalCores: baseCores,
                totalCost,
                effectiveCost,
                costPerCore: baseCostPerCore,
                costPerCoreNoCommitments: parseFloat((baseCostPerCore * 1.28).toFixed(2)),
                savingsFromCommitments: 22,
                byRegion: regionSplit.map(r => ({ region: r.region, cores: Math.round(baseCores * r.share), costPerCore: r.costPerCore })),
                bySku: skuSplit.map(s => ({ sku: s.sku, cores: Math.round(baseCores * s.share), cost: Math.round(baseCores * s.share * s.costPerCore), costPerCore: s.costPerCore })),
                trend,
                benchmark,
            };
        }
        case 'mobile-summary': {
            // Resumen de la app móvil: mismos campos que /api/dashboard/summary.
            return {
                actualCost: Math.round(1000 * multiplier * 0.85),
                projectedCost: Math.round(1000 * multiplier * 1.08),
                totalSavings: Math.round(180 * multiplier),
                zombieCount: Math.max(1, Math.round(4 + multiplier / 3)),
            };
        }
        case 'platform-budgets': {
            // Presupuestos de plataforma por cost center (tabla Budgets), para la
            // demo del gestor en /intelligence/budgets. Escala por tier.
            const mkBudget = (id: number, costCenter: string, limit: number, spendPct: number, threshold = 80) => ({
                id,
                costCenter,
                monthlyLimit: Math.round(limit * multiplier),
                alertThreshold: threshold,
                currentSpend: Math.round(limit * multiplier * spendPct / 100),
                utilization: spendPct,
            });
            const base = [
                mkBudget(101, 'engineering', 1200, 72),
                mkBudget(102, 'marketing', 400, 91, 85),
            ];
            const extra = [
                mkBudget(103, 'data-platform', 2500, 58),
                mkBudget(104, 'shared-services', 900, 103, 90),
            ];
            return { success: true, budgets: multiplier >= 3 ? [...base, ...extra] : base };
        }
        case 'support': {
            // Sistema de soporte interno: tickets de demo escalados por tier.
            // Cada ticket incluye mockMessages para que la vista de hilo funcione
            // en modo demo sin llamar a la API de detalle.
            const tierName = tier.toLowerCase();
            const quota = tierName === 'enterprise' || tierName === 'business'
                ? { monthlyLimit: null, usedThisMonth: 3, firstResponseSlaHours: tierName === 'enterprise' ? 4 : 8 }
                : tierName === 'pro' || tierName === 'professional'
                    ? { monthlyLimit: 20, usedThisMonth: 4, firstResponseSlaHours: 24 }
                    : { monthlyLimit: 5, usedThisMonth: 2, firstResponseSlaHours: 48 };

            const now = Date.now();
            const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3600000).toISOString();
            const baseTickets = [
                {
                    id: 9001, subject: "Discrepancia en el costo amortizado de Reservas", category: "billing",
                    status: "waiting_customer", priority: "high", created_by_email: "ana@demo.com", created_by_name: "Ana Torres",
                    created_at: iso(50), updated_at: iso(3), last_message_at: iso(3), message_count: 3,
                    mockMessages: [
                        { id: 1, author_email: "ana@demo.com", author_name: "Ana Torres", author_role: "user", body: "El costo amortizado de las RIs del mes pasado no coincide con la factura de Azure. ¿Pueden revisar?", created_at: iso(50) },
                        { id: 2, author_email: "soporte@cscloudsolutions.com.ar", author_name: "Soporte CSCloud", author_role: "support", body: "Hola Ana, estamos revisando la conciliación contra el invoice de Azure. ¿Podés confirmar el subscription ID afectado?", created_at: iso(26) },
                        { id: 3, author_email: "soporte@cscloudsolutions.com.ar", author_name: "Soporte CSCloud", author_role: "support", body: "Detectamos que la diferencia corresponde al prorrateo de una RI comprada a mitad de mes. Te compartimos el detalle del cálculo.", created_at: iso(3) },
                    ],
                },
                {
                    id: 9002, subject: "¿Cómo configuro alertas de presupuesto por cost center?", category: "question",
                    status: "resolved", priority: "medium", created_by_email: "luis@demo.com", created_by_name: "Luis Gómez",
                    created_at: iso(120), updated_at: iso(96), last_message_at: iso(96), message_count: 2,
                    mockMessages: [
                        { id: 1, author_email: "luis@demo.com", author_name: "Luis Gómez", author_role: "user", body: "Quiero recibir una alerta cuando un cost center supere el 80% del presupuesto.", created_at: iso(120) },
                        { id: 2, author_email: "soporte@cscloudsolutions.com.ar", author_name: "Soporte CSCloud", author_role: "support", body: "Podés hacerlo desde Inteligencia → Alertas (Self-Service), creando una regla de tipo presupuesto con umbral 80%. Te dejo la guía del manual.", created_at: iso(96) },
                    ],
                },
            ];
            const extraTickets = [
                {
                    id: 9003, subject: "Error 429 al refrescar el panel de Rightsizing", category: "technical",
                    status: "in_progress", priority: "urgent", created_by_email: "sofia@demo.com", created_by_name: "Sofía Méndez",
                    created_at: iso(8), updated_at: iso(1), last_message_at: iso(1), message_count: 2,
                    mockMessages: [
                        { id: 1, author_email: "sofia@demo.com", author_name: "Sofía Méndez", author_role: "user", body: "Desde esta mañana el panel de Rightsizing devuelve error de throttling al refrescar.", created_at: iso(8) },
                        { id: 2, author_email: "soporte@cscloudsolutions.com.ar", author_name: "Soporte CSCloud", author_role: "support", body: "Confirmado: Azure Cost Management está limitando las consultas de tu tenant. Estamos aplicando backoff y cache extendido; te avisamos en cuanto se normalice.", created_at: iso(1) },
                    ],
                },
                {
                    id: 9004, subject: "Solicitud: exportar Scorecard a Power BI", category: "feature_request",
                    status: "open", priority: "low", created_by_email: "carlos@demo.com", created_by_name: "Carlos Ruiz",
                    created_at: iso(4), updated_at: iso(4), last_message_at: iso(4), message_count: 1,
                    mockMessages: [
                        { id: 1, author_email: "carlos@demo.com", author_name: "Carlos Ruiz", author_role: "user", body: "Nos gustaría poder exportar el Scorecard de equipos directamente a Power BI.", created_at: iso(4) },
                    ],
                },
            ];
            const tickets = multiplier >= 3 ? [...extraTickets, ...baseTickets] : baseTickets;
            return { success: true, tickets, quota };
        }
        default:
            return { success: true, message: "Mock data not defined for this route" };
    }
};
