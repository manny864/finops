import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantAccess, requireTenantRole, AuthError } from "@/lib/requestAuth";
import { exigirSuscripcionDelTenant } from "@/lib/scopeDelTenant";
import { getDiscoveredCostCenterTags } from "@/services/budgetService";
import { getBudgetsUtilization, budgetsCacheKey } from "@/services/budgetUtilization.service";
// RBAC: GET requiere pertenencia al tenant (read). POST (crear/actualizar budget)
// requiere rol Admin/Owner — es un control de gobernanza financiera.
import { invalidateCachePattern } from "@/lib/cache";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const subscriptionId = url.searchParams.get("subscriptionId") || "All";
        
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);
        await exigirSuscripcionDelTenant(tenantId, subscriptionId);

        // El gasto de cada presupuesto sale de Cost Management (con caché SWR): la lógica y la clave viven en el servicio
        // porque el MCP y el feed de Power BI leen la misma caché.
        const { budgets: budgetsWithUtilization } = await getBudgetsUtilization(tenantId, subscriptionId);

        const suggestedCostCenters = await getDiscoveredCostCenterTags(tenantId);

        return NextResponse.json({
            budgets: budgetsWithUtilization,
            suggestedCostCenters,
        });

    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[budgets] GET error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, costCenter, monthlyLimit, alertThreshold = 80.00 } = body;

        if (!tenantId || !costCenter || monthlyLimit === undefined) {
            return NextResponse.json({ error: "Parámetros incompletos" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        await pool.query(
            `INSERT INTO Budgets (tenant_id, cost_center_tag_value, monthly_limit_usd, alert_threshold) 
             VALUES (?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE monthly_limit_usd = ?, alert_threshold = ?`,
            [tenantId, costCenter, monthlyLimit, alertThreshold, monthlyLimit, alertThreshold]
        );

        await invalidateCachePattern(budgetsCacheKey(tenantId, "*"));

        return NextResponse.json({ success: true, message: "Presupuesto guardado" });

    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[budgets] POST error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, id, costCenter, monthlyLimit, alertThreshold = 80.0 } = body;

        if (!tenantId || !id || !costCenter || monthlyLimit === undefined) {
            return NextResponse.json({ error: "Parámetros incompletos" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        await pool.query(
            `UPDATE Budgets
             SET cost_center_tag_value = ?, monthly_limit_usd = ?, alert_threshold = ?
             WHERE id = ? AND tenant_id = ?`,
            [costCenter, monthlyLimit, alertThreshold, id, tenantId]
        );

        await invalidateCachePattern(budgetsCacheKey(tenantId, "*"));
        return NextResponse.json({ success: true, message: "Presupuesto actualizado" });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[budgets] PUT error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, id } = body;

        if (!tenantId || !id) {
            return NextResponse.json({ error: "Parámetros incompletos" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        await pool.query(
            "DELETE FROM Budgets WHERE id = ? AND tenant_id = ?",
            [id, tenantId]
        );

        await invalidateCachePattern(budgetsCacheKey(tenantId, "*"));
        return NextResponse.json({ success: true, message: "Presupuesto eliminado" });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[budgets] DELETE error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
