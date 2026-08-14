import { NextRequest, NextResponse } from "next/server";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { sendWebhookAlert } from "@/lib/notifications";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { computeStats, runAnomalyDetection, persistAndNotifyAnomalies } from "@/services/anomalyDetectionService";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const tier = searchParams.get('tier') || 'Professional';
        const subscriptionId = searchParams.get('subscriptionId') || 'All';

        if (!tenantId) {
            return NextResponse.json({ error: "Tenant ID requerido" }, { status: 400 });
        }

        // Auth antes de cualquier branch (incl. mock), consistente con el resto de rutas.
        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        // ── MOCK ──────────────────────────────────────────────────────────────
        if (isMockTenant(tenantId)) {
            const today = new Date();
            // Días con picos de gasto simulados, repartidos en la ventana de 60 días
            // para poder mostrar anomalías en distintos estados (Open/Postponed/
            // Dismissed/Completed) en el demo.
            const spikeIndices = [59, 55, 47, 39, 30, 21, 12];
            const spikeSet = new Set(spikeIndices);
            const dailyCosts = Array.from({ length: 60 }).map((_, i) => {
                const date = new Date(today.getTime() - (59 - i) * 24 * 60 * 60 * 1000);
                const baseCost = 150 + Math.random() * 50;
                const spikeCost = 600 + Math.random() * 500;
                return { date: date.toISOString().split('T')[0], amount: spikeSet.has(i) ? spikeCost : baseCost };
            });
            const baseline = dailyCosts.filter((_, i) => !spikeSet.has(i)).slice(0, 40).map(d => d.amount);
            const { mean, stdDev } = computeStats(baseline);

            const STATUS_CYCLE = ['Open', 'Postponed', 'Dismissed', 'Completed', 'Completed', 'Open', 'Dismissed'];
            const SUBS = ['sub-prod-eastus', 'sub-dev-westeurope', 'sub-shared-services', 'sub-prod-brazilsouth'];
            // Causas plausibles para el demo — un servicio+RG por anomalía, con el
            // resto del delta repartido entre 1-2 contribuyentes menores.
            const MOCK_CAUSES: { service_name: string; resource_group: string }[] = [
                { service_name: 'Virtual Machines', resource_group: 'rg-prod-compute' },
                { service_name: 'Azure SQL Database', resource_group: 'rg-data-platform' },
                { service_name: 'Storage Accounts', resource_group: 'rg-shared-services' },
                { service_name: 'Azure Kubernetes Service', resource_group: 'rg-prod-aks' },
                { service_name: 'Bandwidth', resource_group: 'rg-networking' },
                { service_name: 'Azure OpenAI', resource_group: 'rg-ai-workloads' },
                { service_name: 'App Service', resource_group: 'rg-prod-web' },
            ];
            const anomalies = [...spikeIndices].sort((a, b) => b - a).map((idx, i) => {
                const d = dailyCosts[idx];
                const detectedAt = new Date(new Date(d.date).getTime() + 6 * 60 * 60 * 1000);
                const status = STATUS_CYCLE[i % STATUS_CYCLE.length];
                const resolvedAt = status !== 'Open'
                    ? new Date(detectedAt.getTime() + (4 + Math.random() * 36) * 60 * 60 * 1000)
                    : null;
                const totalDelta = Math.max(0, d.amount - mean);
                const primary = MOCK_CAUSES[i % MOCK_CAUSES.length];
                const secondary = MOCK_CAUSES[(i + 3) % MOCK_CAUSES.length];
                const primaryPct = 55 + Math.round(Math.random() * 20); // 55-75%
                const top_contributors = totalDelta > 0 ? [
                    {
                        resource_group: primary.resource_group,
                        service_name: primary.service_name,
                        cost: Number((mean * 0.3 + totalDelta * (primaryPct / 100)).toFixed(2)),
                        baseline_avg: Number((mean * 0.3).toFixed(2)),
                        delta: Number((totalDelta * (primaryPct / 100)).toFixed(2)),
                        delta_pct_of_total: primaryPct,
                    },
                    {
                        resource_group: secondary.resource_group,
                        service_name: secondary.service_name,
                        cost: Number((mean * 0.15 + totalDelta * ((100 - primaryPct) / 100)).toFixed(2)),
                        baseline_avg: Number((mean * 0.15).toFixed(2)),
                        delta: Number((totalDelta * ((100 - primaryPct) / 100)).toFixed(2)),
                        delta_pct_of_total: 100 - primaryPct,
                    },
                ] : [];
                return {
                    id: i + 1,
                    date: d.date,
                    amount: d.amount,
                    expected_amount: mean,
                    z_score: stdDev > 0 ? (d.amount - mean) / stdDev : 0,
                    status,
                    subscription_id: SUBS[i % SUBS.length],
                    detected_at: detectedAt.toISOString(),
                    resolved_at: resolvedAt ? resolvedAt.toISOString() : null,
                    top_contributors,
                };
            });
            if (anomalies.length > 0) {
                const dashboardUrl = `${request.nextUrl.origin}/intelligence/anomalies`;
                await sendWebhookAlert(tenantId,
                    "🚨 Anomalía de Gasto Detectada (Z-Score Alert)",
                    `Gasto anormal de **$${anomalies[0].amount.toFixed(2)}** en *${subscriptionId}*. Promedio esperado: $${mean.toFixed(2)}.\n\n<a href="${dashboardUrl}">🔍 Investigar</a>`,
                    'warning'
                ).catch(() => {});
            }
            return NextResponse.json({ success: true, dailyCosts, anomalies, mean, stdDev });
        }

        // ── REAL TENANT ───────────────────────────────────────────────────────
        const [tierRows] = await pool.query(
            "SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1",
            [tenantId]
        );
        if (!Array.isArray(tierRows) || tierRows.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }

        const resolvedTier = String((tierRows[0] as { tier?: string }).tier || tier);
        const isPro = ["professional", "business", "enterprise"].includes(resolvedTier.toLowerCase());
        if (!isPro) {
            return NextResponse.json({
                success: true, dailyCosts: [], anomalies: [],
                message: "La detección de anomalías requiere Tier Professional o superior."
            });
        }

        // Motor de detección compartido con /api/cron/anomaly-detection (que
        // corre cada 5 min aunque nadie abra esta página — ver
        // src/services/anomalyDetectionService.ts). Acá solo se agrega la
        // persistencia/notificación (dedup por notified_at) sobre lo detectado
        // en esta consulta puntual, para no reenviar el mismo aviso si el
        // usuario recarga la página varias veces mientras la anomalía sigue
        // dentro de la ventana de 30 días.
        const { dailyCosts, anomalies: rawAnomalies, mean, stdDev, message } = await runAnomalyDetection(tenantId, subscriptionId);

        // enrichedAnomalies trae top_contributors (atribución de causa raíz,
        // ver getAnomalyTopContributors) ya calculado por persistAndNotifyAnomalies
        // — si esa llamada falla (DB caída, etc.) se degrada a rawAnomalies sin
        // contribuyentes en vez de romper la página.
        let enrichedAnomalies: (typeof rawAnomalies[number] & { top_contributors?: import("@/services/anomalyDetectionService").AnomalyContributor[] })[] = rawAnomalies;
        if (rawAnomalies.length > 0) {
            const dashboardUrl = `${request.nextUrl.origin}/intelligence/anomalies`;
            try {
                const result = await persistAndNotifyAnomalies(tenantId, rawAnomalies, dashboardUrl);
                enrichedAnomalies = result.anomalies;
            } catch (e: any) {
                console.warn("[anomalies] persistAndNotifyAnomalies failed:", e?.message);
            }
        }

        const anomalies = enrichedAnomalies.map((a, i) => ({
            id: i + 1,
            ...a,
            status: 'Open' as const,
            detected_at: new Date().toISOString(),
        }));

        return NextResponse.json({ success: true, dailyCosts, anomalies, mean, stdDev, ...(message ? { message } : {}) });

    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("Anomaly Detection API Error:", error);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

