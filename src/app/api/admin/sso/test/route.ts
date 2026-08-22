/**
 * POST /api/admin/sso/test
 *
 * Verifica la conexión SAML del tenant **contra WorkOS**, y guarda el resultado.
 *
 * Importante sobre el alcance: esto NO simula un login. Consulta el estado real
 * de la conexión (`active` / `draft`), su tipo de IdP y los dominios que tiene
 * asociados. Un "test" que devolviera atributos SAML inventados sería un mock
 * disfrazado de diagnóstico, y en un tenant real la directiva es tolerancia
 * cero: si algo no se puede verificar, se dice.
 *
 * La verificación de extremo a extremo — que el IdP mande los atributos
 * esperados — sólo ocurre en un inicio de sesión real, y así se comunica en la UI.
 *
 * RBAC: `requireTenantRole(Owner|Admin)`.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { getWorkOS, isWorkOSConfigured } from "@/lib/workosClient";
import pool from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import { idpFromWorkosConnectionType } from "@/services/tenantSso.service";
import { isMockTenant } from "@/lib/mockData";
import type { SsoTestResult } from "@/types/tenantSso.types";

async function persistResult(tenantId: string, result: "SUCCESS" | "FAILED" | "NOT_CONFIGURED", detail: string) {
    try {
        await pool.query(
            `UPDATE TenantSSO
                SET last_test_result = ?, last_test_detail = ?, last_tested_at = UTC_TIMESTAMP()
              WHERE tenant_id = ?`,
            [result, detail.slice(0, 400), tenantId]
        );
    } catch (e) {
        // Guardar el resultado es conveniencia: no puede voltear el diagnóstico.
        console.warn("[sso/test] no se pudo persistir el resultado:", errorMessage(e));
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const tenantId = typeof body.tenantId === "string" ? body.tenantId : "";
        if (!tenantId) return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });

        await requireTenantRole(request, tenantId, ["Owner", "Admin"]);

        if (isMockTenant(tenantId)) {
            const result: SsoTestResult = {
                isSuccess: true,
                connectionState: "active",
                idpName: "Microsoft Entra ID (demo)",
                verifiedDomains: ["demo.cscloudsolutions.com.ar"],
                mappedAttributes: { email: "email", name: "displayName", groups: ["groups"] },
            };
            return NextResponse.json({ success: true, mock: true, result });
        }

        if (!isWorkOSConfigured()) {
            await persistResult(tenantId, "NOT_CONFIGURED", "La plataforma no tiene credenciales de WorkOS cargadas.");
            return NextResponse.json({
                success: true,
                result: {
                    isSuccess: false,
                    errorMessage:
                        "La plataforma no tiene credenciales de WorkOS cargadas (WORKOS_API_KEY / WORKOS_CLIENT_ID). Es configuración de CSCloudSolutions, no de tu tenant.",
                } satisfies SsoTestResult,
            });
        }

        const [rows]: any = await pool.query(
            `SELECT workos_connection_id, domain FROM TenantSSO WHERE tenant_id = ?`,
            [tenantId]
        );
        const connectionId = rows?.[0]?.workos_connection_id;
        if (!connectionId) {
            await persistResult(tenantId, "FAILED", "No hay connection ID guardado.");
            return NextResponse.json({
                success: true,
                result: {
                    isSuccess: false,
                    errorMessage: "Todavía no hay un ID de conexión guardado. Generá el Admin Portal y completá el alta en tu IdP.",
                } satisfies SsoTestResult,
            });
        }

        try {
            const workos = getWorkOS();
            const conn = await workos.sso.getConnection(String(connectionId));
            // El nombre del campo del tipo de conexión cambió entre versiones del
            // SDK (`connectionType` / `type`) y no está en el tipo público, así
            // que se lee de forma defensiva en vez de fijar una de las dos.
            const connType = String(
                (conn as unknown as { connectionType?: unknown; type?: unknown }).connectionType ??
                (conn as unknown as { type?: unknown }).type ??
                ""
            );
            // WorkOS marca `active` cuando el IdP terminó de configurarse; `draft`
            // significa que el alta quedó a medias en el portal.
            const isActive = String(conn.state).toLowerCase() === "active";
            const domains = (conn.domains || []).map((d: { domain: string }) => d.domain);

            const result: SsoTestResult = {
                isSuccess: isActive,
                connectionState: String(conn.state),
                idpName: conn.name || idpFromWorkosConnectionType(connType),
                verifiedDomains: domains,
                mappedAttributes: isActive ? { email: "email", name: "first_name + last_name", groups: ["groups"] } : undefined,
                errorMessage: isActive
                    ? undefined
                    : "La conexión existe pero WorkOS la reporta incompleta. Volvé a abrir el Admin Portal y terminá la carga de metadatos en tu IdP.",
            };

            await persistResult(
                tenantId,
                isActive ? "SUCCESS" : "FAILED",
                `${connType || "SAML"} · estado ${conn.state} · dominios: ${domains.join(", ") || "ninguno"}`
            );

            // Se guarda el IdP detectado: evita que el administrador tenga que
            // elegirlo a mano cuando WorkOS ya lo sabe.
            await pool.query(`UPDATE TenantSSO SET idp_provider = ?, is_domain_verified = ? WHERE tenant_id = ?`, [
                idpFromWorkosConnectionType(connType),
                domains.length > 0 ? 1 : 0,
                tenantId,
            ]);

            return NextResponse.json({ success: true, result });
        } catch (e) {
            const msg = errorMessage(e);
            await persistResult(tenantId, "FAILED", msg);
            return NextResponse.json({
                success: true,
                result: {
                    isSuccess: false,
                    errorMessage: `WorkOS no reconoce esta conexión (${msg}). Revisá el ID o volvé a generar el Admin Portal.`,
                } satisfies SsoTestResult,
            });
        }
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        const msg = errorMessage(error);
        console.error("[API sso/test]", msg);
        return NextResponse.json({ error: msg || "No se pudo probar la conexión." }, { status: 500 });
    }
}
