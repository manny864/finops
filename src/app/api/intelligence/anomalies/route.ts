import { NextRequest, NextResponse } from "next/server";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { sendWebhookAlert } from "@/lib/notifications";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const tier = searchParams.get('tier') || 'Essential';
        const subscriptionId = searchParams.get('subscriptionId') || 'sub-default-01';

        if (!tenantId) {
            return NextResponse.json({ error: "Tenant ID requerido" }, { status: 400 });
        }

        // Mock Logic: Generate 60 days of data and inject an anomaly on the last day
        if (isMockTenant(tenantId)) {
            const today = new Date();
            const dailyCosts = Array.from({ length: 60 }).map((_, i) => {
                const date = new Date(today.getTime() - (59 - i) * 24 * 60 * 60 * 1000);
                const isAnomaly = i === 59; // Today is an anomaly
                const baseCost = 150 + Math.random() * 50; 
                return {
                    date: date.toISOString().split('T')[0],
                    amount: isAnomaly ? 850.45 : baseCost // Massive spike today
                };
            });

            // Z-Score Calculation (Simple Moving Average)
            const historicalData = dailyCosts.slice(0, 59);
            const sum = historicalData.reduce((acc, curr) => acc + curr.amount, 0);
            const mean = sum / historicalData.length;
            
            const variance = historicalData.reduce((acc, curr) => acc + Math.pow(curr.amount - mean, 2), 0) / historicalData.length;
            const stdDev = Math.sqrt(variance);

            const todayCost = dailyCosts[59].amount;
            const zScore = (todayCost - mean) / stdDev;

            const anomalies = [];
            
            if (zScore > 3) {
                const anomaly = {
                    id: 1,
                    date: dailyCosts[59].date,
                    amount: todayCost,
                    expected_amount: mean,
                    z_score: zScore,
                    status: 'New',
                    subscription_id: subscriptionId,
                    detected_at: new Date().toISOString()
                };
                anomalies.push(anomaly);
                
                // Simulate sending a webhook alert for the mock anomaly
                const dashboardUrl = `${request.nextUrl.origin}/intelligence/anomalies`;
                await sendWebhookAlert(
                    tenantId, 
                    "🚨 Anomalía de Gasto Detectada (Z-Score Alert)", 
                    `Se ha detectado un gasto anormal de **$${todayCost.toFixed(2)}** en la suscripción *${subscriptionId}*. (Gasto promedio esperado: $${mean.toFixed(2)}).\n\n<a href="${dashboardUrl}">🔍 Investigar en el Dashboard</a>`,
                    'warning'
                );
            }

            return NextResponse.json({ success: true, dailyCosts, anomalies, mean, stdDev });
        }

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        const [tierRows] = await pool.query(
            "SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1",
            [tenantId]
        );
        if (!Array.isArray(tierRows) || tierRows.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }

        const resolvedTier = String((tierRows[0] as { tier?: string }).tier || tier || "Essential");
        const isProfessionalOrHigher = ["professional", "business", "enterprise"].includes(resolvedTier.toLowerCase());
        if (!isProfessionalOrHigher) {
            return NextResponse.json({
                success: true,
                dailyCosts: [],
                anomalies: [],
                message: "La detección de anomalías requiere Tier Professional o superior."
            });
        }

        // For real tenants, we would fetch from Cost Management and save to DB
        // But for this environment, we return an empty state
        return NextResponse.json({ 
            success: true, 
            dailyCosts: [], 
            anomalies: [],
            message: "Conecte su cuenta de Azure para iniciar el aprendizaje automático."
        });

    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("Anomaly Detection API Error:", error);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
