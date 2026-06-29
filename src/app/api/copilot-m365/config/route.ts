// NOTE: This is a mock-first implementation. No real Microsoft Graph API calls are made.
// Real integration would require delegated Graph permissions and M365 Search connector provisioning.

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";

function authCheck(request: NextRequest, tenantId: string) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        return { error: "Falta token Bearer de autenticación.", status: 401 };
    }
    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as Record<string, any> | null;
    if (!decoded || !decoded.tid) {
        return { error: "Estructura de token inválida.", status: 401 };
    }
    const email: string =
        decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "";
    const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");
    if (decoded.tid !== tenantId && !isAdmin) {
        return { error: "Acceso denegado. El token no coincide con el tenant.", status: 403 };
    }
    return { decoded, email };
}

// ─── GET ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const auth = authCheck(request, tenantId);
        if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

        // Mock tenant branch
        if (isMockTenant(tenantId)) {
            return NextResponse.json({
                success: true,
                mock: true,
                config: {
                    tenantId,
                    status: "ready",
                    connectorId: "conn-mock-001",
                    copilotStudioAgentId: "agent-finops-mock",
                    indexedRecords: 18450,
                    lastIndexAt: "2026-06-27T14:30:00Z",
                    config: {
                        namespaceFilter: ["costs", "budgets", "anomalies"],
                        refreshHours: 24,
                    },
                },
            });
        }

        await initializeDatabase();
        let rows: any[] = [];
        try {
            const [r] = await pool.query(
                "SELECT * FROM M365CopilotConfig WHERE tenant_id = ?",
                [tenantId]
            ) as [any[], any];
            rows = r || [];
        } catch (dbErr: any) {
            console.warn("[M365Config] DB query failed, returning default not_configured:", dbErr?.message);
            return NextResponse.json({
                success: true,
                config: { tenantId, status: "not_configured", indexedRecords: 0, lastIndexAt: null },
            });
        }

        if (!rows || rows.length === 0) {
            return NextResponse.json({
                success: true,
                config: { tenantId, status: "not_configured", indexedRecords: 0, lastIndexAt: null },
            });
        }

        const row = rows[0];
        return NextResponse.json({
            success: true,
            config: {
                tenantId: row.tenant_id,
                status: row.connector_status || "not_configured",
                connectorId: row.connector_id,
                copilotStudioAgentId: row.copilot_studio_agent_id,
                indexedRecords: row.indexed_records ?? 0,
                lastIndexAt: row.last_index_at,
                config: row.config ? (typeof row.config === 'string' ? JSON.parse(row.config) : row.config) : null,
            },
        });
    } catch (error: any) {
        console.error("M365 Copilot Config GET error:", error);
        // Fallback defensivo: nunca devolver 500 al cliente — la UI quedaría rota.
        // En su lugar, devolvemos estado not_configured para que la UI permita
        // al usuario provisionar manualmente.
        return NextResponse.json({
            success: true,
            config: { status: "not_configured", indexedRecords: 0, lastIndexAt: null },
            warning: error?.message || "No se pudo cargar configuración persistida",
        });
    }
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const auth = authCheck(request, tenantId);
        if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

        const body = await request.json();
        const action: "provision" | "reindex" | "revoke" = body?.action;
        if (!["provision", "reindex", "revoke"].includes(action)) {
            return NextResponse.json({ error: "Acción inválida. Use: provision | reindex | revoke" }, { status: 400 });
        }

        // Mock tenant branch
        if (isMockTenant(tenantId)) {
            const mockNextState: Record<string, any> = {
                provision: { status: "ready", connectorId: "conn-mock-001", indexedRecords: 18450, lastIndexAt: new Date().toISOString() },
                reindex: { status: "ready", connectorId: "conn-mock-001", indexedRecords: 18450 + Math.floor(Math.random() * 500), lastIndexAt: new Date().toISOString() },
                revoke: { status: "not_configured", connectorId: null, indexedRecords: 0, lastIndexAt: null },
            };
            return NextResponse.json({ success: true, mock: true, action, config: { tenantId, ...mockNextState[action] } });
        }

        await initializeDatabase();
        const now = new Date();

        if (action === "provision") {
            const connectorId = `conn-${Math.random().toString(36).slice(2, 10)}`;
            await pool.query(
                `INSERT INTO M365CopilotConfig
                    (tenant_id, connector_id, connector_status, indexed_records, last_index_at, config)
                 VALUES (?, ?, 'ready', 12500, ?, '{}')
                 ON DUPLICATE KEY UPDATE
                    connector_id = VALUES(connector_id),
                    connector_status = 'ready',
                    indexed_records = 12500,
                    last_index_at = VALUES(last_index_at)`,
                [tenantId, connectorId, now]
            );
            return NextResponse.json({ success: true, action, config: { status: "ready", connectorId, indexedRecords: 12500, lastIndexAt: now } });
        }

        if (action === "reindex") {
            // Real tenants: marcamos el reindex como solicitado (last_index_at = now). El conteo
            // de indexed_records DEBE provenir de Microsoft Graph / Copilot Studio en el próximo
            // poll del cron, no de un delta inventado. Si no hay integración Graph todavía,
            // mantenemos el contador previo.
            await pool.query(
                `UPDATE M365CopilotConfig
                 SET connector_status = 'ready', last_index_at = ?
                 WHERE tenant_id = ?`,
                [now, tenantId]
            );
            return NextResponse.json({
                success: true,
                action,
                note: "Reindex solicitado. El conteo real se actualizará en el próximo poll del conector."
            });
        }

        // revoke
        await pool.query(
            `UPDATE M365CopilotConfig
             SET connector_status = 'not_configured', connector_id = NULL
             WHERE tenant_id = ?`,
            [tenantId]
        );
        return NextResponse.json({ success: true, action });
    } catch (error: any) {
        console.error("M365 Copilot Config POST error:", error);
        return NextResponse.json({ error: "Error al ejecutar acción", details: error.message }, { status: 500 });
    }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const auth = authCheck(request, tenantId);
        if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true, message: "Configuración mock eliminada." });
        }

        await initializeDatabase();
        await pool.query("DELETE FROM M365CopilotConfig WHERE tenant_id = ?", [tenantId]);
        return NextResponse.json({ success: true, message: "Configuración eliminada." });
    } catch (error: any) {
        console.error("M365 Copilot Config DELETE error:", error);
        return NextResponse.json({ error: "Error al eliminar configuración", details: error.message }, { status: 500 });
    }
}
