import pool from "@/modules/storage/db";
import { getSnapshotHistory } from "@/services/snapshotService";
import { isMockTenant } from "@/lib/mockData";
import type {
    CapturedSavingsSummary,
    CapturedSavingsPoint,
    RemediationAuditItem,
} from "@/types/capturedSavings.types";
import { errorMessage } from '@/lib/apiErrors';

export class AzureCapturedSavingsService {
    /**
     * Retrieves the complete captured savings summary for a tenant.
     */
    static async getCapturedSavings(
        tenantId: string,
        tier: string = "Enterprise"
    ): Promise<CapturedSavingsSummary> {
        if (isMockTenant(tenantId)) {
            return this.getMockCapturedSavings(tier);
        }

        return this.fetchLiveCapturedSavings(tenantId);
    }

    /**
     * Generates tier-scaled synthetic data for demo/mock tenants.
     */
    static getMockCapturedSavings(tier: string = "Enterprise"): CapturedSavingsSummary {
        const normalizedTier = (tier || "Enterprise").toUpperCase();
        let multiplier = 1.0;
        if (normalizedTier === "PROFESSIONAL") multiplier = 0.35;
        else if (normalizedTier === "BUSINESS") multiplier = 0.65;
        else multiplier = 1.0;

        const currentPotential = Math.round(1450.0 * multiplier * 100) / 100;
        const currentWasted = Math.round(1450.0 * multiplier * 100) / 100;

        // Generate 12 months trend
        const trend: CapturedSavingsPoint[] = [];
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const dateStr = d.toISOString().slice(0, 7); // YYYY-MM
            const monthFactor = 0.7 + (11 - i) * 0.03;
            const waste = Math.round(1600 * multiplier * monthFactor * 100) / 100;
            const potential = Math.round(waste * (0.85 + Math.sin(i) * 0.08) * 100) / 100;
            const realized = Math.round((waste - potential * 0.4) * 0.7 * 100) / 100;

            trend.push({
                date: dateStr,
                detectedWasteUSD: waste,
                potentialSavingsUSD: potential,
                realizedSavingsUSD: realized,
            });
        }

        const auditLog: RemediationAuditItem[] = [
            {
                id: "act-101",
                timestamp: new Date(Date.now() - 2 * 86400000).toISOString(),
                executedBy: "mchavez@cscloudsolutions.com.ar",
                resourceName: "disk-zombie-prod-app01",
                resourceType: "Microsoft.Compute/disks",
                actionCategory: "Purga de Disco Huérfano (Unattached)",
                monthlySavingsUSD: Math.round(48.5 * multiplier * 100) / 100,
                status: "SUCCESS",
                details: "Eliminación de disco Premium SSD de 256GB desasociado por más de 45 días.",
            },
            {
                id: "act-102",
                timestamp: new Date(Date.now() - 5 * 86400000).toISOString(),
                executedBy: "cloudops@cscloudsolutions.com.ar",
                resourceName: "vm-dev-batch-underutilized",
                resourceType: "Microsoft.Compute/virtualMachines",
                actionCategory: "Rightsizing (Standard_D4s_v5 → Standard_D2s_v5)",
                monthlySavingsUSD: Math.round(142.0 * multiplier * 100) / 100,
                status: "SUCCESS",
                details: "Optimización de vCPUs según telemetría de Azure Monitor (<15% CPU P95).",
            },
            {
                id: "act-103",
                timestamp: new Date(Date.now() - 9 * 86400000).toISOString(),
                executedBy: "mchavez@cscloudsolutions.com.ar",
                resourceName: "st-abandoned-backups-2025",
                resourceType: "Microsoft.Storage/storageAccounts",
                actionCategory: "Política Lifecycle (Tier Cool/Archive)",
                monthlySavingsUSD: Math.round(86.2 * multiplier * 100) / 100,
                status: "SUCCESS",
                details: "Transición automática de 4.2 TB de respaldos fríos a almacenamiento Archive.",
            },
            {
                id: "act-104",
                timestamp: new Date(Date.now() - 14 * 86400000).toISOString(),
                executedBy: "system-automation@cscloudsolutions.com.ar",
                resourceName: "vm-qa-environment-nightly",
                resourceType: "Microsoft.Compute/virtualMachines",
                actionCategory: "Auto-Shutdown Nocturno (19:00 - 07:00)",
                monthlySavingsUSD: Math.round(95.0 * multiplier * 100) / 100,
                status: "SUCCESS",
                details: "Programación de apagado fuera de horario laboral de lunes a viernes.",
            },
            {
                id: "act-105",
                timestamp: new Date(Date.now() - 20 * 86400000).toISOString(),
                executedBy: "mchavez@cscloudsolutions.com.ar",
                resourceName: "pip-unassociated-loadbalancer",
                resourceType: "Microsoft.Network/publicIPAddresses",
                actionCategory: "Liberación de IP Pública Huérfana",
                monthlySavingsUSD: Math.round(7.3 * multiplier * 100) / 100,
                status: "SUCCESS",
                details: "IP pública estática sin asociar a ninguna interfaz de red o Load Balancer.",
            },
            {
                id: "act-106",
                timestamp: new Date(Date.now() - 28 * 86400000).toISOString(),
                executedBy: "cloudops@cscloudsolutions.com.ar",
                resourceName: "sql-elastic-pool-dev-oversized",
                resourceType: "Microsoft.Sql/servers/elasticPools",
                actionCategory: "Ajuste de Capacidad vCore (8 → 4 vCores)",
                monthlySavingsUSD: Math.round(210.0 * multiplier * 100) / 100,
                status: "SUCCESS",
                details: "Reducción de vCores asignados a pool elástico con baja utilización concurrente.",
            },
        ];

        return {
            currentPotentialSavingsUSD: currentPotential,
            currentDetectedWasteUSD: currentWasted,
            totalHistoricalSnapshots: 16,
            changePercentageVsLast: 12.5,
            lastScanDate: now.toISOString().slice(0, 10),
            trend,
            auditLog,
        };
    }

    /**
     * Live database queries against ActionLogs & DailySnapshots.
     */
    private static async fetchLiveCapturedSavings(
        tenantId: string
    ): Promise<CapturedSavingsSummary> {
        // 1. Fetch 12-month snapshot points from DailySnapshots
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
        const startDateStr = twelveMonthsAgo.toISOString().slice(0, 10);

        let points: any[] = [];
        try {
            points = await getSnapshotHistory(
                tenantId,
                "dashboard_summary",
                startDateStr,
                undefined,
                "All"
            );
        } catch (e) {
            console.warn(`[AzureCapturedSavingsService] getSnapshotHistory warning:`, errorMessage(e));
        }

        const trend: CapturedSavingsPoint[] = points.map((p) => {
            const savings = Number((p.payload as any)?.totalSavings) || 0;
            const realized = Number((p.payload as any)?.realizedSavings) || Math.round(savings * 0.6 * 100) / 100;
            return {
                date: p.date,
                detectedWasteUSD: savings,
                potentialSavingsUSD: savings,
                realizedSavingsUSD: realized,
            };
        });

        const latest = trend[trend.length - 1] || null;
        const previous = trend.length > 1 ? trend[trend.length - 2] : null;
        const changePct =
            previous && previous.potentialSavingsUSD > 0
                ? Number(
                      (
                          ((latest!.potentialSavingsUSD - previous.potentialSavingsUSD) /
                              previous.potentialSavingsUSD) *
                          100
                      ).toFixed(1)
                  )
                : 0;

        // 2. Fetch action logs for audit history
        let auditLog: RemediationAuditItem[] = [];
        try {
            const [rows]: any = await pool.query(
                `SELECT id, user_email, action_type, resource_id, resource_type, status, details, timestamp
                 FROM ActionLogs
                 WHERE tenant_id = ?
                 ORDER BY timestamp DESC
                 LIMIT 50`,
                [tenantId]
            );

            auditLog = (rows || []).map((r: any) => {
                const resName = r.resource_id
                    ? r.resource_id.split("/").pop() || r.resource_id
                    : "Recurso no especificado";

                const resType = r.resource_type || "Microsoft.Resources/resource";
                const isSuccess = (r.status || "").toUpperCase() === "SUCCESS";

                // Estimate savings from action type
                let estSavings = 0;
                if (r.action_type === "DELETE_RESOURCE" || (r.action_type || "").includes("DELETE")) {
                    estSavings = 45.0;
                } else if ((r.action_type || "").includes("RIGHTSIZING") || (r.action_type || "").includes("RESIZE")) {
                    estSavings = 110.0;
                } else if ((r.action_type || "").includes("SHUTDOWN") || (r.action_type || "").includes("STOP")) {
                    estSavings = 75.0;
                }

                return {
                    id: `act-${r.id}`,
                    timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : new Date().toISOString(),
                    executedBy: r.user_email || "Sistema Automático",
                    resourceName: resName,
                    resourceType: resType,
                    actionCategory: r.action_type || "Optimización de Recurso",
                    monthlySavingsUSD: isSuccess ? estSavings : 0,
                    status: isSuccess ? ("SUCCESS" as const) : ("FAILED" as const),
                    details: r.details || `Acción ${r.action_type} ejecutada sobre ${resName}.`,
                };
            });
        } catch (err) {
            console.warn(`[AzureCapturedSavingsService] ActionLogs query warning:`, errorMessage(err));
        }

        return {
            currentPotentialSavingsUSD: latest ? latest.potentialSavingsUSD : 0,
            currentDetectedWasteUSD: latest ? latest.detectedWasteUSD : 0,
            totalHistoricalSnapshots: trend.length,
            changePercentageVsLast: changePct,
            lastScanDate: latest ? latest.date : undefined,
            trend,
            auditLog,
        };
    }
}
