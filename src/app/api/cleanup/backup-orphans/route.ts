/**
 * GET /api/cleanup/backup-orphans — instancias protegidas en Recovery Services
 * Vault cuyo recurso original ya no existe (siguen facturando almacenamiento
 * de puntos de restauración). Solo lectura — no hay acción de borrado acá:
 * a diferencia de un disco huérfano, borrar un backup item puede destruir
 * puntos de restauración con valor de compliance/legal, así que se deja como
 * hallazgo a revisar manualmente por el equipo (mismo criterio que Backups y
 * Snapshots está marcado "Bajo / Controlado" en la matriz del reporte).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getOrphanedBackupItems } from "@/modules/collectors/azure/backupOrphanService";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        if (!isMockTenant(tenantId)) {
            await requireTenantTier(request, tenantId, "Business");
        } else {
            await requireTenantAccess(request, tenantId);
        }

        const data = await getWithStaleWhileRevalidate(
            `backup-orphans:v1:${tenantId}`,
            () => getOrphanedBackupItems(tenantId),
            1800,
            600
        );

        return NextResponse.json({ success: true, mock: isMockTenant(tenantId), ...data });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Backup Orphans API Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
