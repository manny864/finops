/**
 * GET /api/intelligence/cost-by-category — desglose jerárquico y resolutivo de costo por categoría FinOps
 * (Compute/Databases/Networking/Storage/AI & ML/Security/...).
 *
 * RBAC app: requireTenantAccess (tenant-scoped). Tier: Business (routeTiers).
 *
 * `getRealCategoryOverview` encadena el inventario completo de ARG con los
 * costos por recurso de Cost Management, que va suscripcion por suscripcion.
 * En frio pasa de los 100s que aguanta Cloudflare, asi que el browser se comia
 * un 524.
 *
 * El TTL duro NO es la ventana de frescura: es cuanto tiempo existe una entrada
 * que evita el camino sincronico. Con 1800 la entrada se vencia entera cada 30
 * min y el visitante siguiente volvia a pagar el calculo completo — de ahi el
 * 524 cada media hora. La frescura la maneja el TTL blando: pasados 10 min se
 * devuelve lo cacheado al instante y se revalida en background, donde tardar
 * dos minutos no molesta a nadie.
 *
 * Un payload degradado (`snapshot-fallback`, o vacio) se cachea 5 min en vez de
 * un dia, para no congelar numeros incompletos ante un 429 transitorio.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getRealCategoryOverview, getMockCategoryOverview } from "@/services/categoryConsumptionService";
import { isMockTenant } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import type { CategoryOverview } from "@/lib/categoryConsumptionTypes";

const DIA = 86400;
const DEGRADADO = 300;

/**
 * Un dia de TTL duro solo para el payload sano. Si Cost Management se degrado a
 * snapshot, 5 min: el proximo refresh reintenta en vez de congelar el numero.
 */
export function ttlPorCalidad(data: CategoryOverview): number {
    const degradado = data?.empty || data?.diagnostics?.source !== "live-cost-management";
    return degradado ? DEGRADADO : DIA;
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const days = Math.max(1, Math.min(365, parseInt(searchParams.get("days") || "30", 10)));

        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
        }

        // El tenant de demo entra SIN token, igual que `billing` y
        // `aks-chargeback`: /demo no deja una identidad de Entra, asi que
        // autenticar primero dejaba esta ruta inalcanzable y obligaba a que
        // `TenantProvider` interceptara el fetch con una copia del payload. Esa
        // copia traia `historical6Months` y `optimizationOpportunities` VACIOS
        // mientras el generador de aca los trae completos: en la demo, el
        // grafico de seis meses y la lista de oportunidades salian en blanco y
        // no fallaba nada (MEJ-03).
        //
        // Aca no hay dato real que exponer: `getMockCategoryOverview` es 100%
        // inventado, no toca la base ni Azure, y solo responde para los cuatro
        // tenants de demo que `isMockTenant` reconoce. Tampoco pasa por el
        // cache: es una funcion pura.
        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockCategoryOverview(tenantId));
        }

        try {
            await requireTenantAccess(request, tenantId);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        // `days` entra en la clave: cambia el rango de la consulta y con el
        // mismo key devolveria el desglose del rango anterior.
        const overview = await getWithStaleWhileRevalidate(
            `cost-by-category:v1:${tenantId}:${days}`,
            () => getRealCategoryOverview(tenantId, days),
            DIA,
            600,
            ttlPorCalidad
        );
        return NextResponse.json(overview);
    } catch (err: unknown) {
        console.error("[cost-by-category] handler error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
