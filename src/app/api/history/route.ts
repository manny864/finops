import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockSnapshotHistory } from "@/lib/mockData";
import { getSnapshotHistory, getSnapshotRange, getSnapshotDomains, SNAPSHOT_RETENTION_DAYS } from "@/services/snapshotService";

/**
 * GET /api/history — Historial diario genérico ("de todo") con retención >= 1 año.
 *
 * Query params:
 *   - tenantId (requerido)   tenant a consultar
 *   - domain   (requerido)   dominio/página (ej: dashboard_summary, commitments, rightsizing...)
 *   - from, to (opcional)    rango YYYY-MM-DD. Default: último año hasta hoy.
 *   - scope    (opcional)    subscription_scope (default: todos)
 *   - tier     (opcional)    solo para tenants demo/mock (riqueza de la serie simulada)
 *
 * RBAC: requireTenantAccess (lectura tenant-scoped). Previene IDOR (regla local/no-unauth-tenant-id).
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId") || "";
        const domain = searchParams.get("domain") || "";

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        if (!domain) return NextResponse.json({ error: "Falta domain" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        // Rango por defecto: último año (>= 1 año de historial).
        const today = new Date();
        const defTo = today.toISOString().slice(0, 10);
        const defFrom = new Date(today.getTime() - 365 * 86400000).toISOString().slice(0, 10);
        const from = searchParams.get("from") || defFrom;
        const to = searchParams.get("to") || defTo;
        const scope = searchParams.get("scope") || undefined;

        // Tenants demo/mock: serie simulada por tier (directiva de mocks por tier).
        if (isMockTenant(tenantId)) {
            const tier = searchParams.get("tier") || "business";
            const series = getMockSnapshotHistory(domain, tier, from, to);
            return NextResponse.json({
                domain,
                mock: true,
                retentionDays: SNAPSHOT_RETENTION_DAYS,
                range: { min: series[0]?.date ?? null, max: series[series.length - 1]?.date ?? null, count: series.length },
                series,
            });
        }

        const [series, range, domains] = await Promise.all([
            getSnapshotHistory(tenantId, domain, from, to, scope),
            getSnapshotRange(tenantId, domain),
            getSnapshotDomains(tenantId),
        ]);

        return NextResponse.json({
            domain,
            retentionDays: SNAPSHOT_RETENTION_DAYS,
            range,
            availableDomains: domains,
            series,
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("[/api/history] Error:", error);
        const message = error instanceof Error ? error.message : "Internal server error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
