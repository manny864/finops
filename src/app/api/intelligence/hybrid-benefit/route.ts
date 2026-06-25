import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { hasAccess } from "@/lib/tierLogic";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        const userTier = request.nextUrl.searchParams.get('tier') || 'Essential';

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        // Feature Gating
        if (!hasAccess(userTier, 'Professional')) {
            return NextResponse.json({ error: "Funcionalidad requiere plan Professional o superior." }, { status: 403 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
        }

        const email = decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "";
        const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

        if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: `Acceso denegado. El token no coincide con el tenant.` }, { status: 403 });
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('hybrid-benefit', tenantId));
        }

        // Real Data fetching using Cache and Azure Resource Graph (ARG)
        const cacheKey = `hybrid-benefit:${tenantId}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
            // Aquí iría el cliente de Azure Resource Graph
            // ARG Query: "Resources | where type =~ 'microsoft.compute/virtualmachines' | where properties.licenseType != 'Windows_Server'"
            // Retorna vacío por defecto si el SDK no está autenticado.
            return {
                totalPotentialSavings: 0,
                eligibleResources: []
            };
        }, 86400); // 24 hours TTL

        return NextResponse.json({ success: true, data });

    } catch (error: any) {
        console.error("Hybrid Benefit API Error:", error);
        return NextResponse.json({ error: "Fallo al generar el reporte de AHB", details: error.message }, { status: 500 });
    }
}
