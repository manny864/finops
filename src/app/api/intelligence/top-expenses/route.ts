/**
 * GET /api/intelligence/top-expenses — "TOP Gastos": top N por costo
 * en 4 dimensiones: Cost Groups, Suscripciones, Grupos de Recursos y Recursos.
 *
 * Disponible para todos los tiers (sin gate de plan).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { generateMockTopSpend, getLiveTopSpend, type TopSpendTimeframe } from "@/services/azureTopSpend.service";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const timeframeParam = url.searchParams.get("timeframe") as TopSpendTimeframe;
        const timeframe: TopSpendTimeframe = timeframeParam === "mtd" ? "mtd" : "30d";
        const limitParam = parseInt(url.searchParams.get("limit") || "5", 10);
        const limit = [3, 5, 10].includes(limitParam) ? limitParam : 5;

        if (!tenantId) {
            return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        }

        // 1. Check isMockTenant PRIMERO antes de requerir JWT OAuth
        if (isMockTenant(tenantId) || url.searchParams.get("mock") === "true") {
            const mockSummary = generateMockTopSpend("Professional", timeframe, limit);
            return NextResponse.json({
                success: true,
                mock: true,
                ...mockSummary,
            });
        }

        // 2. Tenant conectado: RBAC obligatorio
        await requireTenantAccess(request, tenantId);

        // 3. Live query a base de datos (cero fallbacks sintéticos en tenants reales)
        const summary = await getLiveTopSpend(tenantId, timeframe, limit);

        return NextResponse.json({
            success: true,
            mock: false,
            ...summary,
        });
    } catch (e: unknown) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        console.error("[top-expenses] GET error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
