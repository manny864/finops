/**
 * DELETE /api/intelligence/simulator/scenarios/[id]?tenantId=...
 *   Removes a saved scenario. Only its creator OR an ADMIN/OWNER can delete.
 */

import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await context.params;
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) throw new AuthError("Falta tenantId", 400);

        const identity = await requireTenantRole(request, tenantId, [
            "ADMIN",
            "OWNER",
            "Colaborador",
        ]);

        const [rows] = await pool.query(
            `SELECT user_email FROM WhatIfScenarios WHERE id = ? AND tenant_id = ? LIMIT 1`,
            [id, tenantId]
        );
        const list = rows as Array<{ user_email: string }>;
        if (list.length === 0) {
            return NextResponse.json({ error: "Escenario no encontrado." }, { status: 404 });
        }

        // Only creator or admin/owner can delete. requireTenantRole already
        // allowed Colaborador in; gate the delete to creator-only for them.
        const isOwner = list[0].user_email === identity.email;
        // Re-check admin/owner specifically (cheap)
        if (!isOwner) {
            try {
                await requireTenantRole(request, tenantId, ["ADMIN", "OWNER"]);
            } catch {
                return NextResponse.json({ error: "Solo el creador o un ADMIN puede borrar." }, { status: 403 });
            }
        }

        await pool.query(`DELETE FROM WhatIfScenarios WHERE id = ? AND tenant_id = ?`, [id, tenantId]);

        try {
            await pool.query(
                `INSERT INTO ActionLogs (tenant_id, user_email, action_type, resource_id, status)
                 VALUES (?, ?, ?, ?, ?)`,
                [tenantId, identity.email || "system", "WhatIfScenarioDelete", id, "SUCCESS"]
            );
        } catch { /* best-effort */ }

        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        const msg = e instanceof Error ? e.message : "Error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
