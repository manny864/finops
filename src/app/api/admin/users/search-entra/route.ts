/**
 * GET /api/admin/users/search-entra?tenantId=…&q=…
 *
 * Autocompletado de usuarios contra Microsoft Entra ID. Existe para que un
 * administrador no tenga que copiar GUIDs a mano: escribe un nombre o un email y
 * el OID se resuelve solo.
 *
 * RBAC: `requireTenantRole(Owner|Admin)`. Es lectura del directorio del cliente,
 * así que no alcanza con pertenecer al tenant — sólo quien puede dar de alta
 * usuarios puede enumerarlo.
 *
 * Permisos Graph mínimos del Service Principal: `User.Read.All` (o
 * `Directory.Read.All`, que ya se pide en el onboarding).
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole } from "@/lib/requestAuth";
import { errorMessage } from "@/lib/apiErrors";
import pool from "@/modules/storage/db";
import { graphToken } from "@/modules/collectors/azure/m365UsersService";
import { buildEntraUserSearchUrl } from "@/services/tenantUsers.service";
import { isMockTenant } from "@/lib/mockData";
import type { EntraUserSearchResult } from "@/types/tenantUsers.types";

/** Directorio sintético del tenant demo: permite probar el flujo de alta sin Entra ID. */
const MOCK_DIRECTORY: EntraUserSearchResult[] = [
    { id: "aaaaaaaa-1111-2222-3333-444444444401", displayName: "Ana Torres", userPrincipalName: "ana@demo.com", mail: "ana@demo.com", jobTitle: "FinOps Lead", accountEnabled: true },
    { id: "aaaaaaaa-1111-2222-3333-444444444402", displayName: "Luis Gómez", userPrincipalName: "luis@demo.com", mail: "luis@demo.com", jobTitle: "Cloud Engineer", accountEnabled: true },
    { id: "aaaaaaaa-1111-2222-3333-444444444403", displayName: "Sofía Méndez", userPrincipalName: "sofia@demo.com", mail: "sofia@demo.com", jobTitle: "Security Auditor", accountEnabled: true },
    { id: "aaaaaaaa-1111-2222-3333-444444444404", displayName: "Carlos Ruiz", userPrincipalName: "carlos@demo.com", mail: "carlos@demo.com", jobTitle: "Product Owner", accountEnabled: true },
    { id: "aaaaaaaa-1111-2222-3333-444444444405", displayName: "Diego Fernández", userPrincipalName: "diego@demo.com", mail: "diego@demo.com", jobTitle: "Platform Architect", accountEnabled: false },
];

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") || "";
        const q = (url.searchParams.get("q") || "").trim();

        if (!tenantId) return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        // Menos de dos caracteres devolvería medio directorio: no es una búsqueda.
        if (q.length < 2) return NextResponse.json({ success: true, users: [] });

        // Guard primero: la rama mock también consulta MySQL para marcar los ya
        // provisionados, así que un llamador anónimo con ?tenantId=demo-x
        // alcanzaría estado real.
        await requireTenantRole(request, tenantId, ["Owner", "Admin"]);

        const [existing]: any = await pool.query("SELECT entra_oid FROM Users WHERE tenant_id = ?", [tenantId]);
        const provisioned = new Set((existing as { entra_oid: string }[]).map((r) => String(r.entra_oid)));

        if (isMockTenant(tenantId)) {
            const needle = q.toLowerCase();
            return NextResponse.json({
                success: true,
                mock: true,
                users: MOCK_DIRECTORY.filter(
                    (u) => u.displayName.toLowerCase().includes(needle) || u.userPrincipalName.toLowerCase().includes(needle)
                ).map((u) => ({ ...u, alreadyProvisioned: provisioned.has(u.id) })),
            });
        }

        const token = await graphToken(tenantId);
        const res = await fetch(buildEntraUserSearchUrl(q), {
            headers: {
                Authorization: `Bearer ${token}`,
                // `$search` sobre /users no funciona sin este header.
                ConsistencyLevel: "eventual",
            },
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            return NextResponse.json(
                {
                    error:
                        res.status === 403
                            ? "El Service Principal no tiene permiso para leer el directorio (`User.Read.All` o `Directory.Read.All` con Admin Consent)."
                            : `Microsoft Graph rechazó la búsqueda (${res.status}): ${text.slice(0, 200)}`,
                },
                { status: res.status === 403 ? 403 : 502 }
            );
        }

        const data = await res.json();
        const users: EntraUserSearchResult[] = (data.value || []).map((u: Record<string, unknown>) => ({
            id: String(u.id || ""),
            displayName: String(u.displayName || ""),
            userPrincipalName: String(u.userPrincipalName || ""),
            mail: u.mail ? String(u.mail) : undefined,
            jobTitle: u.jobTitle ? String(u.jobTitle) : undefined,
            accountEnabled: u.accountEnabled !== false,
            alreadyProvisioned: provisioned.has(String(u.id || "")),
        }));

        return NextResponse.json({ success: true, users });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        const msg = errorMessage(e);
        console.error("[API users/search-entra]", msg);
        return NextResponse.json({ error: msg || "No se pudo consultar Entra ID." }, { status: 502 });
    }
}
