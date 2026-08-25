import pool from "@/modules/storage/db";
import { getSnapshotHistory } from "@/services/snapshotService";
import { isMockTenant } from "@/lib/mockData";
import type {
    CapturedSavingsSummary,
    CapturedSavingsPoint,
    RemediationAuditItem,
} from "@/types/capturedSavings.types";
import { errorMessage } from '@/lib/apiErrors';
import { extractResourceDisplayName } from '@/lib/advisorI18n';
import { resolveRealizedCostDelta } from '@/services/azureHistoricalProgress.service';

const round2 = (n: number) => Math.round(Number(n) * 100) / 100;

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
     * Datos sinteticos por tier para tenants demo.
     *
     * Coherencia con el camino vivo:
     *  - `realizedSavingsUSD` de cada mes = suma de los eventos de ese mes, no un
     *    porcentaje del desperdicio.
     *  - `potentialSavingsUSD` = desperdicio detectado - ahorro ya capturado.
     *  - El historial incluye eventos de los DOS origenes (plataforma y Azure).
     *  - Importes a escala de un tenant real de demo (cientos de USD/mes), no
     *    miles: antes el desperdicio partia de 1.600 USD/mes por tier.
     */
    static getMockCapturedSavings(tier: string = "Enterprise"): CapturedSavingsSummary {
        const normalizedTier = (tier || "Enterprise").toUpperCase();
        const multiplier =
            normalizedTier === "PROFESSIONAL" ? 0.4 : normalizedTier === "BUSINESS" ? 0.7 : 1.0;

        const now = new Date();
        const monthKey = (monthsAgo: number) => {
            const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
            return d.toISOString().slice(0, 7);
        };
        const daysAgoIso = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();

        const auditLog: RemediationAuditItem[] = [
            {
                id: "act-101",
                timestamp: daysAgoIso(2),
                executedBy: "mchavez@cscloudsolutions.com.ar",
                resourceName: "disk-zombie-prod-app01",
                resourceGroup: "rg-prod-compute-core",
                resourceType: "Microsoft.Compute/disks",
                actionCategory: "Purga de disco huerfano (unattached)",
                monthlySavingsUSD: round2(19.71 * multiplier),
                status: "SUCCESS",
                origin: "platform",
                savingsMeasured: true,
                details: "Disco Premium SSD P10 (128 GiB) desasociado por mas de 45 dias.",
            },
            {
                id: "azure-201",
                timestamp: daysAgoIso(4),
                executedBy: "Detectado en Azure (fuera de la plataforma)",
                resourceName: "bastion-lab-eastus",
                resourceGroup: "rg-network-lab",
                resourceType: "Microsoft.Network/bastionHosts",
                actionCategory: "Baja de recurso detectada en Azure",
                monthlySavingsUSD: round2(140.16 * multiplier),
                status: "SUCCESS",
                origin: "azure",
                savingsMeasured: true,
                details: "El recurso dejo de facturar hace 4 dias. Run-rate previo: 140,16 USD/mes.",
            },
            {
                id: "act-102",
                timestamp: daysAgoIso(6),
                executedBy: "cloudops@cscloudsolutions.com.ar",
                resourceName: "vm-dev-batch-underutilized",
                resourceGroup: "rg-dev-batch",
                resourceType: "Microsoft.Compute/virtualMachines",
                actionCategory: "Rightsizing (Standard_D4s_v5 -> Standard_D2s_v5)",
                monthlySavingsUSD: round2(72.0 * multiplier),
                status: "SUCCESS",
                origin: "platform",
                savingsMeasured: true,
                details: "Optimizacion de vCPUs segun telemetria de Azure Monitor (CPU P95 < 15%).",
            },
            {
                id: "azure-202",
                timestamp: daysAgoIso(11),
                executedBy: "Detectado en Azure (fuera de la plataforma)",
                resourceName: "sql-reporting-legacy",
                resourceGroup: "rg-data-legacy",
                resourceType: "Microsoft.Sql/databases",
                actionCategory: "Reduccion de consumo detectada en Azure",
                monthlySavingsUSD: round2(58.4 * multiplier),
                status: "SUCCESS",
                origin: "azure",
                savingsMeasured: true,
                details: "Run-rate mensual de 121,90 a 63,50 USD segun costo facturado (cambio de tier).",
            },
            {
                id: "act-103",
                timestamp: daysAgoIso(15),
                executedBy: "automation.runbook@cscloudsolutions.com.ar",
                resourceName: "vm-qa-environment-nightly",
                resourceGroup: "rg-qa-envs",
                resourceType: "Microsoft.Compute/virtualMachines",
                actionCategory: "Auto-shutdown nocturno (19:00 - 07:00)",
                monthlySavingsUSD: round2(41.5 * multiplier),
                status: "SUCCESS",
                origin: "platform",
                savingsMeasured: true,
                details: "Apagado programado fuera de horario laboral, lunes a viernes.",
            },
            {
                id: "act-104",
                timestamp: daysAgoIso(19),
                executedBy: "mchavez@cscloudsolutions.com.ar",
                resourceName: "pip-unassociated-loadbalancer",
                resourceGroup: "rg-shared-network-hub",
                resourceType: "Microsoft.Network/publicIPAddresses",
                actionCategory: "Liberacion de IP publica huerfana",
                monthlySavingsUSD: round2(3.65 * multiplier),
                status: "SUCCESS",
                origin: "platform",
                savingsMeasured: true,
                details: "IP publica estatica sin asociar a ninguna NIC ni Load Balancer.",
            },
            {
                id: "azure-203",
                timestamp: daysAgoIso(26),
                executedBy: "Detectado en Azure (fuera de la plataforma)",
                resourceName: "st-abandoned-backups-2025",
                resourceGroup: "rg-backups-legacy",
                resourceType: "Microsoft.Storage/storageAccounts",
                actionCategory: "Reduccion de consumo detectada en Azure",
                monthlySavingsUSD: round2(24.9 * multiplier),
                status: "SUCCESS",
                origin: "azure",
                savingsMeasured: true,
                details: "Transicion de 4,2 TB a Archive aplicada por politica de ciclo de vida.",
            },
            {
                id: "act-105",
                timestamp: daysAgoIso(33),
                executedBy: "cloudops@cscloudsolutions.com.ar",
                resourceName: "sql-elastic-pool-dev-oversized",
                resourceGroup: "rg-dev-data",
                resourceType: "Microsoft.Sql/servers/elasticPools",
                actionCategory: "Ajuste de capacidad vCore (8 -> 4)",
                monthlySavingsUSD: round2(96.0 * multiplier),
                status: "SUCCESS",
                origin: "platform",
                savingsMeasured: true,
                details: "Reduccion de vCores en pool elastico con baja utilizacion concurrente.",
            },
            {
                id: "act-106",
                timestamp: daysAgoIso(38),
                executedBy: "cloudops@cscloudsolutions.com.ar",
                resourceName: "aks-sandbox-nodepool",
                resourceGroup: "rg-sandbox",
                resourceType: "Microsoft.ContainerService/managedClusters",
                actionCategory: "Escalado a cero del nodepool de sandbox",
                monthlySavingsUSD: 0,
                status: "FAILED",
                origin: "platform",
                savingsMeasured: false,
                details: "La accion fallo: el nodepool tenia un PodDisruptionBudget activo.",
            },
        ];

        // Ahorro capturado por mes, derivado de los eventos (no un % del desperdicio).
        const realizedByMonth = new Map<string, number>();
        for (const ev of auditLog) {
            if (ev.status !== "SUCCESS" || ev.monthlySavingsUSD <= 0) continue;
            const m = ev.timestamp.slice(0, 7);
            realizedByMonth.set(m, round2((realizedByMonth.get(m) || 0) + ev.monthlySavingsUSD));
        }

        // Desperdicio detectado: escala de cientos de USD/mes, con tendencia a la
        // baja a medida que se captura ahorro.
        const trend: CapturedSavingsPoint[] = [];
        for (let i = 11; i >= 0; i--) {
            const month = monthKey(i);
            const decay = 1 - (11 - i) * 0.035;
            const detectedWaste = round2(620 * multiplier * decay);
            const realized = realizedByMonth.get(month) || 0;
            trend.push({
                date: month,
                detectedWasteUSD: detectedWaste,
                potentialSavingsUSD: round2(Math.max(0, detectedWaste - realized)),
                realizedSavingsUSD: realized,
            });
        }

        const latest = trend[trend.length - 1];
        const previous = trend[trend.length - 2];
        const changePct = previous && previous.potentialSavingsUSD > 0
            ? Number((((latest.potentialSavingsUSD - previous.potentialSavingsUSD) / previous.potentialSavingsUSD) * 100).toFixed(1))
            : 0;

        return {
            currentPotentialSavingsUSD: latest.potentialSavingsUSD,
            currentDetectedWasteUSD: latest.detectedWasteUSD,
            currentRealizedSavingsUSD: realizedByMonth.get(now.toISOString().slice(0, 7)) || 0,
            // Antes era el literal 16 sin relacion con el historial devuelto.
            totalHistoricalSnapshots: trend.length,
            changePercentageVsLast: changePct,
            lastScanDate: now.toISOString().slice(0, 10),
            latestScanEmpty: false,
            trend,
            auditLog,
        };
    }

    /**
     * Eventos de ahorro originados FUERA de la plataforma, detectados sobre el
     * costo real de `CostSnapshots`.
     *
     * Motivo (bug reportado): el historial solo leia `ActionLogs`, es decir lo
     * ejecutado desde este portal. Si alguien borra un disco desde el portal de
     * Azure, apaga una VM por CLI o el equipo de plataforma achica un SKU por
     * IaC, el ahorro es real pero era invisible aca.
     *
     * Deteccion: por recurso, se compara el run-rate mensual de la ventana previa
     * con el de la ventana posterior. Si el recurso facturaba y dejo de facturar
     * (o bajo su run-rate) y lleva al menos `MIN_DAYS_STOPPED` dias asi, se emite
     * un evento con el delta medido como ahorro mensual.
     *
     * Limitacion consciente: `CostSnapshots` dice QUE dejo de costar, no QUIEN lo
     * hizo. La atribucion por usuario requiere leer el Activity Log de Azure
     * (`Microsoft.Insights/eventtypes/values/read`, incluido en Reader) — queda
     * como mejora, el ahorro ya se contabiliza correcto sin eso.
     */
    private static async detectAzureOriginatedSavings(
        tenantId: string
    ): Promise<RemediationAuditItem[]> {
        const MIN_DAYS_STOPPED = 7;
        const MIN_MONTHLY_USD = 1;
        try {
            const [rows]: any = await pool.query(
                `SELECT
                    ResourceId AS resourceId,
                    MAX(DATE(COALESCE(ChargePeriodStart, date))) AS lastChargeDate,
                    SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
                             AND DATE(COALESCE(ChargePeriodStart, date)) < DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                             THEN COALESCE(EffectiveCost, BilledCost, cost_usd, 0) ELSE 0 END) AS costPrev60d,
                    SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                             THEN COALESCE(EffectiveCost, BilledCost, cost_usd, 0) ELSE 0 END) AS costLast30d,
                    MAX(COALESCE(service_name, '')) AS serviceName
                 FROM CostSnapshots
                 WHERE tenant_id = ?
                   AND ResourceId IS NOT NULL AND ResourceId <> ''
                   AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
                 GROUP BY ResourceId
                 HAVING costPrev60d > 0
                 ORDER BY costPrev60d DESC
                 LIMIT 200`,
                [tenantId]
            );

            const today = new Date();
            const events: RemediationAuditItem[] = [];

            for (const row of rows || []) {
                // Run-rate mensual antes (ventana de 60 dias) y despues (30 dias).
                const runRateBefore = Number(row.costPrev60d || 0) / 2;
                const runRateAfter = Number(row.costLast30d || 0);
                const delta = runRateBefore - runRateAfter;
                if (delta < MIN_MONTHLY_USD) continue;

                const lastCharge = row.lastChargeDate ? new Date(row.lastChargeDate) : null;
                const daysSinceLastCharge = lastCharge
                    ? Math.floor((today.getTime() - lastCharge.getTime()) / 86400000)
                    : 0;

                const stopped = runRateAfter === 0;
                // Un recurso que sigue facturando pero mas barato es un downsize;
                // uno que dejo de facturar necesita margen temporal para no
                // confundir un retraso de facturacion con una baja.
                if (stopped && daysSinceLastCharge < MIN_DAYS_STOPPED) continue;

                const parsed = extractResourceDisplayName(String(row.resourceId));
                events.push({
                    id: `azure-${Buffer.from(String(row.resourceId)).toString("base64").slice(0, 24)}`,
                    timestamp: (lastCharge || today).toISOString(),
                    executedBy: "Detectado en Azure (fuera de la plataforma)",
                    resourceName: parsed.name !== "—" ? parsed.name : String(row.resourceId),
                    resourceGroup: parsed.resourceGroup || "",
                    resourceType: parsed.resourceType || String(row.serviceName || ""),
                    actionCategory: stopped
                        ? "Baja de recurso detectada en Azure"
                        : "Reduccion de consumo detectada en Azure",
                    monthlySavingsUSD: round2(delta),
                    status: "SUCCESS",
                    origin: "azure",
                    savingsMeasured: true,
                    details: stopped
                        ? `El recurso dejo de facturar el ${String(row.lastChargeDate).slice(0, 10)} (hace ${daysSinceLastCharge} dias). Run-rate previo: ${round2(runRateBefore)} USD/mes.`
                        : `Run-rate mensual de ${round2(runRateBefore)} a ${round2(runRateAfter)} USD segun costo facturado.`,
                });
            }
            return events;
        } catch (e) {
            console.warn("[AzureCapturedSavingsService] deteccion de ahorro en Azure fallo:", errorMessage(e));
            return [];
        }
    }

    /**
     * Eventos ejecutados desde la plataforma (`ActionLogs`), con el ahorro medido
     * contra el costo real del recurso en vez de los literales 45/110/75 que se
     * usaban por tipo de accion.
     */
    private static async getPlatformRemediationEvents(
        tenantId: string
    ): Promise<RemediationAuditItem[]> {
        try {
            const [rows]: any = await pool.query(
                `SELECT id, user_email, action_type, resource_id, resource_type, status, details, timestamp
                 FROM ActionLogs
                 WHERE tenant_id = ?
                 ORDER BY timestamp DESC
                 LIMIT 50`,
                [tenantId]
            );

            return await Promise.all(
                (rows || []).map(async (r: any) => {
                    const parsed = extractResourceDisplayName(r.resource_id);
                    const isSuccess = String(r.status || "").toUpperCase() === "SUCCESS";
                    const executedAt = r.timestamp ? new Date(r.timestamp) : new Date();
                    const eventDate = executedAt.toISOString().slice(0, 10);

                    // Ahorro medido: delta real de costo alrededor de la fecha de la
                    // accion. Si no hay historial del recurso, queda en 0 y se marca
                    // como no medido — nunca se inventa por tipo de accion.
                    let monthlySavingsUSD = 0;
                    let savingsMeasured = false;
                    if (isSuccess && r.resource_id) {
                        const delta = await resolveRealizedCostDelta(tenantId, r.resource_id, eventDate);
                        monthlySavingsUSD = round2(Math.max(0, delta.costBeforeUSD - delta.costAfterUSD));
                        savingsMeasured = delta.source === "cost_management";
                    }

                    return {
                        id: `act-${r.id}`,
                        timestamp: executedAt.toISOString(),
                        executedBy: r.user_email || "Automatizacion FinOps",
                        resourceName: parsed.name !== "—" ? parsed.name : "Recurso no especificado",
                        resourceGroup: parsed.resourceGroup || "",
                        resourceType: r.resource_type || parsed.resourceType || "",
                        actionCategory: r.action_type || "Optimizacion de recurso",
                        monthlySavingsUSD,
                        status: isSuccess ? ("SUCCESS" as const) : ("FAILED" as const),
                        origin: "platform" as const,
                        savingsMeasured,
                        details: r.details || `Accion ${r.action_type} ejecutada sobre ${parsed.name}.`,
                    } satisfies RemediationAuditItem;
                })
            );
        } catch (err) {
            console.warn("[AzureCapturedSavingsService] ActionLogs query warning:", errorMessage(err));
            return [];
        }
    }

    /**
     * Live queries: DailySnapshots (deteccion) + eventos de remediacion de ambos
     * origenes (plataforma y Azure) para el ahorro realmente capturado.
     */
    private static async fetchLiveCapturedSavings(
        tenantId: string
    ): Promise<CapturedSavingsSummary> {
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
        const startDateStr = twelveMonthsAgo.toISOString().slice(0, 10);

        let points: any[] = [];
        try {
            points = await getSnapshotHistory(tenantId, "dashboard_summary", startDateStr, undefined, "All");
        } catch (e) {
            console.warn(`[AzureCapturedSavingsService] getSnapshotHistory warning:`, errorMessage(e));
        }

        const [platformEvents, azureEvents] = await Promise.all([
            this.getPlatformRemediationEvents(tenantId),
            this.detectAzureOriginatedSavings(tenantId),
        ]);

        const auditLog = [...platformEvents, ...azureEvents].sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        // Ahorro capturado por mes: suma de eventos verificados de ese mes. Antes
        // se usaba `waste * 0.6`, un 60% inventado (de ahi que el grafico mostrara
        // exactamente 18 sobre 30).
        const realizedByMonth = new Map<string, number>();
        for (const ev of auditLog) {
            if (ev.status !== "SUCCESS" || ev.monthlySavingsUSD <= 0) continue;
            const month = ev.timestamp.slice(0, 7);
            realizedByMonth.set(month, round2((realizedByMonth.get(month) || 0) + ev.monthlySavingsUSD));
        }

        const trend: CapturedSavingsPoint[] = points.map((p) => {
            const detectedWaste = Number((p.payload as any)?.totalSavings) || 0;
            const realized = realizedByMonth.get(String(p.date).slice(0, 7)) || 0;
            return {
                date: p.date,
                detectedWasteUSD: round2(detectedWaste),
                // Oportunidad que sigue abierta: lo detectado menos lo ya capturado.
                // Antes `potentialSavings` era literalmente el mismo numero que
                // `detectedWaste`, asi que las dos series y los dos KPI eran iguales.
                potentialSavingsUSD: round2(Math.max(0, detectedWaste - realized)),
                realizedSavingsUSD: realized,
            };
        });

        // KPI sobre el ultimo escaneo CON DATOS: tomar el ultimo punto a ciegas
        // mostraba 0,00 en las tarjetas mientras el grafico mostraba el historico
        // real, porque el snapshot del dia todavia no tiene datos.
        const lastWithData = [...trend].reverse().find((p) => p.detectedWasteUSD > 0 || p.realizedSavingsUSD > 0);
        const latest = lastWithData || trend[trend.length - 1] || null;
        const latestScanEmpty = Boolean(trend.length > 0 && lastWithData && trend[trend.length - 1] !== lastWithData);

        const idxLatest = latest ? trend.indexOf(latest) : -1;
        const previous = idxLatest > 0 ? trend[idxLatest - 1] : null;
        const changePct =
            previous && previous.potentialSavingsUSD > 0 && latest
                ? Number(
                      (((latest.potentialSavingsUSD - previous.potentialSavingsUSD) / previous.potentialSavingsUSD) * 100).toFixed(1)
                  )
                : 0;

        const currentMonth = new Date().toISOString().slice(0, 7);

        return {
            currentPotentialSavingsUSD: latest ? latest.potentialSavingsUSD : 0,
            currentDetectedWasteUSD: latest ? latest.detectedWasteUSD : 0,
            currentRealizedSavingsUSD: realizedByMonth.get(currentMonth) || 0,
            totalHistoricalSnapshots: trend.length,
            changePercentageVsLast: changePct,
            lastScanDate: latest ? latest.date : undefined,
            latestScanEmpty,
            trend,
            auditLog,
        };
    }
}
