import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { getAzureCredential } from "@/lib/azure";
import type { RowDataPacket } from "mysql2";

export interface CommitmentsCoverageResult {
    coveragePercent: number;
    hasActiveCommitments: boolean;
}

/**
 * Obtiene el porcentaje de cobertura de compromisos (Reservations / Savings Plans).
 */
export async function getRealCommitmentsCoverage(tenantId: string): Promise<CommitmentsCoverageResult> {
    if (isMockTenant(tenantId)) {
        return { coveragePercent: 45.0, hasActiveCommitments: true };
    }

    // 1. Intentar derivar desde CostSnapshots (datos ya sincronizados)
    try {
        const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT 
                SUM(CASE WHEN CommitmentDiscountId IS NOT NULL AND CommitmentDiscountId != '' THEN COALESCE(EffectiveCost, cost_usd, 0) ELSE 0 END) AS reservedSpend,
                SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS totalSpend
             FROM CostSnapshots
             WHERE tenant_id = ?
               AND COALESCE(ChargePeriodStart, date) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
            [tenantId]
        );

        const total = Number(rows?.[0]?.totalSpend || 0);
        const reserved = Number(rows?.[0]?.reservedSpend || 0);

        if (total > 0 && reserved > 0) {
            const pct = Math.round(((reserved / total) * 100) * 10) / 10;
            return { coveragePercent: Math.min(100, pct), hasActiveCommitments: true };
        }
    } catch {
        // Fallback a Microsoft.Capacity
    }

    // 2. Intentar consultar Microsoft.Capacity / getActiveReservations
    try {
        const credential = await getAzureCredential(tenantId);
        const { getActiveReservations } = await import("@/services/reservationService");
        const details = await getActiveReservations(credential).catch(() => []);
        const active = details.filter((r) => {
            const s = (r.status || "").toLowerCase();
            return s.includes("succeed") || s.includes("active");
        });

        if (active.length > 0) {
            let totalWeighted = 0;
            let totalQty = 0;
            for (const r of active) {
                const u = r.utilizationLast7Days !== null ? r.utilizationLast7Days : (r.utilizationLastDay ?? 100);
                const q = Math.max(1, r.quantity || 1);
                totalWeighted += u * q;
                totalQty += q;
            }
            const coverage = totalQty > 0 ? Math.round((totalWeighted / totalQty) * 10) / 10 : 100;
            return { coveragePercent: Math.min(100, coverage), hasActiveCommitments: true };
        }
    } catch {
        // Si no hay acceso a Azure ni credenciales configuradas
    }

    return { coveragePercent: 0, hasActiveCommitments: false };
}
