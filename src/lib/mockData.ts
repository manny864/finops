export const isMockTenant = (tenantId: string) => {
    return [
        "11111111-2222-3333-4444-555555555555",
        "22222222-3333-4444-5555-666666666666",
        "44444444-5555-6666-7777-888888888888",
        "33333333-4444-5555-6666-777777777777"
    ].includes(tenantId);
};

export const getMockDataForRoute = (route: string, tenantId: string) => {
    if (!isMockTenant(tenantId)) return null;
    
    // Simulate some network delay
    
    switch (route) {
        case 'advisor':
            return {
                success: true,
                recommendations: { Cost: [], Security: [], HighAvailability: [], Performance: [], OperationalExcellence: [] },
                subscriptions: [{ id: "mock-sub", name: "Demo Subscription" }],
                scores: { "mock-sub": { Cost: 100 } }
            };
        case 'rightsizing':
            return {
                success: true,
                recommendations: [
                    {
                        id: "mock-rec-1",
                        name: "Resize VM",
                        type: "Virtual Machine",
                        resourceId: "/subscriptions/mock-sub/resourceGroups/mock-rg/providers/Microsoft.Compute/virtualMachines/mock-vm",
                        currentSku: "Standard_D4s_v3",
                        targetSku: "Standard_D2s_v3",
                        savings: 45.50
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
                        { id: "/subscriptions/mock-sub/resourceGroups/mock-rg", name: "mock-rg", type: "Resource Group", daysOverdue: 5 }
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
                        { id: "mock-disk", name: "orphan-disk-01", resourceGroup: "mock-rg", diskSizeGB: 128, location: "eastus", sku: "Premium_LRS", estimatedMonthlyCost: 19.2 }
                    ],
                    unusedVNetGateways: [],
                    emptyAppServicePlans: [],
                    unattachedPublicIps: [],
                    unattachedNics: [],
                    longStoppedVMs: [],
                    emptyRgs: []
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
        default:
            return { success: true, message: "Mock data not defined for this route" };
    }
};
