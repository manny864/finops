import { NextRequest, NextResponse } from "next/server";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { sendWebhookAlert } from "@/lib/notifications";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { recordDailySnapshotAsync } from "@/services/snapshotService";

// ── Z-Score helpers ─────────────────────────────────────────────────────────
function computeStats(values: number[]): { mean: number; stdDev: number } {
    if (values.length === 0) return { mean: 0, stdDev: 0 };
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
    return { mean, stdDev: Math.sqrt(variance) };
}

function detectAnomalies(
    dailyCosts: { date: string; amount: number }[],
    mean: number,
    stdDev: number,
    subscriptionId: string,
    threshold = 2.5
) {
    if (stdDev === 0) return [];
    return dailyCosts
        .filter(d => {
            const z = (d.amount - mean) / stdDev;
            return z > threshold;
        })
        .map((d, i) => ({
            id: i + 1,
            date: d.date,
            amount: d.amount,
            expected_amount: mean,
            z_score: (d.amount - mean) / stdDev,
            status: 'New',
            subscription_id: subscriptionId,
            detected_at: new Date().toISOString()
        }));
}

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
            const dailyCosts = Array.from({ length: 60 }).map((_, i) => {
                const date = new Date(today.getTime() - (59 - i) * 24 * 60 * 60 * 1000);
                const isAnomaly = i === 59;
                const baseCost = 150 + Math.random() * 50;
                return { date: date.toISOString().split('T')[0], amount: isAnomaly ? 850.45 : baseCost };
            });
            const baseline = dailyCosts.slice(0, 52).map(d => d.amount);
            const { mean, stdDev } = computeStats(baseline);
            const anomalies = detectAnomalies(dailyCosts.slice(52), mean, stdDev, subscriptionId, 3);
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

        // ── Obtener costos diarios desde CostSnapshots (últimos 60 días) ─────
        // Filtramos por subscripción si se especificó
        const subFilter = subscriptionId && subscriptionId !== 'All'
            ? `AND LOWER(subscription_id) IN (${subscriptionId.split(',').map(() => '?').join(',')})`
            : '';
        const subParams: string[] = subscriptionId !== 'All'
            ? subscriptionId.split(',').map(s => s.trim().toLowerCase())
            : [];

        const query = `
            SELECT
                DATE(COALESCE(ChargePeriodStart, date)) AS day_date,
                SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS daily_total
            FROM CostSnapshots
            WHERE tenant_id = ?
              AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
              ${subFilter}
            GROUP BY day_date
            ORDER BY day_date ASC
        `;

        const [costRows] = await pool.query(query, [tenantId, ...subParams]);
        const rows = Array.isArray(costRows) ? costRows as any[] : [];

        if (rows.length < 7) {
            return NextResponse.json({
                success: true,
                dailyCosts: [],
                anomalies: [],
                mean: 0,
                stdDev: 0,
                message: `Historial insuficiente (${rows.length} días). Se requieren al menos 7 días de datos en CostSnapshots.`
            });
        }

        // Construir serie ordenada de 60 días rellenando días sin datos con 0
        const costMap = new Map<string, number>();
        rows.forEach(r => {
            const d = r.day_date instanceof Date
                ? r.day_date.toISOString().split('T')[0]
                : String(r.day_date).split('T')[0];
            costMap.set(d, Number(r.daily_total) || 0);
        });

        const dailyCosts: { date: string; amount: number }[] = [];
        for (let i = 59; i >= 0; i--) {
            const dt = new Date();
            dt.setDate(dt.getDate() - i);
            const ds = dt.toISOString().split('T')[0];
            dailyCosts.push({ date: ds, amount: costMap.get(ds) ?? 0 });
        }

        // Baseline: todo excepto los últimos 7 días
        const baseline = dailyCosts.slice(0, dailyCosts.length - 7).map(d => d.amount).filter(v => v > 0);
        if (baseline.length < 7) {
            return NextResponse.json({
                success: true, dailyCosts, anomalies: [], mean: 0, stdDev: 0,
                message: "Baseline insuficiente para calcular Z-Score."
            });
        }

        const { mean, stdDev } = computeStats(baseline);
        const recentWindow = dailyCosts.slice(-14); // Detectar en los últimos 14 días
        const anomalies = detectAnomalies(recentWindow, mean, stdDev, subscriptionId, 2.5);

        // Enviar webhook si hay anomalías nuevas
        for (const anomaly of anomalies.slice(0, 3)) {
            const dashboardUrl = `${request.nextUrl.origin}/intelligence/anomalies`;
            await sendWebhookAlert(tenantId,
                "🚨 Anomalía de Gasto Detectada",
                `Gasto anormal de **$${anomaly.amount.toFixed(2)}** el ${anomaly.date} (sub: *${subscriptionId}*). Promedio esperado: $${mean.toFixed(2)} | Z-Score: ${anomaly.z_score.toFixed(2)}.\n\n<a href="${dashboardUrl}">🔍 Investigar</a>`,
                'warning'
            ).catch(() => {});
        }

        // Write-through de historial diario (best-effort, solo tenants reales con datos).
        recordDailySnapshotAsync(tenantId, 'anomalies', {
            anomaliesCount: anomalies.length,
            mean: Number(mean.toFixed(2)),
            stdDev: Number(stdDev.toFixed(2)),
        }, subscriptionId);

        return NextResponse.json({ success: true, dailyCosts, anomalies, mean, stdDev });

    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("Anomaly Detection API Error:", error);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

