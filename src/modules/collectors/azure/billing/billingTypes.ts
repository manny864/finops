export type CostQueryDiagnostics = {
    scopeAttempted: string;
    isFallback: boolean;
    isThrottled?: boolean;
    subsDiscovered: number;
    subsSucceeded: number;
    subsWithData: number;
    perSubErrors: Array<{ subscriptionId: string; code: string; message: string }>;
    totalRows: number;
    subsList: string[];
    timeframeUsed: 'MonthToDate' | 'Last30Days';
    last30RowsIfMtdEmpty?: number;
};

export type DetailedCostRow = {
    kind: 'chargeback' | 'meter' | 'category';
    subscriptionId: string;
    resourceGroup: string;
    resourceLocation: string;
    resourceType: string;
    serviceName: string;
    serviceFamily: string;
    meterCategory: string;
    meterSubCategory: string;
    meterName: string;
    cost: number;
    quantity: number;
    unitOfMeasure: string;
};

export type HistoricalDetailedCostRow = DetailedCostRow & {
    date: string;
};

export const AZURE_COST_HISTORY_MAX_MONTHS = 13;
