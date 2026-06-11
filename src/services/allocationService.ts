export type CostEntry = {
    resourceId: string;
    resourceName: string;
    costCenter: string;
    amount: number;
};

export type AllocationRule = {
    id?: string;
    tenantId: string;
    sourceResourceId: string;
    targetCostCenter: string;
    percentage: number;
};

export function calculateChargeback(costs: CostEntry[], rules: AllocationRule[]): Record<string, number> {
    const finalCosts: Record<string, number> = {};

    for (const cost of costs) {
        if (!finalCosts[cost.costCenter]) {
            finalCosts[cost.costCenter] = 0;
        }
        finalCosts[cost.costCenter] += cost.amount;
    }

    for (const rule of rules) {
        const sourceCost = costs.find(c => c.resourceId === rule.sourceResourceId);
        if (sourceCost) {
            const amountToMove = sourceCost.amount * (rule.percentage / 100);
            
            finalCosts[sourceCost.costCenter] -= amountToMove;
            
            if (!finalCosts[rule.targetCostCenter]) {
                finalCosts[rule.targetCostCenter] = 0;
            }
            finalCosts[rule.targetCostCenter] += amountToMove;
        }
    }

    return finalCosts;
}
