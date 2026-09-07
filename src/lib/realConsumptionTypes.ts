/**
 * realConsumptionTypes.ts
 * Definición de tipos para el monitor dinámico de Consumo Real,
 * velocidad de gasto (burn rate), FOCUS drill-down y detección de anomalías.
 */

export interface ServiceResourceDetail {
    id: string;
    resourceName: string;
    resourceGroup: string;
    region: string;
    sku: string;
    costMtd: number;
    billedCost: number;
    effectiveCost: number;
    tags?: Record<string, string>;
    /** Clave i18n de la sugerencia; el payload no conoce el locale del lector. */
    remediationSuggestedKey?: string;
    remediationActionKey?: string;
    isAnomaly?: boolean;
}

export interface ConsumptionAnomaly {
    detected: boolean;
    reason?: string;
    spikePercentage?: number;
    last48hCost?: number;
    baselineDailyCost?: number;
}

export interface ServiceConsumptionSummary {
    serviceKey: string;
    serviceName: string;
    category: string;
    iconName: string;
    totalCost: number;
    percentageOfTotal: number;
    dailyBurnRate: number;
    projectedCost: number;
    momVariation: number;
    resourceCount: number;
    hasAnomaly: boolean;
    primarySku: string;
    /**
     * El texto de la recomendacion y la etiqueta del boton se resuelven en la UI
     * a partir de remediationActionKey (claves rc_rec_<key> y rc_act_<key>).
     */
    remediationActionKey: string;
    potentialSavings: number;
    resources: ServiceResourceDetail[];
}

export interface ShareOfWalletItem {
    name: string;
    serviceKey: string;
    percentage: number;
    cost: number;
    color: string;
}

export interface RealConsumptionOverview {
    totalCost: number;
    projectedCost: number;
    dailyBurnRate: number;
    momVariation: number;
    daysElapsed: number;
    daysInMonth: number;
    hasAnomalies: boolean;
    anomalyCount: number;
    topServices: ServiceConsumptionSummary[];
    services: ServiceConsumptionSummary[];
    top5ShareOfWallet: ShareOfWalletItem[];
    billedCostTotal: number;
    effectiveCostTotal: number;
    currency: string;
    source: "live-cost-management" | "snapshot-fallback" | "mock";
    period: {
        start: string;
        end: string;
        daysElapsed: number;
        daysInMonth: number;
    };
}
