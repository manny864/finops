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
        const tier = searchParams.get('tier') || 'Essential';
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
            const anomalies = [...spikeIndices].sort((a, b) => b - a).map((idx, i) => {
                const d = dailyCosts[idx];
                const detectedAt = new Date(new Date(d.date).getTime() + 6 * 60 * 60 * 1000);
                const status = STATUS_CYCLE[i % STATUS_CYCLE.length];
                const resolvedAt = status !== 'Open'
                    ? new Date(detectedAt.getTime() + (4 + Math.random() * 36) * 60 * 60 * 1000)
                    : null;
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

        if (rawAnomalies.length > 0) {
            const dashboardUrl = `${request.nextUrl.origin}/intelligence/anomalies`;
            await persistAndNotifyAnomalies(tenantId, rawAnomalies, dashboardUrl).catch((e) => {
                console.warn("[anomalies] persistAndNotifyAnomalies failed:", e?.message);
            });
        }

        const anomalies = rawAnomalies.map((a, i) => ({
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

