import { NextRequest, NextResponse } from "next/server";
import { isWorkOSConfigured, getWorkOS } from "@/lib/workosClient";
import pool from "@/modules/storage/db";
import crypto from "crypto";

const STATE_COOKIE = 'finops_sso_state';
const STATE_TTL_SECONDS = 10 * 60;

/**
 * GET /api/auth/sso/start?domain=acme.com&tenantId=xxx
 * Initiates SAML SSO flow by building authorization URL.
 * Issues a signed CSRF state cookie that must match on callback.
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const domain = searchParams.get("domain");
        // Endpoint público pre-login: inicia el flujo SSO y solo usa tenantId para
        // buscar la config SSO del tenant (devuelve 403 si no está habilitada). No
        // se puede exigir JWT antes del login. Guard de auth no aplica aquí.
        // eslint-disable-next-line local/no-unauth-tenant-id
        const tenantId = searchParams.get("tenantId");

        if (!domain || !tenantId) {
            return NextResponse.json(
                { error: "Missing domain or tenantId" },
                { status: 400 }
            );
        }

        if (!isWorkOSConfigured()) {
            return NextResponse.json(
                { error: "SSO not configured" },
                { status: 503 }
            );
        }

        const [ssoRows] = await pool.query(
            `SELECT workos_connection_id, enabled FROM TenantSSO WHERE tenant_id = ?`,
            [tenantId]
        );

        if (
            !Array.isArray(ssoRows) ||
            ssoRows.length === 0 ||
            !(ssoRows[0] as { enabled?: number | boolean }).enabled
        ) {
            return NextResponse.json(
                { error: "SSO not enabled for this tenant" },
                { status: 403 }
            );
        }

        const connectionId = (ssoRows[0] as { workos_connection_id: string }).workos_connection_id;

        // Generate random opaque state; bind tenantId + connectionId server-side via signed cookie
        const nonce = crypto.randomBytes(32).toString('base64url');
        const stateRecord = JSON.stringify({ n: nonce, t: tenantId, c: connectionId, ts: Date.now() });
        const cookieKey = process.env.SSO_STATE_SECRET || process.env.SSO_SESSION_SECRET;
        if (!cookieKey || cookieKey.length < 32) {
            console.error('SSO_STATE_SECRET/SSO_SESSION_SECRET missing or too short');
            return NextResponse.json({ error: "SSO not configured" }, { status: 503 });
        }
        const hmac = crypto.createHmac('sha256', cookieKey).update(stateRecord).digest('base64url');
        const stateCookieValue = `${Buffer.from(stateRecord).toString('base64url')}.${hmac}`;

        const workos = getWorkOS();
        const authUrl = workos.sso.getAuthorizationUrl({
            connection: connectionId,
            redirectUri: process.env.WORKOS_REDIRECT_URI!,
            state: nonce,
            clientId: process.env.WORKOS_CLIENT_ID!,
        });

        const response = NextResponse.redirect(authUrl);
        response.cookies.set(STATE_COOKIE, stateCookieValue, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: STATE_TTL_SECONDS,
            path: '/',
        });
        return response;
    } catch (err) {
        console.error("SSO start error:", err);
        return NextResponse.json({ error: "SSO start failed" }, { status: 500 });
    }
}
