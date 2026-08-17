import { getAdvisorMock } from './advisorMock';
import { generateHistoricalProgressReport } from './historicalProgressGenerator';

/**
 * Tenants de demo de Azure, uno por tier (Professional/Business/Enterprise
 * — el antiguo tier Essential se descontinuó, ver migrations/).
 */
export const MOCK_AZURE_TENANTS = [
    "22222222-3333-4444-5555-666666666666",
    "44444444-5555-6666-7777-888888888888",
    "33333333-4444-5555-6666-777777777777",
] as const;

export const isMockTenant = (tenantId: string) => {
    return ([...MOCK_AZURE_TENANTS, "demo_tenant"] as string[])
        .includes(tenantId);
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
    const t = (tier || 'professional').toLowerCase();
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


// Tier fijo de cada tenant de demo (ver TenantProvider.tsx, misma fuente de
// verdad). Antes, cuando getMockDataForRoute recibía un tenantId (caller
// server-side) en vez de un tier (caller client-side), se forzaba 'essential'
// sin importar el tenant real — cualquier ruta backend sin interceptor mock
// en TenantProvider.tsx (ej. /api/support/tickets) mostraba datos escalados
// al tier más bajo incluso para tenants Business/Enterprise.
const MOCK_TENANT_TIER: Record<string, string> = {
    "22222222-3333-4444-5555-666666666666": "pro",
    "44444444-5555-6666-7777-888888888888": "business",
    "33333333-4444-5555-6666-777777777777": "enterprise",
};

type NetworkFamily = "analysis" | "basic" | "hybrid" | "balancing" | "internet";

const NETWORK_SERVICES_BY_FAMILY: Record<NetworkFamily, string[]> = {
    analysis: [
        "Virtual Networks",
        "Subnets",
        "Network Security Groups (NSG)",
        "Route Tables (UDR)",
        "Private Endpoints",
        "Private DNS Zones",
        "VPN Gateway",
        "ExpressRoute",
        "Virtual WAN",
        "Local Network Gateway",
        "Load Balancer",
        "Application Gateway",
        "Front Door",
        "Traffic Manager",
        "Public IP",
        "NAT Gateway",
        "Azure Firewall",
        "DDoS Protection",
    ],
    basic: [
        "Virtual Networks",
        "Subnets",
        "Network Security Groups (NSG)",
        "Route Tables (UDR)",
        "Private Endpoints",
        "Private DNS Zones",
    ],
    hybrid: [
        "VPN Gateway",
        "ExpressRoute",
        "Virtual WAN",
        "Local Network Gateway",
    ],
    balancing: [
        "Load Balancer",
        "Application Gateway",
        "Front Door",
        "Traffic Manager",
    ],
    internet: [
        "Public IP",
        "NAT Gateway",
        "Azure Firewall",
        "DDoS Protection",
    ],
};

const maybePublicIpForService = (serviceLabel: string, idx: number, rowIdx: number): string => {
    const s = serviceLabel.toLowerCase();
    if (s.includes("public ip") || s.includes("load balancer") || s.includes("gateway") || s.includes("firewall")) {
        return `20.${30 + (idx % 20)}.${40 + (rowIdx % 20)}.${10 + ((idx + rowIdx) % 200)}`;
    }
    return "-";
};

export const getMockNetworkServiceCostV2 = (arg2: string, family: NetworkFamily): any => {
    const isTenantId = arg2 && arg2.length > 20;
    const tier = (isTenantId ? MOCK_TENANT_TIER[arg2] : arg2) || 'professional';
    const t = String(tier).toLowerCase();
    const multiplier = t === 'enterprise' ? 50 : t === 'business' ? 10 : t === 'pro' || t === 'professional' ? 3 : 1;

    const services = NETWORK_SERVICES_BY_FAMILY[family] || NETWORK_SERVICES_BY_FAMILY.analysis;
    const items = services.map((serviceLabel, idx) => ({
        serviceLabel,
        monthlyCost: Number((35 * multiplier + (idx + 1) * 11.75 * multiplier).toFixed(2)),
        resourceCount: 2 + (idx % 4) + (multiplier > 1 ? 1 : 0),
    }));

    const subNames = ["Production", "Staging", "Sandbox"];
    const rows = items.flatMap((item, idx) =>
        Array.from({ length: item.resourceCount }).map((_, rowIdx) => ({
            serviceLabel: item.serviceLabel,
            resourceId: `/subscriptions/mock-sub-${(idx % 3) + 1}/resourceGroups/mock-rg-${(idx % 4) + 1}/providers/mock.network/${family}-${idx}-${rowIdx}`,
            resourceName: `${family}-${idx + 1}-${rowIdx + 1}`,
            resourceGroup: `mock-rg-${(idx % 4) + 1}`,
            subscriptionId: `mock-sub-${(idx % 3) + 1}`,
            subscriptionName: subNames[idx % 3],
            publicIp: maybePublicIpForService(item.serviceLabel, idx, rowIdx),
            costGroupOwner: ["CostCenter-Platform", "CostCenter-Data", "CostCenter-Shared"][idx % 3],
            createdAt: "2026-01-01T00:00:00Z",
            monthlyCost: Number((item.monthlyCost / Math.max(item.resourceCount, 1)).toFixed(2)),
        }))
    );

    return {
        success: true,
        mock: true,
        family,
        items,
        rows,
        totalMonthlyCost: Number(rows.reduce((sum: number, row: { monthlyCost: number }) => sum + Number(row.monthlyCost || 0), 0).toFixed(2)),
        dataAvailable: true,
    };
};

export const getMockDataForRoute = (route: string, arg2: string, locale?: string): any => {
    // Arg2 can be either a tenantId (from backend) or a tier string (from frontend mock override)
    const isTenantId = arg2 && arg2.length > 20; // tenantIds are GUIDs
    if (isTenantId && !isMockTenant(arg2)) {
        return null; // Return real data if it's not a mock tenant
    }

    const tier = (isTenantId ? MOCK_TENANT_TIER[arg2] : arg2) || 'professional';

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
        case 'storage_efficiency':
        case 'storage-efficiency': {
            const baseGb = parseFloat((2010 * multiplier).toFixed(2));
            const baseCost = parseFloat((28.67 * multiplier).toFixed(2));
            const movableGb = Math.round(baseGb * 0.28);
            const potentialSavings = parseFloat((movableGb * 0.0084).toFixed(2));

            const accounts = [
                { id: "/subscriptions/demo-sub-01/resourceGroups/rg-prod-app/providers/Microsoft.Storage/storageAccounts/stappprodwestus01", name: "stappprodwestus01", resourceGroup: "rg-prod-app", subscriptionId: "demo-sub-01", location: "westus2", tier: "Hot", sku: "Standard_LRS", usedGb: parseFloat((450.5 * multiplier).toFixed(2)), monthlyCost: parseFloat((8.28 * multiplier).toFixed(2)) },
                { id: "/subscriptions/demo-sub-01/resourceGroups/rg-prod-app/providers/Microsoft.Storage/storageAccounts/stappprodwestus02", name: "stappprodwestus02", resourceGroup: "rg-prod-app", subscriptionId: "demo-sub-01", location: "westus2", tier: "Hot", sku: "Standard_GRS", usedGb: parseFloat((320.0 * multiplier).toFixed(2)), monthlyCost: parseFloat((5.88 * multiplier).toFixed(2)) },
                { id: "/subscriptions/demo-sub-01/resourceGroups/rg-prod-backups/providers/Microsoft.Storage/storageAccounts/stbackupsprod01", name: "stbackupsprod01", resourceGroup: "rg-prod-backups", subscriptionId: "demo-sub-01", location: "eastus", tier: "Cool", sku: "Standard_LRS", usedGb: parseFloat((850.0 * multiplier).toFixed(2)), monthlyCost: parseFloat((8.50 * multiplier).toFixed(2)) },
                { id: "/subscriptions/demo-sub-01/resourceGroups/rg-archive-data/providers/Microsoft.Storage/storageAccounts/stbackupsarchive01", name: "stbackupsarchive01", resourceGroup: "rg-archive-data", subscriptionId: "demo-sub-01", location: "eastus2", tier: "Archive", sku: "Standard_LRS", usedGb: parseFloat((1200.0 * multiplier).toFixed(2)), monthlyCost: parseFloat((1.18 * multiplier).toFixed(2)) },
                { id: "/subscriptions/demo-sub-02/resourceGroups/rg-monitoring/providers/Microsoft.Storage/storageAccounts/stlogsanalytics01", name: "stlogsanalytics01", resourceGroup: "rg-monitoring", subscriptionId: "demo-sub-02", location: "westeurope", tier: "Cool", sku: "Standard_ZRS", usedGb: parseFloat((240.0 * multiplier).toFixed(2)), monthlyCost: parseFloat((2.40 * multiplier).toFixed(2)) },
                { id: "/subscriptions/demo-sub-02/resourceGroups/rg-dev-test/providers/Microsoft.Storage/storageAccounts/stdevteststorage", name: "stdevteststorage", resourceGroup: "rg-dev-test", subscriptionId: "demo-sub-02", location: "eastus", tier: "Hot", sku: "Standard_LRS", usedGb: parseFloat((85.0 * multiplier).toFixed(2)), monthlyCost: parseFloat((1.56 * multiplier).toFixed(2)) },
                { id: "/subscriptions/demo-sub-01/resourceGroups/rg-database-prod/providers/Microsoft.Storage/storageAccounts/stsqlauditlogs", name: "stsqlauditlogs", resourceGroup: "rg-database-prod", subscriptionId: "demo-sub-01", location: "centralus", tier: "Cold", sku: "Standard_GRS", usedGb: parseFloat((310.0 * multiplier).toFixed(2)), monthlyCost: parseFloat((1.11 * multiplier).toFixed(2)) },
                { id: "/subscriptions/demo-sub-01/resourceGroups/rg-web-frontend/providers/Microsoft.Storage/storageAccounts/stcdnstaticcontent", name: "stcdnstaticcontent", resourceGroup: "rg-web-frontend", subscriptionId: "demo-sub-01", location: "eastus2", tier: "Hot", sku: "Premium_LRS", usedGb: parseFloat((120.0 * multiplier).toFixed(2)), monthlyCost: parseFloat((2.20 * multiplier).toFixed(2)) },
            ];

            return {
                success: true,
                mock: true,
                tiers: {
                    hot:     { percent: 55, gb: parseFloat((baseGb * 0.55).toFixed(2)), cost: parseFloat((baseCost * 0.60).toFixed(2)) },
                    cool:    { percent: 28, gb: parseFloat((baseGb * 0.28).toFixed(2)), cost: parseFloat((baseCost * 0.25).toFixed(2)) },
                    cold:    { percent: 10, gb: parseFloat((baseGb * 0.10).toFixed(2)), cost: parseFloat((baseCost * 0.10).toFixed(2)) },
                    archive: { percent: 7,  gb: parseFloat((baseGb * 0.07).toFixed(2)), cost: parseFloat((baseCost * 0.05).toFixed(2)) },
                },
                totalGb: baseGb,
                totalCost: baseCost,
                costPerGb: parseFloat((baseCost / baseGb).toFixed(5)),
                recommendation: {
                    movableGb,
                    potentialSavings,
                    fromTier: "hot",
                    toTier: "cool",
                },
                accounts,
            };
        }
        case 'advisor':
            return { success: true, ...getAdvisorMock(multiplier, locale) };
        case 'advisor_legacy_unused':
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
                    { id: "/subscriptions/mock-sub/resourceGroups/cscs-finops-prod-westus2-backup-rg/providers/Microsoft.Compute/virtualMachines/vm-mysql-worker", name: "vm-mysql-worker", subscriptionId: "mock-sub", currentSku: "Standard_D2s_v5", recommendedSku: "Snapshot & Delete VM", savings: 0, maxCpu: 0, hiddenCost: 38.50, reason: "Deallocated VM with attached Storage", isExempted: true, exemptionReason: "VM requerida para backups periódicos de MySQL", exemptionComment: "Máquina virtual encendida por ventanas cortas según scheduler para respaldar bases de datos en Storage Account. Mantener aunque figure apagada." },
                    { id: "/subscriptions/mock-sub/resourceGroups/legacy-rg/providers/Microsoft.Compute/virtualMachines/old-deallocated-vm", name: "old-deallocated-vm", subscriptionId: "mock-sub", currentSku: "Standard_D2s_v3", recommendedSku: "DELETE", savings: 0, maxCpu: 0, hiddenCost: 38.50, reason: "Deallocated VM with attached Storage", isExempted: false }
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
        case 'invoicing_report': {
            const round2 = (x: number) => Math.round(x * 100) / 100;
            const markupPercent = 15;
            const lines = [
                { date: '2026-07-01', customerId: 'cust-001', customerName: 'ACME Corp', subscriptionId: 'sub-prod-eastus', billingProfileId: 'bp-acme-01', invoiceSectionId: 'inv-001', service: 'Virtual Machines', resourceGroup: 'rg-prod-acme', originalCost: round2(1230.5 * multiplier / 10) },
                { date: '2026-07-01', customerId: 'cust-001', customerName: 'ACME Corp', subscriptionId: 'sub-prod-eastus', billingProfileId: 'bp-acme-01', invoiceSectionId: 'inv-001', service: 'SQL Database', resourceGroup: 'rg-prod-acme', originalCost: round2(850 * multiplier / 10) },
                { date: '2026-07-02', customerId: 'cust-002', customerName: 'Globex Ltd', subscriptionId: 'sub-staging-westeu', billingProfileId: 'bp-globex-01', invoiceSectionId: 'inv-002', service: 'Storage', resourceGroup: 'rg-prod-globex', originalCost: round2(420.3 * multiplier / 10) },
                { date: '2026-07-03', customerId: 'cust-003', customerName: 'Initech', subscriptionId: 'sub-prod-eastus', billingProfileId: 'bp-initech-01', invoiceSectionId: 'inv-003', service: 'AKS', resourceGroup: 'rg-prod-initech', originalCost: round2(980 * multiplier / 10) },
                { date: '2026-07-04', customerId: 'cust-003', customerName: 'Initech', subscriptionId: 'sub-dev-sandbox', billingProfileId: 'bp-initech-01', invoiceSectionId: 'inv-003', service: 'App Service', resourceGroup: 'rg-dev-initech', originalCost: round2(210 * multiplier / 10) },
            ].map(l => ({ ...l, adjustedCost: round2(l.originalCost * (1 + markupPercent / 100)) }));

            const custMap = new Map<string, { customerId: string; customerName: string; originalCost: number; adjustedCost: number }>();
            const invMap = new Map<string, { invoiceSectionId: string; customerId: string; cost: number; adjusted: number }>();
            const subMap = new Map<string, { subscriptionId: string; subscriptionName: string; originalCost: number; adjustedCost: number }>();
            const subNames: Record<string, string> = {
                'sub-prod-eastus': 'Producción (East US)',
                'sub-staging-westeu': 'Staging (West Europe)',
                'sub-dev-sandbox': 'Dev Sandbox',
            };
            for (const l of lines) {
                const ce = custMap.get(l.customerId) || { customerId: l.customerId, customerName: l.customerName, originalCost: 0, adjustedCost: 0 };
                ce.originalCost += l.originalCost;
                ce.adjustedCost += l.adjustedCost;
                custMap.set(l.customerId, ce);
                const ie = invMap.get(l.invoiceSectionId) || { invoiceSectionId: l.invoiceSectionId, customerId: l.customerId, cost: 0, adjusted: 0 };
                ie.cost += l.originalCost;
                ie.adjusted += l.adjustedCost;
                invMap.set(l.invoiceSectionId, ie);
                const se = subMap.get(l.subscriptionId) || { subscriptionId: l.subscriptionId, subscriptionName: subNames[l.subscriptionId] || l.subscriptionId, originalCost: 0, adjustedCost: 0 };
                se.originalCost += l.originalCost;
                se.adjustedCost += l.adjustedCost;
                subMap.set(l.subscriptionId, se);
            }
            const byCustomer = Array.from(custMap.values());
            const byInvoiceSection = Array.from(invMap.values());
            const bySubscription = Array.from(subMap.values());
            const totalOriginal = round2(byCustomer.reduce((s, c) => s + c.originalCost, 0));
            const totalAdjusted = round2(byCustomer.reduce((s, c) => s + c.adjustedCost, 0));

            return {
                success: true,
                mock: true,
                period: '2026-07',
                markupPercent,
                currency: 'USD',
                totals: { originalCost: totalOriginal, adjustedCost: totalAdjusted, markupAmount: round2(totalAdjusted - totalOriginal) },
                byCustomer,
                byInvoiceSection,
                bySubscription,
                availableSubscriptions: bySubscription.map(s => ({ id: s.subscriptionId, name: s.subscriptionName })),
                lines,
            };
        }
        case 'ttl_policies': {
            const now = Date.now();
            const day = 86400000;
            return {
                success: true,
                policies: [
                    { id: 1, name: 'VMs de desarrollo', resourceType: 'microsoft.compute/virtualmachines', daysToLive: 14, description: 'Máquinas virtuales de sandboxes/POCs — se etiquetan al crearse en el pipeline de onboarding.', enabled: true, createdBy: 'demo@company.com', createdAt: new Date(now - 40 * day).toISOString() },
                    { id: 2, name: 'Clusters AKS de prueba', resourceType: 'microsoft.containerservice/managedclusters', daysToLive: 30, description: 'Clusters de laboratorio para pruebas de carga y capacitaciones.', enabled: true, createdBy: 'demo@company.com', createdAt: new Date(now - 25 * day).toISOString() },
                    { id: 3, name: 'Bases de datos efímeras', resourceType: 'microsoft.dbforpostgresql/flexibleservers', daysToLive: 7, description: 'Postgres flexible servers usados en pipelines de QA.', enabled: true, createdBy: 'demo@company.com', createdAt: new Date(now - 10 * day).toISOString() },
                ]
            };
        }
        case 'ttl_unlabeled': {
            const now = new Date();
            const suggested = (days: number) => { const d = new Date(now); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
            return {
                success: true,
                resources: [
                    { id: '/subscriptions/mock-sub-1/resourceGroups/qa-loadtest-rg/providers/microsoft.compute/virtualMachines/dev-vm-loadtest-02', name: 'dev-vm-loadtest-02', type: 'microsoft.compute/virtualmachines', resourceGroup: 'qa-loadtest-rg', subscriptionId: 'mock-sub-1', tags: { Environment: 'Sandbox' }, suggestedExpiration: suggested(14) },
                    { id: '/subscriptions/mock-sub-2/resourceGroups/aks-lab-rg/providers/microsoft.containerservice/managedClusters/tmp-aks-experiment-2', name: 'tmp-aks-experiment-2', type: 'microsoft.containerservice/managedclusters', resourceGroup: 'aks-lab-rg', subscriptionId: 'mock-sub-2', tags: { Environment: 'Lab' }, suggestedExpiration: suggested(30) },
                    { id: '/subscriptions/mock-sub-1/resourceGroups/db-sandbox-rg/providers/microsoft.dbforpostgresql/flexibleServers/pgsql-test-flex-02', name: 'pgsql-test-flex-02', type: 'microsoft.dbforpostgresql/flexibleservers', resourceGroup: 'db-sandbox-rg', subscriptionId: 'mock-sub-1', tags: {}, suggestedExpiration: suggested(7) },
                ]
            };
        }
        case 'ttl_history': {
            const now = Date.now();
            const day = 86400000;
            return {
                success: true,
                deletions: [
                    { id: 1, resourceId: '/subscriptions/mock-sub-3/resourceGroups/sandbox-poc-billing/providers/microsoft.compute/virtualMachines/poc-billing-vm', resourceName: 'poc-billing-vm', resourceType: 'microsoft.compute/virtualmachines', resourceGroup: 'sandbox-poc-billing', expirationDate: new Date(now - 45 * day).toISOString().slice(0, 10), deletedBy: 'admin@demo.com', deletedAt: new Date(now - 40 * day).toISOString() },
                    { id: 2, resourceId: '/subscriptions/mock-sub-1/resourceGroups/training-rg-old/providers/microsoft.network/virtualNetworks/training-workshop-vnet-old', resourceName: 'training-workshop-vnet-old', resourceType: 'microsoft.network/virtualnetworks', resourceGroup: 'training-rg-old', expirationDate: new Date(now - 60 * day).toISOString().slice(0, 10), deletedBy: 'admin@demo.com', deletedAt: new Date(now - 55 * day).toISOString() },
                ]
            };
        }
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
        case 'networking_zombies': {
            const scale = Math.min(3, Math.max(1, Math.round(multiplier / 5))); // 1x (Professional/Pro) .. 3x (Enterprise)
            const base: Array<{ resourceName: string; resourceType: string; resourceGroup: string; monthlyCost: number; reason: string; daysIdle: number }> = [
                { resourceName: "agw-prod-legacy", resourceType: "applicationGateway", resourceGroup: "rg-network", monthlyCost: 125.0, reason: "Sin backend pools o reglas de ruteo configuradas", daysIdle: 45 },
                { resourceName: "lb-internal-qa", resourceType: "loadBalancer", resourceGroup: "rg-shared", monthlyCost: 18.0, reason: "Sin frontend IP configurado o sin backend pool asociado", daysIdle: 60 },
                { resourceName: "vgw-dr-site", resourceType: "virtualNetworkGateway", resourceGroup: "rg-network", monthlyCost: 130.0, reason: "Sin conexiones (Connections) configuradas", daysIdle: 90 },
                { resourceName: "vnet-training-workshop", resourceType: "virtualNetwork", resourceGroup: "rg-training", monthlyCost: 0, reason: "VNet sin subnets configuradas", daysIdle: 22 },
                { resourceName: "snet-legacy-app/default", resourceType: "subnet", resourceGroup: "rg-network", monthlyCost: 0, reason: "Subnet sin recursos ni delegaciones asociadas", daysIdle: 40 },
                { resourceName: "vwan-hub-westus", resourceType: "virtualWanHub", resourceGroup: "rg-vwan", monthlyCost: 180.0, reason: "Virtual WAN Hub sin conexiones a VNets", daysIdle: 35 },
                { resourceName: "route-server-hub01", resourceType: "routeServer", resourceGroup: "rg-vwan", monthlyCost: 216.0, reason: "Azure Route Server sin conexiones a VNets", daysIdle: 50 },
                { resourceName: "expressroute-poc-circuit", resourceType: "expressRouteCircuit", resourceGroup: "rg-connectivity", monthlyCost: 300.0, reason: "Circuito sin aprovisionar o sin peerings/autorizaciones", daysIdle: 70 },
                { resourceName: "peering-hub-to-spoke02", resourceType: "vnetPeering", resourceGroup: "rg-network", monthlyCost: 0, reason: "Peering en estado distinto de Connected", daysIdle: 15 },
                { resourceName: "afw-perimeter-old", resourceType: "azureFirewall", resourceGroup: "rg-security", monthlyCost: 900.0, reason: "Sin reglas (network/application/nat) ni Firewall Policy asociada", daysIdle: 80 },
                { resourceName: "nsg-unused-web", resourceType: "networkSecurityGroup", resourceGroup: "rg-network", monthlyCost: 0, reason: "NSG sin NICs ni Subnets asociadas", daysIdle: 25 },
                { resourceName: "asg-orphan-api", resourceType: "applicationSecurityGroup", resourceGroup: "rg-network", monthlyCost: 0, reason: "ASG sin NICs asociadas", daysIdle: 25 },
                { resourceName: "pe-storage-old", resourceType: "privateEndpoint", resourceGroup: "rg-data", monthlyCost: 7.2, reason: "Conexión Private Link en estado Disconnected", daysIdle: 33 },
                { resourceName: "privatelink.blob.core.windows.net", resourceType: "privateDnsZone", resourceGroup: "rg-data", monthlyCost: 0.5, reason: "Zona Private DNS sin Virtual Network Links", daysIdle: 33 },
                { resourceName: "bastion-shared-hub", resourceType: "bastionHost", resourceGroup: "rg-network", monthlyCost: 137.0, reason: "Revisar uso — Bastion no expone sesiones vía Resource Graph, validar necesidad real", daysIdle: 0 },
                { resourceName: "ddos-plan-corp", resourceType: "ddosProtectionPlan", resourceGroup: "rg-security", monthlyCost: 2944.0, reason: "Plan DDoS Standard sin VNets protegidas", daysIdle: 60 },
                { resourceName: "waf-policy-unassigned", resourceType: "webApplicationFirewall", resourceGroup: "rg-security", monthlyCost: 0, reason: "WAF Policy (Application Gateway) sin Application Gateway asociado", daysIdle: 28 },
                { resourceName: "afd-classic-staging", resourceType: "frontDoor", resourceGroup: "rg-cdn", monthlyCost: 35.0, reason: "Front Door (classic) sin backend pools configurados", daysIdle: 40 },
                { resourceName: "tm-profile-decommissioned", resourceType: "trafficManager", resourceGroup: "rg-cdn", monthlyCost: 1.0, reason: "Perfil de Traffic Manager sin endpoints configurados", daysIdle: 55 },
                { resourceName: "natgw-outbound-dev", resourceType: "natGateway", resourceGroup: "rg-network", monthlyCost: 32.0, reason: "NAT Gateway sin subnets asociadas", daysIdle: 20 },
                { resourceName: "contoso-old-domain.com", resourceType: "dnsZone", resourceGroup: "rg-dns", monthlyCost: 0.5, reason: "Zona DNS pública sin registros más allá de NS/SOA por defecto", daysIdle: 100 },
                { resourceName: "nw-eastus", resourceType: "networkWatcher", resourceGroup: "NetworkWatcherRG", monthlyCost: 0, reason: "Network Watcher habilitado sin Flow Logs configurados", daysIdle: 0 },
                { resourceName: "flowlog-nsg-web", resourceType: "trafficAnalytics", resourceGroup: "NetworkWatcherRG", monthlyCost: 0, reason: "Flow Log activo sin Traffic Analytics habilitado", daysIdle: 0 },
            ];
            const ARM_TYPE: Record<string, string> = {
                applicationGateway: "Microsoft.Network/applicationGateways",
                loadBalancer: "Microsoft.Network/loadBalancers",
                virtualNetworkGateway: "Microsoft.Network/virtualNetworkGateways",
                virtualNetwork: "Microsoft.Network/virtualNetworks",
                subnet: "Microsoft.Network/virtualNetworks/subnets",
                virtualWanHub: "Microsoft.Network/virtualHubs",
                routeServer: "Microsoft.Network/virtualHubs",
                expressRouteCircuit: "Microsoft.Network/expressRouteCircuits",
                vnetPeering: "Microsoft.Network/virtualNetworks/virtualNetworkPeerings",
                azureFirewall: "Microsoft.Network/azureFirewalls",
                networkSecurityGroup: "Microsoft.Network/networkSecurityGroups",
                applicationSecurityGroup: "Microsoft.Network/applicationSecurityGroups",
                privateEndpoint: "Microsoft.Network/privateEndpoints",
                privateDnsZone: "Microsoft.Network/privateDnsZones",
                bastionHost: "Microsoft.Network/bastionHosts",
                ddosProtectionPlan: "Microsoft.Network/ddosProtectionPlans",
                webApplicationFirewall: "Microsoft.Network/applicationGatewayWebApplicationFirewallPolicies",
                frontDoor: "Microsoft.Network/frontDoors",
                trafficManager: "Microsoft.Network/trafficManagerProfiles",
                natGateway: "Microsoft.Network/natGateways",
                dnsZone: "Microsoft.Network/dnsZones",
                networkWatcher: "Microsoft.Network/networkWatchers",
                trafficAnalytics: "Microsoft.Network/networkWatchers/flowLogs",
            };
            const items = Array.from({ length: base.length * scale }).map((_, i) => {
                const b = base[i % base.length];
                const suffix = i >= base.length ? `-${Math.floor(i / base.length) + 1}` : "";
                return {
                    resourceId: `/subscriptions/mock-sub-${(i % 3) + 1}/resourceGroups/${b.resourceGroup}/providers/Microsoft.Network/${b.resourceType}s/${b.resourceName}${suffix}`,
                    resourceName: `${b.resourceName}${suffix}`,
                    resourceType: b.resourceType,
                    armType: ARM_TYPE[b.resourceType] || "Microsoft.Network/unknown",
                    resourceGroup: b.resourceGroup,
                    subscriptionId: `mock-sub-${(i % 3) + 1}`,
                    monthlyCost: b.monthlyCost,
                    reason: b.reason,
                    daysIdle: b.daysIdle,
                };
            });
            const totalMonthlyWaste = Number(items.reduce((sum, it) => sum + it.monthlyCost, 0).toFixed(2));
            // Total de Private Endpoints (conectados + desconectados) — la mayoría
            // están sanos y en uso; solo los "Disconnected" aparecen también en `items`
            // (con acción de borrado). El resto se sintetiza como "Connected" para
            // dar visibilidad completa del conjunto en el mock.
            const disconnectedPeItems = items.filter((it) => it.resourceType === "privateEndpoint");
            const totalPrivateEndpoints = (12 + scale * 6);
            const connectedPeCount = Math.max(0, totalPrivateEndpoints - disconnectedPeItems.length);
            const privateEndpointsDetail = [
                ...disconnectedPeItems.map((it) => ({
                    resourceId: it.resourceId, resourceName: it.resourceName, resourceGroup: it.resourceGroup,
                    subscriptionId: it.subscriptionId, connectionState: "Disconnected", monthlyCost: 7.2,
                })),
                ...Array.from({ length: connectedPeCount }).map((_, i) => ({
                    resourceId: `/subscriptions/mock-sub-${(i % 3) + 1}/resourceGroups/rg-data/providers/Microsoft.Network/privateEndpoints/pe-active-${i + 1}`,
                    resourceName: `pe-active-${i + 1}`, resourceGroup: "rg-data", subscriptionId: `mock-sub-${(i % 3) + 1}`,
                    connectionState: "Connected", monthlyCost: 7.2,
                })),
            ];
            const privateEndpointAccumulation = { totalCount: totalPrivateEndpoints, estimatedMonthlyCost: Number((totalPrivateEndpoints * 7.2).toFixed(2)) };
            return { success: true, mock: true, items, totalMonthlyWaste, privateEndpointAccumulation, privateEndpointsDetail };
        }
        case 'backup_orphans': {
            return {
                success: true,
                mock: true,
                items: [
                    {
                        subscriptionId: 'mock-sub-1',
                        subscriptionName: 'Production',
                        region: 'eastus',
                        vaultName: 'rsv-prod-backup',
                        resourceGroup: 'rg-backups',
                        itemName: 'vm-decommissioned-01',
                        sourceResourceId: '/subscriptions/mock-sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-decommissioned-01',
                        backupManagementType: 'AzureIaasVM',
                        protectionState: 'ProtectionStopped',
                        estimatedMonthlyCost: 12.0,
                    },
                    {
                        subscriptionId: 'mock-sub-2',
                        subscriptionName: 'Staging',
                        region: 'westeurope',
                        vaultName: 'rsv-stg-backup',
                        resourceGroup: 'rg-stg-backups',
                        itemName: 'sqldb-legacy-app',
                        sourceResourceId: '/subscriptions/mock-sub-2/resourceGroups/rg-data/providers/Microsoft.Sql/servers/sql-legacy',
                        backupManagementType: 'AzureWorkload',
                        protectionState: 'ProtectionStopped',
                        estimatedMonthlyCost: 8.0,
                    },
                ],
                totalEstimatedMonthlyCost: 20.0,
                dataAvailable: true,
            };
        }
        case 'historical_progress':
        case 'history': {
            const report = generateHistoricalProgressReport('90d', tier);
            return {
                ...report,
                data: report.series.map(s => ({
                    scan_date: s.date,
                    score: s.maturityScore,
                    impacted_resources: Math.max(1, Math.round(s.unallocatedSpend / 300)),
                    potential_score_increase: parseFloat(Math.max(0, 100 - s.maturityScore).toFixed(1)),
                })),
            };
        }
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
            // Causas plausibles (atribución de causa raíz) para el demo — un
            // resource group por servicio, consistente con el nombre del servicio.
            const CAUSE_RGS: Record<string, string> = {
                'Virtual Machines': 'rg-prod-compute',
                'Storage': 'rg-shared-services',
                'SQL Database': 'rg-data-platform',
                'App Service': 'rg-prod-web',
                'Cosmos DB': 'rg-data-platform',
            };
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
                const primaryService = services[i % services.length];
                const secondaryService = services[(i + 2) % services.length];
                const totalDelta = Math.max(0, s.amount - baseMean);
                const primaryPct = 55 + Math.round(rand(i + 300) * 20); // 55-75%
                const top_contributors = totalDelta > 0 ? [
                    {
                        resource_group: CAUSE_RGS[primaryService],
                        service_name: primaryService,
                        cost: Number((baseMean * 0.3 + totalDelta * (primaryPct / 100)).toFixed(2)),
                        baseline_avg: Number((baseMean * 0.3).toFixed(2)),
                        delta: Number((totalDelta * (primaryPct / 100)).toFixed(2)),
                        delta_pct_of_total: primaryPct,
                    },
                    {
                        resource_group: CAUSE_RGS[secondaryService],
                        service_name: secondaryService,
                        cost: Number((baseMean * 0.15 + totalDelta * ((100 - primaryPct) / 100)).toFixed(2)),
                        baseline_avg: Number((baseMean * 0.15).toFixed(2)),
                        delta: Number((totalDelta * ((100 - primaryPct) / 100)).toFixed(2)),
                        delta_pct_of_total: 100 - primaryPct,
                    },
                ] : [];
                return {
                    id: i + 1,
                    date: s.date,
                    status,
                    service: primaryService,
                    subscription_id: subs[i % subs.length],
                    amount: s.amount,
                    expected_amount: baseMean,
                    z_score: (s.amount - baseMean) / std,
                    metric: ['Bandwidth', 'Compute Hours', 'DTU', 'RU/s', 'GB-month'][i % 5],
                    severity: s.amount > baseMean + 5 * std ? 'Critical' : 'High',
                    description: `Pico inusual detectado en ${primaryService} — desviación de +$${(s.amount - baseMean).toFixed(0)} vs media móvil.`,
                    top_contributors,
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
                    { key: 'tagging', score: Math.min(100, 50 + maturityBoost * 2), weight: 20 },
                    { key: 'waste', score: Math.max(20, 85 - multiplier), weight: 20 },
                    { key: 'budget', score: Math.min(100, 60 + maturityBoost), weight: 20 },
                    { key: 'credentials', score: Math.min(100, 65 + maturityBoost), weight: 15 },
                    { key: 'savings', score: Math.min(100, 35 + maturityBoost * 2), weight: 15 },
                    { key: 'security', score: Math.min(100, 72 + maturityBoost), weight: 10 },
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
        case 'billing': {
            const round2 = (x: number) => Math.round(x * 100) / 100;
            const dailyBilledTarget = (12500 * multiplier / 30) / 0.92;
            const now = new Date();
            const daysElapsed = Math.max(1, now.getDate());
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const totalCost = 372.13 * (multiplier / 10);
            const dailyBurnRate = round2(totalCost / daysElapsed);
            const projectedCost = round2(dailyBurnRate * daysInMonth);

            const rawData = Array.from({length: 30}).map((_, i) => {
                const services = ['Redis Cache', 'Azure Container Apps', 'Virtual Machines', 'Storage Accounts', 'Foundry Models', 'Virtual Network', 'Azure Cognitive Search', 'Container Registry'];
                const svc = services[i % services.length];
                const pseudoRandom = (i * 7919) % 1000 / 1000;
                const cost = dailyBilledTarget * (0.85 + pseudoRandom * 0.3);
                const isoDate = new Date(Date.now() - (29 - i) * 86400000).toISOString().split('T')[0];
                return {
                    date: isoDate,
                    UsageDate: isoDate,
                    cost: round2(cost),
                    BilledCost: round2(cost),
                    EffectiveCost: round2(cost * 0.92),
                    service: svc,
                    ServiceName: svc,
                    ServiceFamily: svc,
                    resourceGroup: ['rg-prod', 'rg-dev', 'rg-data', 'rg-net'][i % 4],
                    ResourceGroup: ['rg-prod', 'rg-dev', 'rg-data', 'rg-net'][i % 4],
                    ResourceId: `/subscriptions/demo/resourceGroups/rg/providers/Microsoft.Compute/${svc}/r${i}`,
                    tags: { Environment: i % 2 ? 'prod' : 'dev', Owner: 'demo@company.com' }
                };
            });

            return {
                success: true,
                mock: true,
                totalCost: round2(totalCost),
                projectedCost: round2(projectedCost),
                dailyBurnRate: round2(dailyBurnRate),
                momVariation: 11.4,
                daysElapsed,
                daysInMonth,
                hasAnomalies: true,
                anomalyCount: 1,
                data: rawData
            };
        }
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
                { 
                    namespace: 'payments-prod', 
                    workloadCount: 8, 
                    cpuRequested: 8, 
                    cpuUsed: 2.8, 
                    memoryRequestedGb: 16, 
                    memoryUsedGb: 6.2, 
                    computeCost: 240 * multiplier, 
                    storageCost: 65 * multiplier, 
                    idleCost: 156 * multiplier, 
                    efficiencyPct: 35, 
                    isSystem: false, 
                    costCenter: 'Fintech-Core',
                    recommendation: { 
                        title: 'Rightsizing de Pods en payments-api', 
                        impactUsd: 125 * multiplier, 
                        patchType: 'kubectl', 
                        target: 'deployment/payments-api',
                        script: `kubectl -n payments-prod patch deployment payments-api --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/resources/requests/cpu", "value": "500m"}, {"op": "replace", "path": "/spec/template/spec/containers/0/resources/requests/memory", "value": "1Gi"}]'` 
                    }
                },
                { 
                    namespace: 'checkout-web', 
                    workloadCount: 5, 
                    cpuRequested: 6, 
                    cpuUsed: 3.9, 
                    memoryRequestedGb: 12, 
                    memoryUsedGb: 8.5, 
                    computeCost: 180 * multiplier, 
                    storageCost: 35 * multiplier, 
                    idleCost: 63 * multiplier, 
                    efficiencyPct: 65, 
                    isSystem: false, 
                    costCenter: 'E-Commerce',
                    recommendation: { 
                        title: 'Habilitar HPA con Scale-to-Zero', 
                        impactUsd: 55 * multiplier, 
                        patchType: 'yaml', 
                        target: 'hpa/checkout-frontend',
                        script: `apiVersion: autoscaling/v2\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: checkout-frontend\n  namespace: checkout-web\nspec:\n  scaleTargetRef:\n    apiVersion: apps/v1\n    kind: Deployment\n    name: checkout-frontend\n  minReplicas: 1\n  maxReplicas: 8\n  metrics:\n  - type: Resource\n    resource:\n      name: cpu\n      target:\n        type: Utilization\n        averageUtilization: 75` 
                    }
                },
                { 
                    namespace: 'analytics-batch', 
                    workloadCount: 4, 
                    cpuRequested: 12, 
                    cpuUsed: 4.2, 
                    memoryRequestedGb: 32, 
                    memoryUsedGb: 14.0, 
                    computeCost: 360 * multiplier, 
                    storageCost: 140 * multiplier, 
                    idleCost: 234 * multiplier, 
                    efficiencyPct: 35, 
                    isSystem: false, 
                    costCenter: 'Data-Platform',
                    recommendation: { 
                        title: 'Migrar Node Pool a Azure Spot (Ahorro 70%)', 
                        impactUsd: 250 * multiplier, 
                        patchType: 'azcli', 
                        target: 'nodepool/spotpool',
                        script: `az aks nodepool add --resource-group rg-k8s-prod --cluster-name aks-prod-01 --name spotpool --priority Spot --eviction-policy Delete --spot-max-price -1 --node-vm-size Standard_D4as_v7 --enable-cluster-autoscaler --min-count 0 --max-count 5` 
                    }
                },
                { 
                    namespace: 'auth-identity', 
                    workloadCount: 3, 
                    cpuRequested: 4, 
                    cpuUsed: 3.2, 
                    memoryRequestedGb: 8, 
                    memoryUsedGb: 6.8, 
                    computeCost: 120 * multiplier, 
                    storageCost: 20 * multiplier, 
                    idleCost: 24 * multiplier, 
                    efficiencyPct: 80, 
                    isSystem: false, 
                    costCenter: 'Security',
                    recommendation: null 
                },
                { 
                    namespace: 'monitoring', 
                    workloadCount: 6, 
                    cpuRequested: 4, 
                    cpuUsed: 3.6, 
                    memoryRequestedGb: 16, 
                    memoryUsedGb: 14.2, 
                    computeCost: 120 * multiplier, 
                    storageCost: 85 * multiplier, 
                    idleCost: 12 * multiplier, 
                    efficiencyPct: 90, 
                    isSystem: true, 
                    costCenter: 'Shared-Infra',
                    recommendation: {
                        title: 'Retención de métricas Prometheus a Blob Storage',
                        impactUsd: 40 * multiplier,
                        patchType: 'kubectl',
                        target: 'prometheus-config',
                        script: `kubectl -n monitoring patch prometheus k8s --type='merge' -p='{"spec":{"retention":"15d","storage":{"volumeClaimTemplate":{"spec":{"resources":{"requests":{"storage":"50Gi"}}}}}}}'`
                    }
                },
                { 
                    namespace: 'ingress-nginx', 
                    workloadCount: 2, 
                    cpuRequested: 2, 
                    cpuUsed: 1.5, 
                    memoryRequestedGb: 4, 
                    memoryUsedGb: 3.1, 
                    computeCost: 60 * multiplier, 
                    storageCost: 10 * multiplier, 
                    idleCost: 15 * multiplier, 
                    efficiencyPct: 75, 
                    isSystem: true, 
                    costCenter: 'Shared-Infra',
                    recommendation: null 
                },
                { 
                    namespace: 'kube-system', 
                    workloadCount: 8, 
                    cpuRequested: 4, 
                    cpuUsed: 2.8, 
                    memoryRequestedGb: 8, 
                    memoryUsedGb: 6.0, 
                    computeCost: 120 * multiplier, 
                    storageCost: 25 * multiplier, 
                    idleCost: 36 * multiplier, 
                    efficiencyPct: 70, 
                    isSystem: true, 
                    costCenter: 'Shared-Infra',
                    recommendation: null 
                }
            ];

            const totalSharedCost = rawNamespaces.filter(n => n.isSystem).reduce((s, n) => s + (n.computeCost + n.storageCost), 0);
            const totalNonSharedCompute = rawNamespaces.filter(n => !n.isSystem).reduce((s, n) => s + n.computeCost, 0) || 1;
            const nonSharedCount = rawNamespaces.filter(n => !n.isSystem).length || 1;

            const namespaces = rawNamespaces.map(n => {
                const baseTotal = n.computeCost + n.storageCost;
                const proportionalShared = !n.isSystem ? Number(((n.computeCost / totalNonSharedCompute) * totalSharedCost).toFixed(2)) : 0;
                const evenShared = !n.isSystem ? Number((totalSharedCost / nonSharedCount).toFixed(2)) : 0;
                return {
                    ...n,
                    baseTotalCost: baseTotal,
                    totalCost: baseTotal,
                    sharedProportional: proportionalShared,
                    sharedEven: evenShared,
                };
            });

            const nodePools = [
                { 
                    poolName: 'systempool', 
                    vmSize: 'Standard_D4as_v7', 
                    nodeCount: 2, 
                    cpuCores: 8, 
                    computeCost: 240 * multiplier, 
                    storageCost: 70 * multiplier, 
                    idleCost: 75 * multiplier, 
                    totalCost: 310 * multiplier, 
                    efficiencyPct: 76, 
                    isSpot: false, 
                    recommendation: null 
                },
                { 
                    poolName: 'userpool-general', 
                    vmSize: 'Standard_D8as_v7', 
                    nodeCount: 3, 
                    cpuCores: 24, 
                    computeCost: 720 * multiplier, 
                    storageCost: 190 * multiplier, 
                    idleCost: 310 * multiplier, 
                    totalCost: 910 * multiplier, 
                    efficiencyPct: 57, 
                    isSpot: false, 
                    recommendation: { 
                        title: 'Ajustar minCount de autoscaler a 1 nodo', 
                        impactUsd: 180 * multiplier,
                        patchType: 'azcli',
                        target: 'nodepool/userpool-general',
                        script: `az aks nodepool update --resource-group rg-k8s-prod --cluster-name aks-prod-01 --name userpool-general --update-cluster-autoscaler --min-count 1 --max-count 6`
                    } 
                },
                { 
                    poolName: 'batchpool-heavy', 
                    vmSize: 'Standard_E8as_v7', 
                    nodeCount: 2, 
                    cpuCores: 16, 
                    computeCost: 520 * multiplier, 
                    storageCost: 120 * multiplier, 
                    idleCost: 280 * multiplier, 
                    totalCost: 640 * multiplier, 
                    efficiencyPct: 46, 
                    isSpot: false, 
                    recommendation: { 
                        title: 'Convertir a Node Pool Azure Spot', 
                        impactUsd: 360 * multiplier,
                        patchType: 'azcli',
                        target: 'nodepool/batchpool-heavy',
                        script: `az aks nodepool add --resource-group rg-k8s-prod --cluster-name aks-prod-01 --name spotbatch --priority Spot --eviction-policy Delete --spot-max-price -1 --node-vm-size Standard_E8as_v7 --enable-cluster-autoscaler --min-count 0 --max-count 4`
                    } 
                }
            ];

            const workloads = [
                { workloadName: 'payments-api', namespace: 'payments-prod', kind: 'Deployment', replicas: 4, cpuRequested: 4.0, cpuUsed: 1.2, memoryRequestedGb: 8, memoryUsedGb: 3.1, computeCost: 120 * multiplier, idleCost: 84 * multiplier, totalCost: 155 * multiplier, efficiencyPct: 30, recommendation: 'Reducir request de 1000m a 400m (-$65/mes)' },
                { workloadName: 'transaction-worker', namespace: 'payments-prod', kind: 'Deployment', replicas: 4, cpuRequested: 4.0, cpuUsed: 1.6, memoryRequestedGb: 8, memoryUsedGb: 3.1, computeCost: 120 * multiplier, idleCost: 72 * multiplier, totalCost: 150 * multiplier, efficiencyPct: 40, recommendation: 'Ajustar límites de memoria (-$40/mes)' },
                { workloadName: 'checkout-frontend', namespace: 'checkout-web', kind: 'Deployment', replicas: 3, cpuRequested: 3.0, cpuUsed: 2.1, memoryRequestedGb: 6, memoryUsedGb: 4.5, computeCost: 90 * multiplier, idleCost: 27 * multiplier, totalCost: 110 * multiplier, efficiencyPct: 70, recommendation: null },
                { workloadName: 'catalog-service', namespace: 'checkout-web', kind: 'Deployment', replicas: 2, cpuRequested: 3.0, cpuUsed: 1.8, memoryRequestedGb: 6, memoryUsedGb: 4.0, computeCost: 90 * multiplier, idleCost: 36 * multiplier, totalCost: 105 * multiplier, efficiencyPct: 60, recommendation: null },
                { workloadName: 'spark-driver', namespace: 'analytics-batch', kind: 'Job', replicas: 2, cpuRequested: 6.0, cpuUsed: 2.0, memoryRequestedGb: 16, memoryUsedGb: 7.0, computeCost: 180 * multiplier, idleCost: 120 * multiplier, totalCost: 250 * multiplier, efficiencyPct: 33, recommendation: 'Programar apagado nocturno (-$90/mes)' },
                { workloadName: 'kafka-consumer', namespace: 'analytics-batch', kind: 'StatefulSet', replicas: 3, cpuRequested: 6.0, cpuUsed: 2.2, memoryRequestedGb: 16, memoryUsedGb: 7.0, computeCost: 180 * multiplier, idleCost: 114 * multiplier, totalCost: 250 * multiplier, efficiencyPct: 37, recommendation: 'Usar Azure Spot instances (-$120/mes)' },
                { workloadName: 'keycloak', namespace: 'auth-identity', kind: 'Deployment', replicas: 2, cpuRequested: 4.0, cpuUsed: 3.2, memoryRequestedGb: 8, memoryUsedGb: 6.8, computeCost: 120 * multiplier, idleCost: 24 * multiplier, totalCost: 140 * multiplier, efficiencyPct: 80, recommendation: null },
                { workloadName: 'prometheus-server', namespace: 'monitoring', kind: 'StatefulSet', replicas: 1, cpuRequested: 3.0, cpuUsed: 2.7, memoryRequestedGb: 12, memoryUsedGb: 10.8, computeCost: 90 * multiplier, idleCost: 9 * multiplier, totalCost: 165 * multiplier, efficiencyPct: 90, recommendation: null },
                { workloadName: 'ingress-controller', namespace: 'ingress-nginx', kind: 'DaemonSet', replicas: 2, cpuRequested: 2.0, cpuUsed: 1.5, memoryRequestedGb: 4, memoryUsedGb: 3.1, computeCost: 60 * multiplier, idleCost: 15 * multiplier, totalCost: 70 * multiplier, efficiencyPct: 75, recommendation: null },
                { workloadName: 'coredns', namespace: 'kube-system', kind: 'Deployment', replicas: 2, cpuRequested: 1.0, cpuUsed: 0.8, memoryRequestedGb: 2, memoryUsedGb: 1.5, computeCost: 30 * multiplier, idleCost: 6 * multiplier, totalCost: 35 * multiplier, efficiencyPct: 80, recommendation: null }
            ];

            const costCenters = [
                { costCenter: 'Fintech-Core', namespaces: ['payments-prod'], totalCost: 305 * multiplier, allocatedPct: 32 },
                { costCenter: 'E-Commerce', namespaces: ['checkout-web'], totalCost: 215 * multiplier, allocatedPct: 22 },
                { costCenter: 'Data-Platform', namespaces: ['analytics-batch'], totalCost: 500 * multiplier, allocatedPct: 36 },
                { costCenter: 'Security', namespaces: ['auth-identity'], totalCost: 140 * multiplier, allocatedPct: 10 }
            ];

            const totalClusterCost = namespaces.reduce((s, n) => s + n.baseTotalCost, 0) + (73 * multiplier) + (65 * multiplier);
            const totalIdleCost = namespaces.reduce((s, n) => s + n.idleCost, 0);
            const potentialSavings = 470 * multiplier;
            const avgEfficiency = Math.round(namespaces.reduce((s, n) => s + n.efficiencyPct, 0) / namespaces.length);

            return {
                success: true,
                mock: true,
                clusterName: 'aks-prod-01',
                availableClusters: [
                    { name: 'aks-prod-01', subscriptionId: 'demo', resourceGroup: 'rg-k8s-prod', nodeResourceGroup: 'MC_rg-k8s-prod_aks-prod-01_eastus' },
                    { name: 'aks-dev-02', subscriptionId: 'demo', resourceGroup: 'rg-k8s-dev', nodeResourceGroup: 'MC_rg-k8s-dev_aks-dev-02_eastus' },
                ],
                totalClusterCost,
                projectedMonthlyCost: Math.round(totalClusterCost * 1.15),
                totalClusterCpuCores: 48,
                totalMemoryGb: 128,
                healthEfficiencyPct: avgEfficiency,
                totalIdleCost,
                potentialSavings,
                hiddenCosts: {
                    controlPlaneCost: 73 * multiplier,
                    controlPlaneTier: 'Standard (Uptime SLA 99.95%)',
                    loadBalancersAndNetworkCost: 65 * multiplier,
                    storageVolumesCost: 380 * multiplier,
                    egressCost: 28 * multiplier,
                },
                sharedServices: {
                    totalSharedCost,
                    namespaces: ['kube-system', 'monitoring', 'ingress-nginx'],
                    policies: ['proportional', 'even_split', 'centralized'],
                },
                views: {
                    byNamespace: namespaces,
                    byNodePool: nodePools,
                    byWorkload: workloads,
                    byCostCenter: costCenters,
                },
                // Retrocompatibilidad con consumidores legacy
                chargebackData: namespaces.map(n => ({
                    namespace: n.namespace,
                    cpuCores: n.cpuRequested,
                    computeCost: n.computeCost,
                    storageCost: n.storageCost,
                    idleCost: n.idleCost,
                    totalCost: n.baseTotalCost,
                })),
                namespaceBreakdownAvailable: true,
                breakdownType: 'all',
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
        case 'white_board': {
            const round2 = (x: number) => Math.round(x * 100) / 100;
            const scale = Math.max(1, multiplier / 5); // Enterprise-only feature: multiplier ya es 50, escala base razonable
            const currentFYCost = round2(420000 * scale);
            const previousFYCost = round2(currentFYCost * 0.88);
            const monthLabel = (offset: number) => {
                const d = new Date();
                d.setUTCMonth(d.getUTCMonth() - offset);
                return d.toISOString().slice(0, 7);
            };
            return {
                success: true,
                mock: true,
                costs: {
                    currentFYCost,
                    previousFYCost,
                    costProjected: round2(currentFYCost * 1.12),
                    costChangePct: round2(((currentFYCost - previousFYCost) / previousFYCost) * 100),
                    top3Services: [
                        { name: "Virtual Machines", cost: round2(currentFYCost * 0.34) },
                        { name: "Storage", cost: round2(currentFYCost * 0.19) },
                        { name: "Azure SQL Database", cost: round2(currentFYCost * 0.14) },
                    ],
                    last3MonthsTrend: [
                        { month: monthLabel(2), cost: round2(currentFYCost / 12 * 0.9) },
                        { month: monthLabel(1), cost: round2(currentFYCost / 12 * 1.05) },
                        { month: monthLabel(0), cost: round2(currentFYCost / 12 * 1.1) },
                    ],
                },
                security: { pct: 53.4, withMfa: Math.round(31 * scale), total: Math.round(58 * scale) },
                vulnerabilities: { high: Math.round(9 * scale), medium: Math.round(24 * scale), low: Math.round(41 * scale) },
                governance: {
                    untagged: {
                        count: Math.round(861 * scale),
                        total: Math.round(1912 * scale),
                        countPct: 45.0,
                        cost: round2(currentFYCost / 12 * 0.001 * 3.5),
                        costPct: 0.01,
                        trend: [
                            { month: monthLabel(2), cost: round2(currentFYCost / 12 * 0.0015) },
                            { month: monthLabel(1), cost: round2(currentFYCost / 12 * 0.0012) },
                            { month: monthLabel(0), cost: round2(currentFYCost / 12 * 0.001) },
                        ],
                    },
                    top3ComplianceWins: [
                        { name: "Environment", pct: 88.2 },
                        { name: "Owner", pct: 74.6 },
                        { name: "CostCenter", pct: 55.0 },
                    ],
                },
                top3ThreatCategories: [
                    { name: "Enable MFA for accounts with owner permissions", high: Math.round(6 * scale), medium: Math.round(3 * scale), low: 0, total: Math.round(9 * scale) },
                    { name: "Internet-exposed resource without NSG", high: Math.round(4 * scale), medium: Math.round(5 * scale), low: Math.round(1 * scale), total: Math.round(10 * scale) },
                    { name: "Disk encryption should be enabled", high: 0, medium: Math.round(8 * scale), low: Math.round(6 * scale), total: Math.round(14 * scale) },
                ],
                top5Locations: [
                    { name: "eastus", count: Math.round(612 * scale) },
                    { name: "westeurope", count: Math.round(388 * scale) },
                    { name: "brazilsouth", count: Math.round(241 * scale) },
                    { name: "centralus", count: Math.round(190 * scale) },
                    { name: "southeastasia", count: Math.round(112 * scale) },
                ],
                top5Inventory: [
                    { name: "microsoft.compute/virtualmachines", count: Math.round(340 * scale) },
                    { name: "microsoft.storage/storageaccounts", count: Math.round(212 * scale) },
                    { name: "microsoft.network/networkinterfaces", count: Math.round(198 * scale) },
                    { name: "microsoft.compute/disks", count: Math.round(176 * scale) },
                    { name: "microsoft.sql/servers/databases", count: Math.round(94 * scale) },
                ],
                recommendations: {
                    open: Math.round(37 * scale),
                    potentialCostSavings: round2(currentFYCost * 0.045),
                    trend: [
                        { month: monthLabel(2), count: Math.round(28 * scale) },
                        { month: monthLabel(1), count: Math.round(33 * scale) },
                        { month: monthLabel(0), count: Math.round(37 * scale) },
                    ],
                },
                costAnomalyTrend: [
                    { month: monthLabel(2), count: 1 },
                    { month: monthLabel(1), count: 3 },
                    { month: monthLabel(0), count: 2 },
                ],
                top5CostGroups: {
                    totalCost: round2(currentFYCost * 0.7),
                    groups: [
                        { name: "IT", cost: round2(currentFYCost * 0.22) },
                        { name: "Data", cost: round2(currentFYCost * 0.18) },
                        { name: "Marketing", cost: round2(currentFYCost * 0.13) },
                        { name: "HR", cost: round2(currentFYCost * 0.09) },
                        { name: "Untagged", cost: round2(currentFYCost * 0.08) },
                    ],
                },
            };
        }
        case 'cost_centers': {
            const round2 = (x: number) => Math.round(x * 100) / 100;
            const centers = [
                { name: 'IT', budget: 8000 * multiplier, resourceCount: 42 },
                { name: 'Data', budget: 6000 * multiplier, resourceCount: 31 },
                { name: 'Marketing', budget: 3000 * multiplier, resourceCount: 14 },
                { name: 'HR', budget: 1500 * multiplier, resourceCount: 6 },
                { name: 'Sin asignar', budget: null as number | null, resourceCount: 9 },
            ];
            const runRateFactor = 30 / new Date().getUTCDate();
            const costCenters = centers.map((c, i) => {
                const currentMonthCost = round2((c.budget || 2000 * multiplier) * (0.6 + i * 0.15));
                const previousMonthCost = round2(currentMonthCost * 0.92);
                const changePct = round2(((currentMonthCost - previousMonthCost) / previousMonthCost) * 100);
                const pctUsed = c.budget ? round2((currentMonthCost / c.budget) * 100) : null;
                const projectedMonthEndSpend = round2(currentMonthCost * runRateFactor);
                const projectedPctUsed = c.budget ? round2((projectedMonthEndSpend / c.budget) * 100) : null;
                return {
                    name: c.name,
                    currentMonthCost,
                    previousMonthCost,
                    changePct,
                    budget: c.budget,
                    pctUsed,
                    overBudget: c.budget !== null && currentMonthCost > c.budget,
                    projectedMonthEndSpend,
                    projectedPctUsed,
                    isProjectedOverBudget: c.budget !== null && projectedMonthEndSpend > c.budget,
                    resourceCount: c.resourceCount,
                };
            });
            const totalSpend = round2(costCenters.reduce((s, c) => s + c.currentMonthCost, 0));
            const unassignedSpend = costCenters.find(c => c.name === 'Sin asignar')?.currentMonthCost || 0;
            return {
                success: true,
                mock: true,
                costCenters,
                totalSpend,
                totalBudget: round2(costCenters.reduce((s, c) => s + (c.budget || 0), 0)),
                overBudgetCount: costCenters.filter(c => c.overBudget).length,
                unassignedSpend: round2(unassignedSpend),
                allocationRate: totalSpend > 0 ? round2(((totalSpend - unassignedSpend) / totalSpend) * 100) : 0,
            };
        }
        case 'captured_savings': {
            const round2 = (x: number) => Math.round(x * 100) / 100;
            const monthLabel = (offset: number) => {
                const d = new Date();
                d.setUTCDate(1);
                d.setUTCMonth(d.getUTCMonth() - offset);
                return d.toISOString().slice(0, 10);
            };
            const history = Array.from({ length: 6 }).map((_, i) => {
                const offset = 5 - i;
                const potentialSavings = round2(120 * multiplier * (0.7 + i * 0.08));
                return {
                    date: monthLabel(offset),
                    totalWasted: round2(potentialSavings * 2.3),
                    potentialSavings,
                };
            });
            const latest = history[history.length - 1];
            const previous = history[history.length - 2];
            return {
                success: true,
                mock: true,
                history,
                current: { potentialSavings: latest.potentialSavings, totalWasted: latest.totalWasted, date: latest.date },
                changePct: round2(((latest.potentialSavings - previous.potentialSavings) / previous.potentialSavings) * 100),
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
            // Antes usaba una escala propia (1x/1.5x/2.5x/5x) distinta del
            // `multiplier` general (1x/3x/10x/50x) que usan Cost Groups, Top
            // Expenses, Budgets, etc. — el "Costo Actual" del dashboard no
            // guardaba proporción con el resto de la demo por tier (ej.
            // Enterprise mostraba $62,500 mientras Cost Groups sumaba
            // ~$185,500 para el mismo tenant). Unificado a `multiplier`.
            const base = 12500 * multiplier;
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
                // Desglose Consumo vs Compras (cargos únicos: reservas/marketplace).
                // ~11% del acumulado simula una compra puntual del mes.
                usageCost: Math.round(base * 0.89),
                purchaseCost: Math.round(base * 0.11),
                projectedCost: Math.round(proj),
                zombieCount: Math.round(48 * multiplier),
                totalSavings: Math.round(sav),
                environmentalImpact: Number(((sav / 100) * 15).toFixed(1)),
                // Score de gobernanza pre-calculado: el frontend lo prefiere sobre
                // el cálculo por-recurso cuando viene presente (ver page.tsx). Sin
                // esto, el cálculo sobre los recursos zombie —que legítimamente no
                // tienen tags— arrojaba ~0%, dando la impresión de "sin datos".
                complianceScore: tier === 'enterprise' ? 86
                    : tier === 'business' ? 78
                    : tier.startsWith('pro') ? 71 : 64,
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
                portalUrl: 'https://billing.paddle.com/customer-portal/test_demo',
                invoices: [
                    { id: 'INV-2026-05', date: '2026-05-01', amount: 1499.00, status: 'paid', pdfUrl: '#' },
                    { id: 'INV-2026-04', date: '2026-04-01', amount: 1499.00, status: 'paid', pdfUrl: '#' },
                    { id: 'INV-2026-03', date: '2026-03-01', amount: 1499.00, status: 'paid', pdfUrl: '#' }
                ]
            };
        case 'macc': {
            // MACC scales by tier: Enterprise = large multi-commitment, Business = mid, Professional = small atRisk
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
                // Professional (piso): very small, atRisk (under-consumption)
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
                // Professional+: budget % alert
                { id: 'mock-alert-1', ruleName: 'Budget Alert > 80%', ruleType: 'budget', thresholdValue: 80, thresholdUnit: 'percent', channel: 'email', channelTarget: 'finops@contoso.com', enabled: true, lastTriggeredAt: new Date(now - 15 * 24 * h).toISOString(), triggerCount: 3 },
                // Professional+: threshold USD
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
            const cheapestRegionCostPerCore = Math.min(...regionSplit.map(r => r.costPerCore));
            const regionDetail = regionSplit.map(r => ({
                region: r.region,
                cores: Math.round(baseCores * r.share),
                costPerCore: r.costPerCore,
                deltaVsCheapestPct: Math.round(((r.costPerCore - cheapestRegionCostPerCore) / cheapestRegionCostPerCore) * 100),
            }));
            const worstRegion = [...regionDetail].sort((a, b) => b.deltaVsCheapestPct - a.deltaVsCheapestPct)[0];

            // Unit Economics dual (vCore + RAM): asume ratio ~4 GiB/core en el mix de SKUs demo.
            const totalRamGiB = baseCores * 4;
            const costPerGiB = parseFloat((baseCostPerCore / 4).toFixed(2));
            const avgCpuUtilization = multiplier === 1 ? 11.8 : multiplier === 3 ? 14.2 : multiplier === 10 ? 18.5 : 22.4;
            const effectiveCorePriceUtilized = parseFloat((baseCostPerCore / (avgCpuUtilization / 100)).toFixed(2));

            // Mix de compra: mayoría Pay-As-You-Go, algo de Spot, AHUB parcial en cargas Windows.
            const spotCores = Math.round(baseCores * 0.08);
            const ahubActiveCores = Math.round(baseCores * (multiplier >= 3 ? 0.15 : 0));
            const ahubEligibleCores = Math.round(baseCores * 0.20);
            const paygCores = baseCores - spotCores;

            const architectureMix = [
                { architecture: 'Intel' as const, cores: Math.round(baseCores * 0.70), cost: Math.round(effectiveCost * 0.72), costPerCore: baseCostPerCore },
                { architecture: 'AMD' as const, cores: Math.round(baseCores * 0.20), cost: Math.round(effectiveCost * 0.18), costPerCore: parseFloat((baseCostPerCore * 0.85).toFixed(2)) },
                { architecture: 'ARM' as const, cores: Math.round(baseCores * 0.10), cost: Math.round(effectiveCost * 0.10), costPerCore: parseFloat((baseCostPerCore * 0.80).toFixed(2)) },
            ];
            const generationMix = [
                { generation: 'v5', cores: Math.round(baseCores * 0.55), costPerCore: baseCostPerCore },
                { generation: 'v4', cores: Math.round(baseCores * 0.30), costPerCore: parseFloat((baseCostPerCore * 1.08).toFixed(2)) },
                { generation: 'v3', cores: Math.round(baseCores * 0.15), costPerCore: parseFloat((baseCostPerCore * 1.15).toFixed(2)) },
            ];

            const skuDetail = skuSplit.map((s, i) => {
                const cores = Math.round(baseCores * s.share);
                const isArmCandidate = i === 0; // el SKU dominante (Intel D-series) es candidato ARM en la demo
                return {
                    sku: s.sku,
                    architecture: (s.sku.includes('as_v') ? 'AMD' : s.sku.includes('ps_v') ? 'ARM' : 'Intel') as 'Intel' | 'AMD' | 'ARM',
                    generation: s.sku.match(/_v(\d+)$/)?.[0]?.replace('_', '') || 'v3',
                    cores,
                    ramGiB: cores * s.coreSize * 2, // aprox
                    purchaseType: 'PAYG' as const,
                    ahubActive: multiplier >= 3 && i === 0,
                    cost: Math.round(cores * s.costPerCore),
                    costPerCore: s.costPerCore,
                    costPerGiB: parseFloat((s.costPerCore / 4).toFixed(2)),
                    suggestedAction: isArmCandidate ? `Migrar a ${s.sku.replace('Standard_', '').replace(/^D/, 'Dp').replace(/^E/, 'Ep')} (ARM Ampere, ~20% ahorro)` : null,
                };
            });

            const rateOptimizationActions = [
                {
                    id: 'savings_plan',
                    type: 'savings_plan' as const,
                    title: 'Cobertura con Compute Savings Plan (1 o 3 años)',
                    description: `${paygCores} vCores mayormente en Pay-As-You-Go. Ahorro potencial estimado: 42% ($/Core baja de ${baseCostPerCore.toFixed(2)} a ${(baseCostPerCore * 0.58).toFixed(2)}).`,
                    estimated: true,
                    potentialSavingsPct: 42,
                    potentialMonthlySavings: Math.round(effectiveCost * 0.42),
                    ctaLabel: 'Simular Plan de Ahorro',
                    ctaHref: '/intelligence/commitment-simulator',
                },
                {
                    id: 'arm_migration',
                    type: 'arm_migration' as const,
                    title: 'Modernización a Arquitectura ARM (Ampere Dps_v5)',
                    description: `${architectureMix[0].cores} vCores Linux en Intel x86 son elegibles para migrar a familias ARM (Dps_v5/Eps_v5). Ahorro estimado: 20% por vCore.`,
                    estimated: true,
                    potentialSavingsPct: 20,
                    potentialMonthlySavings: Math.round(architectureMix[0].cost * 0.20),
                    ctaLabel: 'Ver Matriz de Migración',
                    ctaHref: '/intelligence/computo/avm',
                },
                {
                    id: 'ahub',
                    type: 'ahub' as const,
                    title: 'Asignación de Licencia Azure Hybrid Benefit (AHUB)',
                    description: `${ahubEligibleCores} vCores Windows sin AHUB activo. Eliminar sobrecosto de licencia Windows Server (ahorro estimado ~40%).`,
                    estimated: true,
                    potentialSavingsPct: 40,
                    potentialMonthlySavings: Math.round(ahubEligibleCores * baseCostPerCore * 0.40),
                    ctaLabel: `Habilitar AHUB en ${ahubEligibleCores} Cores`,
                    ctaHref: '/intelligence/computo/avm',
                },
                ...(worstRegion.deltaVsCheapestPct >= 8 ? [{
                    id: 'region_arbitrage',
                    type: 'region_arbitrage' as const,
                    title: 'Arbitraje de Región por $/vCore',
                    description: `Cores en ${worstRegion.region} cuestan ${worstRegion.deltaVsCheapestPct}% más que en la región más económica del tenant.`,
                    estimated: true,
                    potentialSavingsPct: worstRegion.deltaVsCheapestPct,
                    potentialMonthlySavings: Math.round(worstRegion.cores * (worstRegion.costPerCore - cheapestRegionCostPerCore)),
                    ctaLabel: 'Comparar Precios Regiones',
                    ctaHref: '/intelligence/compute-efficiency',
                }] : []),
            ];

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
                unitEconomics: {
                    costPerCore: baseCostPerCore,
                    costPerCoreInventory: baseCostPerCore,
                    costPerGiB,
                    totalRamGiB,
                    avgCpuUtilization,
                    effectiveCorePriceUtilized,
                },
                purchaseMix: {
                    totalCores: baseCores,
                    paygCores,
                    spotCores,
                    ahubActiveCores,
                    ahubEligibleCores,
                    commitmentCoveragePct: 22,
                    inventoryAvailable: true,
                },
                architectureMix,
                generationMix,
                skuDetail,
                regionDetail,
                subscriptionDetail: multiplier === 1
                    ? [{ subscriptionId: 'sub-001', subscriptionName: 'Producción', cores: baseCores, totalCost: effectiveCost, costPerCore: baseCostPerCore, commitmentCoveragePct: 22 }]
                    : multiplier === 3
                    ? [
                        { subscriptionId: 'sub-001', subscriptionName: 'Producción', cores: Math.round(baseCores * 0.65), totalCost: Math.round(effectiveCost * 0.68), costPerCore: Math.round(baseCostPerCore * 1.05), commitmentCoveragePct: 28 },
                        { subscriptionId: 'sub-002', subscriptionName: 'Desarrollo/QA', cores: Math.round(baseCores * 0.35), totalCost: Math.round(effectiveCost * 0.32), costPerCore: Math.round(baseCostPerCore * 0.92), commitmentCoveragePct: 8 },
                      ]
                    : [
                        { subscriptionId: 'sub-001', subscriptionName: 'Producción', cores: Math.round(baseCores * 0.50), totalCost: Math.round(effectiveCost * 0.55), costPerCore: Math.round(baseCostPerCore * 1.10), commitmentCoveragePct: 35 },
                        { subscriptionId: 'sub-002', subscriptionName: 'Desarrollo/QA', cores: Math.round(baseCores * 0.25), totalCost: Math.round(effectiveCost * 0.22), costPerCore: Math.round(baseCostPerCore * 0.88), commitmentCoveragePct: 5 },
                        { subscriptionId: 'sub-003', subscriptionName: 'Data & Analytics', cores: Math.round(baseCores * 0.15), totalCost: Math.round(effectiveCost * 0.15), costPerCore: Math.round(baseCostPerCore * 1.0), commitmentCoveragePct: 12 },
                        { subscriptionId: 'sub-004', subscriptionName: 'Shared Services', cores: Math.round(baseCores * 0.10), totalCost: Math.round(effectiveCost * 0.08), costPerCore: Math.round(baseCostPerCore * 0.80), commitmentCoveragePct: 0 },
                      ],
                rateOptimizationActions,
            };
        }
        case 'aro-clusters': {
            // Cockpit de gobernanza ARO: 1 clúster productivo estable + 1 clúster
            // dev/test subutilizado (dispara consolidación), escalado por tier.
            const prodWorkerCount = 3 * (multiplier >= 10 ? 2 : 1);
            const prodCompute = 980 * (multiplier >= 10 ? 2 : 1);
            const prodRhFee = 420 * (multiplier >= 10 ? 2 : 1);
            const prodStorage = 150 * (multiplier >= 10 ? 2 : 1);
            const prodTotal = prodCompute + prodRhFee + prodStorage;
            const prodSavings = Math.round(prodCompute * 0.38) + (multiplier >= 3 ? 34.5 : 0);

            const devCompute = 885;
            const devRhFee = 380;
            const devStorage = 40;
            const devTotal = devCompute + devRhFee + devStorage;

            const items = [
                {
                    id: "/subscriptions/mock-sub-1/resourceGroups/rg-prod-api/providers/Microsoft.RedHatOpenShift/openShiftClusters/aro-api-westeurope-03",
                    name: "aro-api-westeurope-03",
                    type: "microsoft.redhatopenshift/openshiftclusters",
                    region: "westeurope",
                    resourceGroup: "rg-prod-api",
                    subscriptionName: "Demo Production Subscription",
                    state: "succeeded",
                    sku: "Master: Standard_D8s_v5 / Worker: Standard_D4s_v5",
                    monthlyCostUsd: prodTotal,
                    openshiftVersion: "4.14.12",
                    apiVisibility: "Public",
                    ingressVisibility: "Public",
                    provisioningState: "Succeeded",
                    managedResourceGroup: "aro-infra-westeurope-03",
                    masterProfile: { vmSize: "Standard_D8s_v5", count: 3 },
                    workerProfiles: [
                        { name: "worker", vmSize: "Standard_D4s_v5", count: prodWorkerCount, diskSizeGb: 128, autoscalerEnabled: false },
                    ],
                    totalWorkerCount: prodWorkerCount,
                    autoscalerActive: false,
                    orphanPvcCount: multiplier >= 3 ? 2 : 0,
                    orphanPvcMonthlyCostUsd: multiplier >= 3 ? 34.5 : 0,
                    storagePvcCount: 6,
                    storagePvcDescription: "6 Discos (Premium SSD 512GB)",
                    cpuAvg: 78.0,
                    cpuMax: 91.2,
                    memoryAvgPercent: 42.0,
                    metricsAvailable: true,
                    costBreakdown: {
                        computeCostMonthlyUsd: prodCompute,
                        redHatLicenseCostMonthlyUsd: prodRhFee,
                        storageCostMonthlyUsd: prodStorage,
                        totalCostMonthlyUsd: prodTotal,
                    },
                    isDevTestCandidate: false,
                    potentialSavingUsd: Math.round(prodCompute * 0.38) + (multiplier >= 3 ? 34.5 : 0),
                    remediationActions: [
                        {
                            id: "rec-savings-plan-aro-api",
                            type: "savings_plan" as const,
                            title: "Cobertura de Cómputo con Savings Plans (1 o 3 años)",
                            description: "Nodos Master y Workers estables 24/7 en Pay-As-You-Go. Cubrir con Compute Savings Plan: ahorro estimado 38% en cómputo Azure.",
                            monthlySavingsUsd: Math.round(prodCompute * 0.38),
                            risk: "low" as const,
                            confidence: "medium" as const,
                            commandCli: "az costmanagement benefit recommendation list --scope /subscriptions/mock-sub-1",
                        },
                        ...(multiplier >= 3 ? [
                            {
                                id: "rec-orphan-pvc-aro-api",
                                type: "orphan_pvc" as const,
                                title: "Purga de Persistent Volume Claims (PVC) Huérfanos",
                                description: "2 discos administrados en el Managed Resource Group sin adjuntar a ninguna instancia. Verificar en el clúster y eliminar si no están montados a pods activos.",
                                monthlySavingsUsd: 34.5,
                                risk: "low" as const,
                                confidence: "medium" as const,
                                commandCli: "oc get pv,pvc --all-namespaces\naz disk list --resource-group aro-infra-westeurope-03 --query \"[?managedBy==null].name\" -o tsv",
                            },
                        ] : []),
                    ],
                    metricA: "78%",
                    metricB: "42%",
                },
                {
                    id: "/subscriptions/mock-sub-1/resourceGroups/rg-dev-apps/providers/Microsoft.RedHatOpenShift/openShiftClusters/aro-dev-westus-02",
                    name: "aro-dev-westus-02",
                    type: "microsoft.redhatopenshift/openshiftclusters",
                    region: "westus2",
                    resourceGroup: "rg-dev-apps",
                    subscriptionName: "Demo Development Subscription",
                    state: "succeeded",
                    sku: "Master: Standard_D8s_v5 / Worker: Standard_D4s_v5",
                    monthlyCostUsd: devTotal,
                    openshiftVersion: "4.14.8",
                    apiVisibility: "Private",
                    ingressVisibility: "Private",
                    provisioningState: "Succeeded",
                    managedResourceGroup: "aro-infra-westus-02",
                    masterProfile: { vmSize: "Standard_D8s_v5", count: 3 },
                    workerProfiles: [
                        { name: "worker", vmSize: "Standard_D4s_v5", count: 3, diskSizeGb: 128, autoscalerEnabled: false },
                    ],
                    totalWorkerCount: 3,
                    autoscalerActive: false,
                    orphanPvcCount: 0,
                    orphanPvcMonthlyCostUsd: 0,
                    storagePvcCount: 2,
                    storagePvcDescription: "2 Discos (Standard SSD 256GB)",
                    cpuAvg: 12.0,
                    cpuMax: 21.4,
                    memoryAvgPercent: 8.0,
                    metricsAvailable: true,
                    costBreakdown: {
                        computeCostMonthlyUsd: devCompute,
                        redHatLicenseCostMonthlyUsd: devRhFee,
                        storageCostMonthlyUsd: devStorage,
                        totalCostMonthlyUsd: devTotal,
                    },
                    isDevTestCandidate: true,
                    potentialSavingUsd: 800,
                    remediationActions: [
                        {
                            id: "rec-consolidate-aro-dev",
                            type: "consolidate_cluster" as const,
                            title: "Consolidación de Clústeres Dev/Test (Overhead Master)",
                            description: "Clúster 'aro-dev-westus-02' con CPU promedio 12% pagando ~$800 de base fija de Control Plane (3 masters). Evaluar consolidación en un clúster compartido, aislado por Namespaces/RBAC.",
                            monthlySavingsUsd: 800,
                            risk: "medium" as const,
                            confidence: "medium" as const,
                            commandCli: "oc get projects\noc get pods --all-namespaces -o wide",
                        },
                        {
                            id: "rec-rightsizing-aro-dev",
                            type: "rightsizing_workers" as const,
                            title: "Rightsizing de Worker MachineSets",
                            description: "Worker nodes Standard_D8s_v5 con < 25% uso. Sugerido Standard_D4s_v5. Ahorro de cómputo y licencia.",
                            monthlySavingsUsd: 180,
                            risk: "medium" as const,
                            confidence: "medium" as const,
                            commandCli: "az aro update --name aro-dev-westus-02 --resource-group rg-dev-apps --worker-vm-size Standard_D4s_v5",
                        },
                        {
                            id: "rec-autoscaler-aro-dev",
                            type: "enable_autoscaler" as const,
                            title: "Activación de MachineAutoscaler en Workers",
                            description: "Cómputo fijo (3 workers) con 0 pods nocturnos. Activar MachineAutoscaler de OpenShift para reducir workers fuera de horario laboral.",
                            monthlySavingsUsd: Math.round(devCompute * 0.40),
                            risk: "medium" as const,
                            confidence: "medium" as const,
                            commandCli: "oc create -f - <<EOF\napiVersion: autoscaling.openshift.io/v1beta1\nkind: MachineAutoscaler\nmetadata:\n  name: worker-autoscaler\n  namespace: openshift-machine-api\nspec:\n  minReplicas: 1\n  maxReplicas: 3\n  scaleTargetRef:\n    apiVersion: machine.openshift.io/v1beta1\n    kind: MachineSet\n    name: worker\nEOF",
                        },
                    ],
                    metricA: "12%",
                    metricB: "8%",
                },
            ];

            return {
                ok: true,
                mock: true,
                resourceExists: true,
                dataAvailable: true,
                data: {
                    summary: {
                        resourceCount: items.length,
                        totalMonthlyCostUsd: Number(items.reduce((acc, it) => acc + it.monthlyCostUsd, 0).toFixed(2)),
                        advisorRecommendations: items.reduce((acc, it) => acc + it.remediationActions.length, 0),
                    },
                    items,
                },
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
            const now = new Date();
            const daysElapsed = Math.max(1, now.getDate());
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const mkBudget = (id: number, costCenter: string, limit: number, spendPct: number, threshold = 80) => {
                const monthlyLimit = Math.round(limit * multiplier);
                const currentSpend = Math.round(monthlyLimit * spendPct / 100);
                const dailyBurnRate = Number((currentSpend / daysElapsed).toFixed(2));
                const forecastedMonthEndSpend = Number((dailyBurnRate * daysInMonth).toFixed(2));
                let budgetStatus: 'OK' | 'WARNING' | 'CRITICAL' = 'OK';
                if (currentSpend >= monthlyLimit || forecastedMonthEndSpend > monthlyLimit) {
                    budgetStatus = 'CRITICAL';
                } else if (forecastedMonthEndSpend >= monthlyLimit * 0.9 || spendPct >= 90) {
                    budgetStatus = 'WARNING';
                }
                let forecastedBreachDate: string | null = null;
                if (currentSpend >= monthlyLimit) {
                    forecastedBreachDate = 'Excedido';
                } else if (dailyBurnRate > 0 && forecastedMonthEndSpend > monthlyLimit) {
                    const breachDay = Math.ceil(monthlyLimit / dailyBurnRate);
                    if (breachDay <= daysInMonth) {
                        forecastedBreachDate = `Día ${breachDay}`;
                    }
                }
                return {
                    id,
                    costCenter,
                    monthlyLimit,
                    alertThreshold: threshold,
                    currentSpend,
                    utilization: spendPct,
                    dailyBurnRate,
                    forecastedMonthEndSpend,
                    forecastedBreachDate,
                    budgetStatus,
                };
            };
            const base = [
                mkBudget(101, 'engineering', 1200, 72),
                mkBudget(102, 'marketing', 400, 91, 85),
            ];
            const extra = [
                mkBudget(103, 'data-platform', 2500, 58),
                mkBudget(104, 'shared-services', 900, 103, 90),
            ];
            const budgets = multiplier >= 3 ? [...base, ...extra] : base;
            return {
                success: true,
                budgets,
                suggestedCostCenters: ['engineering', 'marketing', 'data-platform', 'shared-services', 'Databases', 'AI-Services'],
            };
        }
        case 'cost_groups': {
            // Mismos cost centers que 'platform-budgets' para que Budget/Forecast
            // sean consistentes entre /intelligence/budgets y /intelligence/cost-groups.
            const groups = MOCK_COST_GROUPS(multiplier);
            const totalCostUsd = Math.round(groups.reduce((s, g) => s + g.periodCost, 0) * 100) / 100;
            const untagged = groups.find(g => g.name === 'Untagged');
            const unallocatedCostUsd = untagged?.periodCost || 0;
            const allocatedCostUsd = Math.round((totalCostUsd - unallocatedCostUsd) * 100) / 100;
            const allocatedPercent = totalCostUsd > 0 ? Math.round((allocatedCostUsd / totalCostUsd) * 1000) / 10 : 0;
            return {
                success: true,
                mock: true,
                groups,
                summary: { totalCostUsd, allocatedCostUsd, unallocatedCostUsd: Math.round(unallocatedCostUsd * 100) / 100, allocatedPercent },
                suggestions: [],
            };
        }
        case 'top_expenses': {
            const round2 = (x: number) => Math.round(x * 100) / 100;
            const groups = MOCK_COST_GROUPS(multiplier)
                .filter(g => g.name !== 'Untagged')
                .sort((a, b) => b.periodCost - a.periodCost)
                .slice(0, 3)
                .map(g => ({ name: g.name, cost: g.periodCost }));
            const topSubscriptions = [
                { name: 'Subscription A', cost: round2(4200 * multiplier) },
                { name: 'Subscription B', cost: round2(3100 * multiplier) },
                { name: 'Subscription C', cost: round2(1850 * multiplier) },
            ];
            const topResourceGroups = [
                { name: 'rg-data-platform-1', cost: round2(2600 * multiplier) },
                { name: 'rg-engineering-3', cost: round2(2100 * multiplier) },
                { name: 'rg-shared-services-1', cost: round2(1750 * multiplier) },
            ];
            const topResources = [
                { name: `Virtual Machines — rg-engineering-1`, cost: round2(1400 * multiplier) },
                { name: `Azure SQL Database — rg-data-platform-1`, cost: round2(1120 * multiplier) },
                { name: `Storage Accounts — rg-shared-services-1`, cost: round2(890 * multiplier) },
            ];
            return { success: true, mock: true, topCostGroups: groups, topSubscriptions, topResourceGroups, topResources };
        }
        case 'resources_search': {
            const round2 = (x: number) => Math.round(x * 100) / 100;
            const owners = ['james.taylor@demo.com', 'cynthia.perez@demo.com', 'blake.gonzales@demo.com'];
            const rgs = ['rg-data-platform-1', 'rg-engineering-3', 'rg-shared-services-1', 'rg-it-prod-007'];
            const types = ['virtualMachines', 'storageAccounts', 'sqlServers/databases', 'disks', 'appServicePlans'];
            const totalCount = Math.round(69 * multiplier);
            // Genera TODAS las filas (no sólo una página fija de 15): el selector
            // de tamaño de página (15/30/45/60) necesita datos reales para
            // slicear en cualquier combinación de page/pageSize — antes esto
            // siempre devolvía exactamente 15 filas sin importar lo pedido.
            // Decaimiento exponencial (nunca negativo, a diferencia de la resta
            // lineal anterior) para mantener sortedByCost: true creíble más allá
            // de las primeras ~17 filas.
            const allRows = Array.from({ length: Math.min(totalCount, 200) }, (_, i) => {
                const cost = round2(Math.max(5, 1200 * Math.pow(0.97, i)) * multiplier * (0.9 + 0.2 * Math.abs(Math.sin(i))));
                return {
                    id: `/subscriptions/mock-sub/resourceGroups/${rgs[i % rgs.length]}/providers/Microsoft.Compute/${types[i % types.length]}/r-demo-${i}`,
                    name: `r-demo-${100 + i}`,
                    type: `Microsoft.Compute/${types[i % types.length]}`,
                    subscriptionId: 'mock-sub',
                    resourceGroup: rgs[i % rgs.length],
                    tags: { Owner: owners[i % owners.length], CostCenter: `Application ${(i % 4) + 1}`, Environment: i % 2 === 0 ? 'Production' : 'Staging' },
                    createdTime: new Date(Date.now() - (i + 5) * 86400000).toISOString(),
                    periodCost: cost,
                };
            });
            return {
                // `rows`/`page`/`pageSize` son el default (primera página de 15)
                // para callers que no re-paginan (p.ej. el interceptor de fetch de
                // TenantProvider.tsx, que devuelve este mock tal cual sin mirar la
                // query string). `allRows` es el set completo, que
                // /api/resources/search SÍ slicea según el page/pageSize real
                // pedido — sin esto, elegir 30/45/60 filas en modo demo mostraba
                // siempre las mismas 15 filas fijas.
                success: true, mock: true, page: 1, pageSize: 15,
                rows: allRows.slice(0, 15), allRows, total: totalCount, sortedByCost: true,
                kpis: { costGroups: Math.round(9 * multiplier), subscriptions: 1, resourceGroups: rgs.length, resources: totalCount },
            };
        }
        case 'resources_inventory': {
            const byType = [
                { type: 'virtualMachines', count: Math.round(28 * multiplier) },
                { type: 'disks', count: Math.round(24 * multiplier) },
                { type: 'storageAccounts', count: Math.round(18 * multiplier) },
                { type: 'networkInterfaces', count: Math.round(16 * multiplier) },
                { type: 'databases', count: Math.round(9 * multiplier) },
                { type: 'appServicePlans', count: Math.round(6 * multiplier) },
            ];
            return {
                success: true, mock: true,
                byType,
                bySubscription: [{ subscriptionId: 'mock-sub', count: byType.reduce((s, t) => s + t.count, 0) }],
                kpis: {
                    costGroups: Math.round(10 * multiplier), subscriptions: 1, resourceGroups: Math.round(20 * multiplier),
                    resources: byType.reduce((s, t) => s + t.count, 0), owners: 2,
                },
            };
        }
        case 'resources_created_by': {
            const round2 = (x: number) => Math.round(x * 100) / 100;
            const rows = [
                { userName: 'james.taylor@demo.com', resources: Math.round(29 * multiplier), resourceGroups: 5, subscriptions: 1 },
                { userName: 'cynthia.perez@demo.com', resources: Math.round(4 * multiplier), resourceGroups: 1, subscriptions: 1 },
                { userName: 'blake.gonzales@demo.com', resources: Math.round(32 * multiplier), resourceGroups: 1, subscriptions: 1 },
                { userName: 'sharon.woodward@demo.com', resources: Math.round(4 * multiplier), resourceGroups: 1, subscriptions: 1 },
            ];
            return {
                success: true, mock: true, rows,
                kpis: {
                    createdBy: rows.length, costGroups: Math.round(11 * multiplier), subscriptions: 1,
                    resourceGroups: 6, resources: rows.reduce((s, r) => s + r.resources, 0),
                },
            };
        }
        case 'resources_costs_by_tag': {
            const round2 = (x: number) => Math.round(x * 100) / 100;
            const tag = (key: string, values: Array<[string, number]>) => ({
                key, totalCost: round2(values.reduce((s, [, c]) => s + c, 0) * multiplier),
                values: values.map(([value, cost]) => ({ value, cost: round2(cost * multiplier) })),
            });
            const tags = [
                tag('Department', [['Marketing', 1417.8], ['Corporate', 1394.1], ['IT', 895.5], ['Finance', 738.1], ['Engineering', 622.9], ['Accounting', 527.5]]),
                tag('Purpose', [['Production', 4200.5], ['Testing', 1200.3], ['Development', 614.0]]),
                tag('Environment', [['prod', 3800.2], ['staging', 900.4], ['dev', 314.2]]),
                tag('Application', [['Application 001', 2100.0], ['Application 002', 1450.5], ['Application 003', 980.2]]),
                tag('CreatedBy', [['james.taylor@demo.com', 3400.1], ['cynthia.perez@demo.com', 850.0]]),
            ];
            return {
                success: true, mock: true, tags,
                kpis: {
                    resources: Math.round(1926 * multiplier), resourcesWithTags: Math.round(1065 * multiplier),
                    resourcesWithoutTags: Math.round(861 * multiplier), tagNames: tags.length,
                    tagValues: tags.reduce((s, t) => s + t.values.length, 0),
                },
            };
        }
        case 'm365_overview': {
            const round2 = (x: number) => Math.round(x * 100) / 100;
            const totalUsers = Math.round(78 * multiplier);
            const inactive = Math.max(1, Math.round(totalUsers * 0.013));
            const blocked = Math.max(1, Math.round(totalUsers * 0.026));
            const active = totalUsers - inactive;
            const totalGroups = Math.round(66 * multiplier);
            const inactiveGroups = Math.round(totalGroups * 0.21);
            return {
                success: true, mock: true,
                kpis: {
                    totalUsers, licensedUsers: Math.round(62 * multiplier),
                    mfaEnforcedUsers: totalUsers, totalGroups,
                },
                userActivity: { active, inactive, blocked, total: totalUsers },
                groupsActivity: { active: totalGroups - inactiveGroups, inactive: inactiveGroups, noOwner: 3, total: totalGroups },
                productLicense: {
                    productCount: 13, totalLicenses: Math.round(2040117 * multiplier),
                    totalUnused: Math.round(2040117 * multiplier), unusedPct: 100, totalSpend: round2(11800 * multiplier),
                },
                topInactiveUsers: [
                    { name: 'Timothy Bowman', days: null },
                    { name: 'Thomas Ferguson', days: 196 },
                    { name: 'Steve Price', days: 41 },
                ],
                topUnusedLicenses: [
                    { name: 'Windows Store for Business', unused: Math.round(1000000 * multiplier) },
                    { name: 'Power BI (Free)', unused: Math.round(1000000 * multiplier) },
                    { name: 'Dynamics 365 Sales Enterprise', unused: Math.round(10000 * multiplier) },
                ],
                topInactiveGroups: [
                    { name: 'AI Solutions', days: null }, { name: 'All Managers', days: null },
                    { name: 'Corporate Culture', days: null }, { name: 'Employee Development', days: null },
                    { name: 'Release Management', days: null },
                ],
                topLicenseSpend: [
                    { name: 'Microsoft 365 Business Premium', spend: round2(10500 * multiplier) },
                    { name: 'Power BI Premium Per User', spend: round2(820 * multiplier) },
                    { name: 'Visio Online Plan 2', spend: round2(480 * multiplier) },
                ],
                authMethods: [
                    { method: 'Password', count: Math.round(92 * multiplier) },
                    { method: 'Microsoft Authenticator', count: Math.round(64 * multiplier) },
                    { method: 'SMS / Phone', count: Math.round(38 * multiplier) },
                    { method: 'Windows Hello', count: Math.round(21 * multiplier) },
                ],
                capabilities: { signInActivity: true, mfa: true },
            };
        }
        case 'm365_user_activity': {
            const products = [
                'Microsoft 365 Business Premium', 'Microsoft 365 Business Basic',
                'Microsoft 365 Business Premium, Microsoft Power Automate Free',
                'Microsoft Power Automate Free, Microsoft 365 Business Premium, Power BI Premium Per User',
            ];
            const firstNames = ['Aaron', 'Adriana', 'Amanda', 'Amy', 'Angela', 'Annette', 'Ashley', 'Blake', 'Brian', 'Casey', 'Cassandra', 'Chelsea', 'Courtney', 'Cynthia'];
            const lastNames = ['Sims', 'Alvarado', 'Brown', 'Bolton', 'Cox', 'Evans', 'Melton', 'Gonzales', 'Andrews', 'Smith', 'Miller', 'Gamble', 'Jackson', 'Perez'];
            const total = Math.round(78 * multiplier);
            const rows = firstNames.map((fn, i) => {
                const enabled = i !== 12; // Courtney Jackson disabled, como en la captura
                return {
                    displayName: `${fn} ${lastNames[i]}`,
                    accountEnabled: enabled,
                    lastActivityDays: i % 4 === 1 ? 1 : 0,
                    products: products[i % products.length].split(', '),
                    licenseCount: products[i % products.length].split(', ').length,
                    userPrincipalName: `${fn.toLowerCase()}.${lastNames[i].toLowerCase()}@demo.com`,
                };
            });
            return {
                success: true, mock: true,
                kpis: { total, enabled: total - 2, blocked: 2, active: total - 1, inactive: 1 },
                rows,
                capabilities: { signInActivity: true },
            };
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

// Base de cost groups para la demo, reusada por 'cost_groups' (listado) y por
// getMockCostGroupDetail (drill-through). Mismos nombres que 'platform-budgets'
// para que Budget/Forecast sean consistentes entre pantallas.
const MOCK_COST_GROUPS = (multiplier: number) => {
    const round2 = (x: number) => Math.round(x * 100) / 100;
    const iso = (daysAgo: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - daysAgo); return d.toISOString(); };
    const base = [
        { name: 'engineering', description: 'Cargas de cómputo y datos del equipo de Ingeniería', periodCost: 1200 * multiplier * 0.72, budget: 1200 * multiplier, owner: 'Sofía Méndez', subscriptions: 3, resourceGroups: 12, resources: 96, daysAgo: 1 },
        { name: 'marketing', description: 'Sitios web, CDN y analítica del equipo de Marketing', periodCost: 400 * multiplier * 0.91, budget: 400 * multiplier, owner: 'Carlos Ruiz', subscriptions: 1, resourceGroups: 4, resources: 22, daysAgo: 2 },
        { name: 'data-platform', description: 'Data Lake, Synapse y pipelines de analítica', periodCost: 2500 * multiplier * 0.58, budget: 2500 * multiplier, owner: 'Ana Torres', subscriptions: 2, resourceGroups: 9, resources: 74, daysAgo: 0 },
        { name: 'shared-services', description: 'Networking, identidad y servicios compartidos entre BUs', periodCost: 900 * multiplier * 1.03, budget: 900 * multiplier, owner: 'Diego Fernández', subscriptions: 4, resourceGroups: 15, resources: 130, daysAgo: 3 },
        { name: 'Untagged', description: 'Recursos sin tag CostCenter asignado', periodCost: 300 * multiplier * 0.35, budget: 0, owner: null, subscriptions: 1, resourceGroups: 3, resources: 18, daysAgo: 12 },
    ];
    return base.map(g => ({
        name: g.name,
        description: g.description,
        avgDailyCost: round2(g.periodCost / 30),
        periodCost: round2(g.periodCost),
        monthlyBilledCost: round2(g.periodCost),
        budget: round2(g.budget),
        forecast: round2(g.periodCost * 1.08),
        owner: g.owner,
        lastUpdated: iso(g.daysAgo),
        subscriptions: g.subscriptions,
        resourceGroups: g.resourceGroups,
        resources: g.resources,
    }));
};

/**
 * Recursos individuales de un Centro de Costos (o 'Sin asignar') para el
 * drawer de detalle en tenants demo/mock. Usado por
 * GET /api/intelligence/cost-centers/resources cuando isMockTenant(tenantId).
 */
export const getMockCostCenterResources = (costCenterName: string, tier: string): any => {
    const t = (tier || 'professional').toLowerCase();
    const multiplier = t === 'enterprise' ? 50 : t === 'business' ? 10 : t === 'pro' || t === 'professional' ? 3 : 1;
    const isUnassigned = costCenterName === 'Sin asignar';
    const rgNames = isUnassigned
        ? ['rg-desarrollo-cl', 'rg-peopletrack']
        : [`rg-${costCenterName.toLowerCase()}-prod`, `rg-${costCenterName.toLowerCase()}-shared`];
    const resourceTypes = ['microsoft.compute/virtualmachines', 'microsoft.storage/storageaccounts', 'microsoft.web/sites', 'microsoft.sql/servers/databases'];
    const count = Math.max(3, Math.round((isUnassigned ? 9 : 12) * (multiplier >= 10 ? 1.4 : 1)));
    const resources = Array.from({ length: count }).map((_, i) => {
        const rg = rgNames[i % rgNames.length];
        const type = resourceTypes[i % resourceTypes.length];
        return {
            id: `/subscriptions/mock-sub-1/resourceGroups/${rg}/providers/${type}/res-${costCenterName.toLowerCase().replace(/\s+/g, '-')}-${i + 1}`,
            name: `res-${costCenterName.toLowerCase().replace(/\s+/g, '-')}-${i + 1}`,
            type,
            resourceGroup: rg,
        };
    });
    return { success: true, mock: true, costCenterName, resourceGroups: rgNames, resources };
};

/**
 * Detalle de drill-through de un Cost Group para tenants de demo/mock —
 * separado de getMockDataForRoute porque necesita el nombre del grupo, no
 * sólo tenantId/tier. Usado por GET /api/cost-groups/[name] cuando
 * isMockTenant(tenantId).
 */
export const getMockCostGroupDetail = (name: string, tier: string): any => {
    const t = (tier || 'professional').toLowerCase();
    const multiplier = t === 'enterprise' ? 50 : t === 'business' ? 10 : t === 'pro' || t === 'professional' ? 3 : 1;
    const round2 = (x: number) => Math.round(x * 100) / 100;
    const groups = MOCK_COST_GROUPS(multiplier);
    const group = groups.find(g => g.name.toLowerCase() === name.toLowerCase()) || groups[0];

    const monthLabel = (offset: number) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - offset); return d.toISOString().slice(0, 7); };
    const monthlyCost = [5, 4, 3, 2, 1, 0].map((offset, i) => ({
        month: monthLabel(offset),
        actual: round2(group.periodCost / 30 * 30 * (0.85 + i * 0.03)),
        budget: round2(group.budget),
        forecast: round2(group.periodCost / 30 * 30 * (0.9 + i * 0.035)),
    }));

    const subs = Array.from({ length: group.subscriptions }, (_, i) => ({
        name: `Subscription ${String.fromCharCode(65 + i)}`,
        cost: round2((group.periodCost / group.subscriptions) * (1 - i * 0.15)),
        budget: round2((group.budget / group.subscriptions)),
    }));

    const locations = [
        { region: 'eastus', resources: Math.round(group.resources * 0.4) },
        { region: 'westeurope', resources: Math.round(group.resources * 0.25) },
        { region: 'brazilsouth', resources: Math.round(group.resources * 0.2) },
        { region: 'southeastasia', resources: Math.round(group.resources * 0.15) },
    ].filter(l => l.resources > 0);

    const resourceTypes = ['microsoft.compute/virtualmachines', 'microsoft.storage/storageaccounts', 'microsoft.sql/servers/databases', 'microsoft.network/networkinterfaces'];

    const recommendationsCount = Math.max(1, Math.round(group.resources / 12));
    const recommendations = Array.from({ length: recommendationsCount }, (_, i) => ({
        id: `mock-rec-${group.name}-${i}`,
        title: i % 2 === 0 ? 'Redimensionar VM subutilizada' : 'Eliminar disco no adjunto',
        category: i % 2 === 0 ? 'Cost' : 'OperationalExcellence',
        impact: i % 3 === 0 ? 'High' : 'Medium',
        resource: `${group.name}-res-${i + 1}`,
        resourceGroup: `rg-${group.name}-${(i % group.resourceGroups) + 1}`,
        subscription: subs[i % Math.max(1, subs.length)]?.name || 'Subscription A',
        potentialSavingsMonthly: round2((group.periodCost * 0.06) / recommendationsCount),
    }));

    const costAnomaliesCount = Math.max(1, Math.round(group.resources / 25));
    const costAnomalies = Array.from({ length: costAnomaliesCount }, (_, i) => {
        const prev = round2((group.periodCost / 30) * (0.6 + i * 0.05));
        const curr = round2(prev * (1.4 + i * 0.1));
        const d = new Date(); d.setUTCDate(d.getUTCDate() - (i + 1) * 2);
        return {
            date: d.toISOString().slice(0, 10),
            resource: resourceTypes[i % resourceTypes.length].split('/')[1],
            previousCost: prev,
            newCost: curr,
            costChange: round2(curr - prev),
            pctChange: round2(((curr - prev) / prev) * 100),
            costGroup: group.name,
            subscription: subs[i % Math.max(1, subs.length)]?.name || 'Subscription A',
            resourceGroup: `rg-${group.name}-${(i % group.resourceGroups) + 1}`,
        };
    });

    const monthlySaving = round2(group.periodCost * 0.06);

    const serviceNames = ['Application Gateways', 'Azure App Services', 'Azure Cosmos DB', 'Virtual Machines', 'Storage Accounts', 'Azure SQL Database'];
    const meterNames = ['vCore', 'GRS Data Stored', 'RA-GRS Data Stored', 'Standard IO', 'Bandwidth', 'Reserved Instance'];
    const serviceCategories = ['Compute', 'Storage', 'Networking', 'Databases', 'Web', 'Analytics'];
    const distribute = (names: string[], seed: number) => {
        const weights = [0.32, 0.24, 0.18, 0.12, 0.09, 0.05];
        return names.map((n, i) => ({ name: n, cost: round2(group.periodCost * (weights[i] || 0.02) * (0.85 + ((i + seed) % 3) * 0.1)) })).filter(r => r.cost > 0);
    };

    const subscriptionTrend = [2, 1, 0].map(offset => {
        const d = new Date(); d.setUTCMonth(d.getUTCMonth() - offset);
        const point: Record<string, any> = { month: d.toISOString().slice(0, 7) };
        subs.forEach((s, i) => { point[s.name] = round2(s.cost * (0.85 + offset * 0.05 + i * 0.02)); });
        return point;
    });

    const auditLogsCount = Math.max(2, Math.round(group.resources / 20));
    const auditActionTypes = ['STOP_VM', 'START_VM', 'RESIZE_VM', 'DELETE_RESOURCE', 'RESTART_VM'];
    const auditUsers = ['sofia@demo.com', 'carlos@demo.com', 'ana@demo.com', 'admin@demo.com'];
    const auditLogs = Array.from({ length: auditLogsCount }, (_, i) => {
        const d = new Date(); d.setUTCDate(d.getUTCDate() - (i + 1) * 3);
        return {
            date: d.toISOString(),
            from: auditUsers[i % auditUsers.length],
            to: i % 5 === 0 ? 'failed' : 'success',
            subject: auditActionTypes[i % auditActionTypes.length],
            resource: `${group.name}-res-${i + 1}`,
            comment: i % 5 === 0 ? 'Fallo de permisos en la suscripción destino.' : 'Ejecutado vía Centro de Acciones.',
        };
    });

    const periodCost = round2(group.periodCost);
    const previousPeriodCost = round2(group.periodCost * 0.92);
    const currentFYCost = round2(group.periodCost * 8.5);
    const previousFYCostRaw = round2(currentFYCost * 0.88);
    const projectedFYCost = round2(currentFYCost * 1.1);

    const resourceGroups = Array.from({ length: group.resourceGroups }, (_, i) => ({
        resourceGroup: `rg-${group.name}-${i + 1}`,
        avgDailyCost: round2((group.periodCost / group.resourceGroups) / 30),
        periodCost: round2(group.periodCost / group.resourceGroups),
        subscriptions: 1 + (i % Math.max(1, group.subscriptions)),
        owner: group.owner ? [group.owner, subs[i % Math.max(1, subs.length)]?.name].filter(Boolean)[0] : null,
        createdDate: new Date(Date.now() - (120 + i * 17) * 86400000).toISOString(),
        createdBy: group.owner || 'admin@demo.com',
    }));

    return {
        success: true,
        mock: true,
        name: group.name,
        description: group.description,
        owner: group.owner,
        createdBy: 'admin@demo.com',
        createdAt: new Date(Date.now() - 200 * 86400000).toISOString(),
        lastUpdated: group.lastUpdated,
        currentFY: {
            actualCostToDateFY: currentFYCost,
            currentMonthActualCost: round2(group.periodCost),
            monthlyBudget: round2(group.budget),
            currentMonthForecast: round2(group.forecast),
            subscriptionBreakdown: subs,
            monthlySaving,
            subscriptionsCount: group.subscriptions,
            recommendationsCount,
            resourceGroupsCount: group.resourceGroups,
            costAnomaliesCount,
        },
        costs: {
            monthlyCost,
            locations,
            periodComparison: {
                periodCost,
                previousPeriodCost,
                periodChangePct: round2(((periodCost - previousPeriodCost) / previousPeriodCost) * 100),
                projectedFYCost,
                previousFYCost: previousFYCostRaw,
                fyChangePct: round2(((projectedFYCost - previousFYCostRaw) / previousFYCostRaw) * 100),
                monthlyBudget: round2(group.budget),
            },
            byService: distribute(serviceNames, 0),
            byMeter: distribute(meterNames, 1),
            byServiceCategory: distribute(serviceCategories, 2),
            subscriptionTrend,
        },
        actions: {
            costAnomaliesCount,
            recommendationsCount,
            monthlySaving,
            costAnomalies,
            recommendations,
        },
        resources: {
            resourceGroupsCount: group.resourceGroups,
            resourceGroups,
        },
        governance: {
            resourcesTotal: group.resources,
            tagCoverage: [
                { name: 'Environment', pct: 82.5 },
                { name: 'Owner', pct: 68.0 },
                { name: 'CostCenter', pct: 100 },
            ],
            auditLogsCount,
            auditLogs,
        },
    };
};

export const MOCK_CONTAINER_DOMAIN = {
    apps: [
        { name: "ca-frontend-prod", resourceGroup: "rg-prod-westus2", environment: "cae-prod-westus2", cpuCores: 0.5, memoryGb: 1, minReplicas: 1, maxReplicas: 10, baseCost: 45.50, baseSaving: 0 },
        { name: "ca-backend-api", resourceGroup: "rg-prod-westus2", environment: "cae-prod-westus2", cpuCores: 1, memoryGb: 2, minReplicas: 0, maxReplicas: 5, baseCost: 78.20, baseSaving: 15.00 },
        { name: "ca-worker-jobs", resourceGroup: "rg-prod-westus2", environment: "cae-prod-westus2", cpuCores: 0.25, memoryGb: 0.5, minReplicas: 0, maxReplicas: 3, baseCost: 12.80, baseSaving: 5.20 },
    ],
    registries: [
        { name: "crprodglobal", resourceGroup: "rg-prod-westus2", sku: "Premium", baseCost: 50.00, location: "westus2" },
    ],
    environments: [
        { name: "cae-prod-westus2", resourceGroup: "rg-prod-westus2", baseCost: 15.00, location: "westus2" },
    ],
};
