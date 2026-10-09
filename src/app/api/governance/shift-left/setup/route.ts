/**
 * GET /api/governance/shift-left/setup — lo que el cliente copia a su pipeline para
 * activar Shift-Left (MEJ-20): un workflow listo para GitHub, Azure DevOps o GitLab, con
 * la URL de esta plataforma y el SHA-256 del script ya puestos.
 *
 * No hay una Action publicada de la que colgarse, así que el snippet descarga el script
 * (`public/integrations/shift-left/finops-estimate.sh`) y verifica su hash antes de
 * ejecutarlo. El hash se calcula acá leyendo el archivo: no se copia a mano en ningún lado.
 *
 * `?tool=terraform|tofu|bicep` elige cómo se genera el plan. Tier Enterprise y acceso al
 * tenant, igual que el resto del módulo; el tenant de demo lo ve sin sesión.
 */
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantAccess, requireTenantTier } from "@/lib/requestAuth";
import { errorMessage, errorStatus, serverError } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";
import { urlPublica } from "@/lib/urlPublica";
import { HERRAMIENTAS, RUTA_SCRIPT, sha256DelScript, snippets, type Herramienta } from "@/lib/shiftLeftSetup";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const tool = (request.nextUrl.searchParams.get("tool") || "terraform") as Herramienta;
        if (!HERRAMIENTAS.includes(tool)) {
            return NextResponse.json({ error: `tool tiene que ser ${HERRAMIENTAS.join(", ")}` }, { status: 400 });
        }

        if (!isMockTenant(tenantId)) {
            await requireTenantAccess(request, tenantId);
            await requireTenantTier(request, tenantId, "Enterprise");
        }

        const apiUrl = urlPublica(request);
        const sha256 = sha256DelScript();
        return NextResponse.json({
            apiUrl,
            scriptUrl: `${apiUrl}${RUTA_SCRIPT}`,
            sha256,
            tool,
            snippets: snippets({ apiUrl, sha256, tool }),
        });
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        }
        console.error("[/api/governance/shift-left/setup]", errorMessage(e));
        return serverError(e);
    }
}
