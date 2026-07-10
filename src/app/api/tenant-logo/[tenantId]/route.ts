import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { readTenantLogo, mimeForExt } from "@/lib/tenantLogo";

/**
 * GET /api/tenant-logo/[tenantId]
 *
 * Sirve el logo de marca de un tenant. DELIBERADAMENTE PÚBLICO (sin auth):
 * se usa directo en un <img src> del header (ClientShell.tsx), que no puede
 * mandar un Bearer token. tenant_id no es secreto en esta app (viaja en la
 * URL de decenas de endpoints ya protegidos por auth en los DATOS, no en el
 * ID) y un logo corporativo no es información sensible — el peor caso es
 * que alguien vea el logo de una empresa cuyo tenant_id ya conoce.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    const { tenantId } = await params;

    const [rows]: any = await pool.query(
        "SELECT logo_stored_name FROM Tenants WHERE tenant_id = ? LIMIT 1",
        [tenantId]
    );
    const storedName = rows?.[0]?.logo_stored_name as string | null | undefined;
    if (!storedName) {
        return NextResponse.json({ error: "Sin logo" }, { status: 404 });
    }

    const bytes = await readTenantLogo(storedName);
    if (!bytes) {
        return NextResponse.json({ error: "Sin logo" }, { status: 404 });
    }

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
