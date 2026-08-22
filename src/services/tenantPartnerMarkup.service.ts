/**
 * tenantPartnerMarkup.service — configuración del motor de facturación CSP.
 *
 * Fuente única del margen para TODOS los caminos de facturación (reporte de
 * invoicing, PDF emailado, simulación de la UI). Antes cada ruta leía
 * `markup_percentage` por su cuenta y la de email además reimplementaba el
 * cálculo con floats, así que el PDF podía diferir del reporte en pantalla.
 *
 * RBAC: no valida identidad; las rutas resuelven el guard antes de llamar.
 * Regla Cero: todo el dinero se calcula con decimal.js, nunca con `number`.
 */
import Decimal from 'decimal.js';
import pool from '@/modules/storage/db';
import { toMoneyNumber } from '@/lib/moneyDecimal';
import type { MarkupOverride } from '@/services/invoicingAggregationService';
import type {
    MarkupOverrideRuleItem,
    MarkupScopeType,
    MarkupSimulationResult,
    TenantMarkupSettings,
} from '@/types/tenantPartnerMarkup.types';

/** Costo base de la simulación de la UI. */
export const SIMULATION_BASE_COST = 10000;

const DEFAULT_MARKUP_PERCENT = 0;

/**
 * Lee la configuración global de markup. Fallback de esquema para réplicas donde
 * 20260822-009 todavía no corrió — filtrado por ER_BAD_FIELD_ERROR para que un
 * timeout se propague en vez de disfrazarse de "esquema viejo".
 */
export async function getMarkupSettings(tenantId: string): Promise<TenantMarkupSettings> {
    let row: any;
    try {
        const [rows] = await pool.query<any[]>(
            `SELECT markup_percentage, management_fee_usd, markup_enabled, tier
             FROM Tenants WHERE tenant_id = ? LIMIT 1`,
            [tenantId]
        );
        row = rows?.[0];
    } catch (err: any) {
        if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
        const [legacy] = await pool.query<any[]>(
            'SELECT markup_percentage, tier FROM Tenants WHERE tenant_id = ? LIMIT 1',
            [tenantId]
        );
        row = legacy?.[0];
    }

    return {
        tenantId,
        globalMarkupPercentage: row?.markup_percentage != null ? Number(row.markup_percentage) : DEFAULT_MARKUP_PERCENT,
        fixedManagementFeeUSD: row?.management_fee_usd != null ? Number(row.management_fee_usd) : 0,
        // Sin la columna se asume habilitado: es el comportamiento previo, y
        // asumir lo contrario apagaría el margen de todos los tenants con
        // markup cargado mientras la migración se propaga.
        isMarkupEnabled: row?.markup_enabled != null ? Boolean(row.markup_enabled) : true,
        updatedAt: new Date().toISOString(),
    };
}

export async function saveMarkupSettings(
    tenantId: string,
    payload: { globalMarkupPercentage: number; fixedManagementFeeUSD: number; isMarkupEnabled: boolean }
): Promise<void> {
    await pool.query(
        `UPDATE Tenants
         SET markup_percentage = ?, management_fee_usd = ?, markup_enabled = ?
         WHERE tenant_id = ?`,
        [
            payload.globalMarkupPercentage,
            payload.fixedManagementFeeUSD,
            payload.isMarkupEnabled,
            tenantId,
        ]
    );
}

export async function listOverrideRules(tenantId: string): Promise<MarkupOverrideRuleItem[]> {
    try {
        const [rows] = await pool.query<any[]>(
            `SELECT id, tenant_id, rule_name, scope_type, scope_value, override_percentage, is_enabled, created_at
             FROM MarkupOverrideRules WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 500`,
            [tenantId]
        );
        return (rows || []).map((r) => ({
            id: String(r.id),
            tenantId: r.tenant_id,
            ruleName: r.rule_name,
            scopeType: r.scope_type as MarkupScopeType,
            scopeValue: r.scope_value,
            overridePercentage: Number(r.override_percentage),
            isEnabled: Boolean(r.is_enabled),
            createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
        }));
    } catch (err: any) {
        // La tabla llega con 20260822-009; sin ella simplemente no hay reglas.
        if (err?.code === 'ER_NO_SUCH_TABLE') return [];
        throw err;
    }
}

/** Sólo las reglas activas, en la forma que consume `buildInvoicingPayload`. */
export async function getActiveOverrides(tenantId: string): Promise<MarkupOverride[]> {
    const rules = await listOverrideRules(tenantId);
    return rules
        .filter((r) => r.isEnabled)
        .map((r) => ({
            scopeType: r.scopeType,
            scopeValue: r.scopeValue,
            overridePercentage: r.overridePercentage,
        }));
}

export async function createOverrideRule(
    tenantId: string,
    payload: { ruleName: string; scopeType: MarkupScopeType; scopeValue: string; overridePercentage: number },
    createdByEmail?: string
): Promise<void> {
    await pool.query(
        `INSERT INTO MarkupOverrideRules (tenant_id, rule_name, scope_type, scope_value, override_percentage, created_by_email)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [tenantId, payload.ruleName, payload.scopeType, payload.scopeValue, payload.overridePercentage, createdByEmail || null]
    );
}

export async function setOverrideRuleEnabled(tenantId: string, ruleId: string, isEnabled: boolean): Promise<void> {
    await pool.query(
        'UPDATE MarkupOverrideRules SET is_enabled = ? WHERE id = ? AND tenant_id = ?',
        [isEnabled, ruleId, tenantId]
    );
}

export async function deleteOverrideRule(tenantId: string, ruleId: string): Promise<void> {
    await pool.query('DELETE FROM MarkupOverrideRules WHERE id = ? AND tenant_id = ?', [ruleId, tenantId]);
}

/**
 * Simulación de facturación sobre un costo base. Con decimal.js: es el número
 * que el MSP usa para decidir su precio, y un centavo de drift acá se propaga a
 * la factura del cliente.
 */
export function simulateBilling(
    markupPercentage: number,
    fixedFeeUSD: number,
    baseCost: number = SIMULATION_BASE_COST
): MarkupSimulationResult {
    const base = new Decimal(baseCost || 0);
    const markupAmount = base.mul(new Decimal(markupPercentage || 0).dividedBy(100));
    const fee = new Decimal(fixedFeeUSD || 0);

    return {
        baseCost: toMoneyNumber(base),
        markupAmount: toMoneyNumber(markupAmount),
        fixedFeeAmount: toMoneyNumber(fee),
        totalBilledCost: toMoneyNumber(base.plus(markupAmount).plus(fee)),
    };
}
