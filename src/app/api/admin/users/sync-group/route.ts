/**
 * Grupos de seguridad de Entra ID.
 *
 *  GET  ?tenantId=…&q=…  → busca grupos para el modal de sincronización.
 *  POST { tenantId, groupId, role, allowedModules }
 *                        → aprovisiona a los miembros del grupo con ese rol.
 *
 * RBAC: `requireTenantRole(Owner|Admin)`. El rol `OWNER` **no** se puede
 * asignar por sincronización de grupo: la transferencia de propiedad es una
 * acción individual y deliberada, no algo que arrastre la membresía de un grupo.
 *
 * Permisos Graph mínimos: `Group.Read.All` + `User.Read.All` (o
 * `Directory.Read.All`).
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, hasSystemRole, requireTenantRole } from "@/lib/requestAuth";
import { errorMessage } from "@/lib/apiErrors";
import pool from "@/modules/storage/db";
import { graphGetAll, graphToken } from "@/modules/collectors/azure/m365UsersService";
import { getUserLimit } from "@/lib/tierLogic";
import { modulesToRoleTags, parseModules, roleToDb, toRole } from "@/services/tenantUsers.service";
import { isMockTenant } from "@/lib/mockData";
import type { EntraGroupSearchResult } from "@/types/tenantUsers.types";

const MOCK_GROUPS: EntraGroupSearchResult[] = [
    { id: "gggggggg-1111-2222-3333-444444444401", displayName: "FinOps-Engineers", description: "Equipo de optimización de costos", memberCount: 6 },
    { id: "gggggggg-1111-2222-3333-444444444402", displayName: "Cloud-Platform-Admins", description: "Administradores de plataforma", memberCount: 3 },
    { id: "gggggggg-1111-2222-3333-444444444403", displayName: "Security-Auditors", description: "Auditoría y cumplimiento", memberCount: 4 },
];

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") || "";
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();
        if (!tenantId) return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });

        await requireTenantRole(request, tenantId, ["Owner", "Admin"]);

        if (isMockTenant(tenantId)) {
            return NextResponse.json({
                success: true,
                mock: true,
                groups: q ? MOCK_GROUPS.filter((g) => g.displayName.toLowerCase().includes(q)) : MOCK_GROUPS,
            });
        }

        const token = await graphToken(tenantId);
        // `securityEnabled` acota el ruido: los grupos de Teams/Microsoft 365 no
        // se usan para gobernar el acceso a la plataforma.
        const groups = await graphGetAll(
            token,
            "https://graph.microsoft.com/v1.0/groups?$select=id,displayName,description,securityEnabled&$top=200"
        );
        const mapped: EntraGroupSearchResult[] = groups
            .filter((g: Record<string, unknown>) => g.securityEnabled !== false)
            .map((g: Record<string, unknown>) => ({
                id: String(g.id || ""),
                displayName: String(g.displayName || ""),
                description: g.description ? String(g.description) : undefined,
            }))
            .filter((g) => (q ? g.displayName.toLowerCase().includes(q) : true))
            .slice(0, 50);

        return NextResponse.json({ success: true, groups: mapped });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        const msg = errorMessage(e);
        console.error("[API users/sync-group GET]", msg);
        return NextResponse.json({ error: msg || "No se pudieron leer los grupos de Entra ID." }, { status: 502 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const tenantId = typeof body.tenantId === "string" ? body.tenantId : "";
        const groupId = typeof body.groupId === "string" ? body.groupId : "";
        if (!tenantId || !groupId) {
            return NextResponse.json({ error: "Faltan tenantId o groupId." }, { status: 400 });
        }

        const identity = await requireTenantRole(request, tenantId, ["Owner", "Admin"]);

        const role = toRole(body.role);
        if (role === "OWNER") {
            return NextResponse.json(
                { error: "El rol Owner no se asigna por grupo: es una transferencia de propiedad y se hace usuario por usuario." },
                { status: 400 }
            );
        }
        const modules = parseModules(body.allowedModules);
        const permissionsJson = JSON.stringify(modulesToRoleTags(modules));

        if (isMockTenant(tenantId)) {
            const group = MOCK_GROUPS.find((g) => g.id === groupId);
            return NextResponse.json({
                success: true,
                mock: true,
                provisioned: group?.memberCount ?? 0,
                skipped: 0,
                message: "Sincronización simulada: en el tenant de demostración no se escribe nada.",
            });
        }

        const [tenantRows]: any = await pool.query("SELECT tier FROM Tenants WHERE tenant_id = ?", [tenantId]);
        if (!tenantRows || tenantRows.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }
        const userLimit = getUserLimit(tenantRows[0].tier || "Professional");

        const token = await graphToken(tenantId);
        const members = await graphGetAll(
            token,
            `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(groupId)}/members?$select=id,displayName,mail,userPrincipalName&$top=999`
        );

        const [existingRows]: any = await pool.query("SELECT entra_oid FROM Users WHERE tenant_id = ?", [tenantId]);
        const existing = new Set((existingRows as { entra_oid: string }[]).map((r) => String(r.entra_oid)));
        let count = existing.size;

        let provisioned = 0;
        let skipped = 0;
        const isSuperAdmin = identity.isCorporateDomain && (await hasSystemRole(identity.email, "SUPERADMIN"));

        for (const m of members as Record<string, unknown>[]) {
            const oid = String(m.id || "");
            const email = String(m.mail || m.userPrincipalName || "");
            // Un grupo puede contener otros grupos y service principals: sin OID o
            // sin email no es un usuario que se pueda aprovisionar.
            if (!oid || !email) {
                skipped++;
                continue;
            }
            const isNew = !existing.has(oid);
            // El límite del tier se respeta igual que en el alta manual: la
            // sincronización no es una puerta para saltearlo.
            if (isNew && Number.isFinite(userLimit) && count >= userLimit) {
                skipped++;
                continue;
            }
            await pool.query(
                `INSERT INTO Users (entra_oid, tenant_id, email, display_name, role, system_role, permissions, allowed_modules, account_status, invited_by)
                 VALUES (?, ?, ?, ?, ?, 'USER', ?, ?, 'ACTIVE', ?)
                 ON DUPLICATE KEY UPDATE email = VALUES(email), display_name = VALUES(display_name),
                                         role = VALUES(role), permissions = VALUES(permissions),
                                         allowed_modules = VALUES(allowed_modules)`,
                [
                    oid,
                    tenantId,
                    email,
                    m.displayName ? String(m.displayName) : null,
                    roleToDb(role),
                    permissionsJson,
                    JSON.stringify(modules),
                    identity.email,
                ]
            );
            // El system_role nunca se toca por sincronización: un SUPERADMIN
            // existente no se degrada y nadie se promueve por estar en un grupo.
            if (isNew) {
                existing.add(oid);
                count++;
            }
            provisioned++;
        }

        return NextResponse.json({
            success: true,
            provisioned,
            skipped,
            userLimit: Number.isFinite(userLimit) ? userLimit : null,
            actorIsSuperAdmin: isSuperAdmin,
        });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        const msg = errorMessage(e);
        console.error("[API users/sync-group POST]", msg);
        return NextResponse.json({ error: msg || "No se pudo sincronizar el grupo." }, { status: 502 });
    }
}
