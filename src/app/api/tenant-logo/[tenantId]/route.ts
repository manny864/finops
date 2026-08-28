import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { readTenantLogo, mimeForExt } from "@/lib/tenantLogo";
import { errorMessage } from "@/lib/apiErrors";

/**
 * GET /api/tenant-logo/[tenantId]
 *
 * Sirve el logo de marca de un tenant. DELIBERADAMENTE PÚBLICO (sin auth):
 * se usa directo en un <img src> del header (ClientShell.tsx), que no puede
 * mandar un Bearer token. tenant_id no es secreto en esta app (viaja en la
 * URL de decenas de endpoints ya protegidos por auth en los DATOS, no en el
 * ID) y un logo corporativo no es información sensible — el peor caso es
 * que alguien vea el logo de una empresa cuyo tenant_id ya conoce.
 *
 * Nada acá debe devolver 5xx: es un asset decorativo pedido en CADA carga de
 * página, así que un fallo de infraestructura degrada a "sin logo" (404) y
 * queda en el log. Antes no había manejo de errores y un storage account que
 * no resolvía por DNS producía un 500 en todas las cargas.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const { tenantId } = await params;
    const noLogo = () => NextResponse.json({ error: "Sin logo" }, { status: 404 });

    let storedName: string | null | undefined;
    try {
        const [rows]: any = await pool.query(
            "SELECT logo_stored_name FROM Tenants WHERE tenant_id = ? LIMIT 1",
            [tenantId]
        );
        storedName = rows?.[0]?.logo_stored_name as string | null | undefined;
    } catch (e) {
        console.error(`[tenant-logo] fallo la consulta del logo de ${tenantId}:`, errorMessage(e));
        return noLogo();
    }

    if (!storedName) return noLogo();

    // readTenantLogo ya no lanza: devuelve null y loguea ante cualquier fallo.
    const bytes = await readTenantLogo(storedName);
    if (!bytes) return noLogo();

    const ext = storedName.split(".").pop() || "";
    return new NextResponse(new Uint8Array(bytes), {
        status: 200,
        headers: {
            "Content-Type": mimeForExt(ext),
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "public, max-age=86400",
        },
    });
}
