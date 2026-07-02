import { NextRequest, NextResponse } from "next/server";
import { getNativeBudgets } from "@/services/budgetService";
import { recordDailySnapshotAsync } from "@/services/snapshotService";
import { isMockTenant } from "@/lib/mockData";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
// RBAC: lectura de burn de presupuestos requiere pertenencia al tenant (JWT validado).

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const subscriptionId = url.searchParams.get("subscriptionId");
        
        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan tenantId o subscriptionId." }, { status: 400 });
        }

        // Valida el token JWT y que el caller pertenezca al tenant (evita IDOR cross-tenant).
        await requireTenantAccess(request, tenantId);

        const subIds = subscriptionId.split(',').map(s => s.trim()).filter(s => s.length > 0);
        
        const promises = subIds.map(subId => getNativeBudgets(tenantId, subId));
        const results = await Promise.all(promises);
        
        // Flatten array if there are multiple subscriptions
        const burnData = results.flat();

        // Write-through de historial diario (best-effort, solo tenants reales).
        if (!isMockTenant(tenantId) && burnData.length > 0) {
            const totalBudget = burnData.reduce((s: number, b: { budget?: number }) => s + Number(b.budget || 0), 0);
            const totalActual = burnData.reduce((s: number, b: { actual?: number }) => s + Number(b.actual || 0), 0);
            recordDailySnapshotAsync(tenantId, 'budgets', {
                totalBudget: Number(totalBudget.toFixed(2)),
                totalActual: Number(totalActual.toFixed(2)),
                budgetsCount: burnData.length,
            }, subscriptionId);
        }

        return NextResponse.json({ burnData });

    } catch (e: any) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}
