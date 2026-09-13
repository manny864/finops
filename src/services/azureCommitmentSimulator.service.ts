/**
 * Servicio de Simulación Avanzada de Compromisos (MEJ-16).
 * Mix Óptimo y Monitor del Límite Anual de Devolución/Reembolso de Reservas
 * de Azure ($50,000 USD).
 *
 * El breakeven determinista vive en `@/lib/commitmentBreakeven` porque lo
 * consume un componente de cliente; ver el comentario de ese archivo.
 */
import { calculateBreakeven, round1, round2 } from "@/lib/commitmentBreakeven";

export type {
    BreakevenInput,
    RecommendedMix,
    BreakevenResult,
} from "@/lib/commitmentBreakeven";

export interface ExchangeQuotaResult {
    totalLimitUSD: number;
    usedRefundsUSD: number;
    remainingQuotaUSD: number;
    usagePercentage: number;
    isWarning: boolean;
    isCritical: boolean;
    lastRefundDate?: string | null;
}

export class AzureCommitmentSimulatorService {
    /** Delega en la version pura: los llamadores de servidor no cambian. */
    static calculateBreakeven = calculateBreakeven;

    /**
     * Consulta el consumo de la cuota anual de $50,000 USD de reembolsos / intercambios
     * de Microsoft Azure Reservations para el tenant.
     */
    static async getExchangeQuota(tenantId: string): Promise<ExchangeQuotaResult> {
        const TOTAL_LIMIT = 50000;

        // Si es tenant de pruebas o demo, devolver estado representativo
        if (tenantId === "default" || tenantId.startsWith("demo-") || tenantId.includes("mock") || tenantId.includes("dev")) {
            const used = 8500;
            const remaining = TOTAL_LIMIT - used;
            const pct = round1((used / TOTAL_LIMIT) * 100);
            return {
                totalLimitUSD: TOTAL_LIMIT,
                usedRefundsUSD: used,
                remainingQuotaUSD: remaining,
                usagePercentage: pct,
                isWarning: pct >= 80,
                isCritical: pct >= 95,
                lastRefundDate: new Date(Date.now() - 45 * 86400000).toISOString()
            };
        }

        try {
            const pool = (await import("@/modules/storage/db")).default;
            // Consultar si hay registros en CostSnapshots con cargo negativo por Reservation Cancellation
            const [rows]: any = await pool.query(
                `SELECT 
                    SUM(ABS(COALESCE(BilledCost, cost_usd, 0))) AS totalRefunded,
                    MAX(COALESCE(ChargePeriodStart, date)) AS lastRefund
                 FROM CostSnapshots
                 WHERE tenant_id = ?
                   AND (ChargeType LIKE '%Refund%' OR ChargeType LIKE '%Cancellation%' OR ChargeDescription LIKE '%Reservation%Refund%')
                   AND COALESCE(ChargePeriodStart, date) >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)`,
                [tenantId]
            );

            const used = round2(Number(rows?.[0]?.totalRefunded || 0));
            const remaining = Math.max(0, TOTAL_LIMIT - used);
            const pct = round1((used / TOTAL_LIMIT) * 100);
            const lastDate = rows?.[0]?.lastRefund ? new Date(rows[0].lastRefund).toISOString() : null;

            return {
                totalLimitUSD: TOTAL_LIMIT,
                usedRefundsUSD: used,
                remainingQuotaUSD: remaining,
                usagePercentage: pct,
                isWarning: pct >= 80,
                isCritical: pct >= 95,
                lastRefundDate: lastDate
            };
        } catch {
            // Fallback determinista seguro
            return {
                totalLimitUSD: TOTAL_LIMIT,
                usedRefundsUSD: 0,
                remainingQuotaUSD: TOTAL_LIMIT,
                usagePercentage: 0,
                isWarning: false,
                isCritical: false,
                lastRefundDate: null
            };
        }
    }
}
