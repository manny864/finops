/**
 * Tipos y contratos TypeScript para Normalizador de Unidades de Precio (FOCUS 1.1 / SuperAdmin).
 */

export type UomCategory = "AI" | "COMPUTE" | "STORAGE" | "NETWORK" | "OTHER";

export interface PricingUnitCatalogItem {
    id: string;
    rawUomName: string;
    blockSizeMultiplier: number;
    baseUnitKey: string;
    displayUnitName: string;
    category: UomCategory;
}

export interface TestNormalizationPayload {
    unitOfMeasure: string;
    quantity: number;
}

export interface TestNormalizationResponse {
    success: boolean;
    originalUom: string;
    originalQuantity: number;
    normalizedQuantity: number;
    baseUnit: string;
    displayUnit: string;
    formattedResult: string;
    category: UomCategory;
    inferred: boolean;
}

export interface PricingUnitsCatalogResponse {
    success: boolean;
    totalCount: number;
    items: PricingUnitCatalogItem[];
}

export interface ReseedPricingUnitsResponse {
    success: boolean;
    inserted: number;
    message: string;
}
