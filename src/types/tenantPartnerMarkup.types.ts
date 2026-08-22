/**
 * Contratos del motor de facturación de partner (CSP).
 *
 * Todos los importes viajan como `number` ya redondeado a 2 decimales por
 * `toMoneyNumber`; el cálculo intermedio es Decimal (Regla Cero). Nunca hacer
 * aritmética sobre estos valores en el cliente: son para mostrar.
 */

export type MarkupScopeType = 'SUBSCRIPTION' | 'SERVICE_CATEGORY';

export interface TenantMarkupSettings {
    tenantId: string;
    globalMarkupPercentage: number;
    fixedManagementFeeUSD: number;
    isMarkupEnabled: boolean;
    updatedAt: string;
}

export interface MarkupOverrideRuleItem {
    id: string;
    tenantId: string;
    ruleName: string;
    scopeType: MarkupScopeType;
    scopeValue: string;
    overridePercentage: number;
    isEnabled: boolean;
    createdAt: string;
}

export interface MarkupSimulationResult {
    baseCost: number;
    markupAmount: number;
    fixedFeeAmount: number;
    totalBilledCost: number;
}

export interface SaveMarkupPayload {
    globalMarkupPercentage: number;
    fixedManagementFeeUSD: number;
    isMarkupEnabled: boolean;
}

export interface CreateOverrideRulePayload {
    ruleName: string;
    scopeType: MarkupScopeType;
    scopeValue: string;
    overridePercentage: number;
}

export const MARKUP_SCOPE_TYPES: MarkupScopeType[] = ['SUBSCRIPTION', 'SERVICE_CATEGORY'];

export function isMarkupScopeType(value: unknown): value is MarkupScopeType {
    return typeof value === 'string' && (MARKUP_SCOPE_TYPES as string[]).includes(value);
}

/**
 * `Tenants.markup_percentage` es DECIMAL(5,2): admite hasta 999.99 con dos
 * decimales. Un valor fuera de rango o con más escala lo trunca MySQL en
 * silencio, así que se rechaza antes de escribir.
 */
export function isValidMarkupPercentage(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 999.99;
}

/** `management_fee_usd` es DECIMAL(12,2). */
export function isValidFixedFee(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 9999999999.99;
}
