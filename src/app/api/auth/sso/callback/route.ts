import { NextRequest, NextResponse } from "next/server";
import { isWorkOSConfigured, getWorkOS } from "@/lib/workosClient";
import { setSsoCookie } from "@/lib/ssoSession";
import crypto from "crypto";

const STATE_COOKIE = 'finops_sso_state';

interface StateRecord { n: string; t: string; c: string; ts: number }

function verifyStateCookie(cookieValue: string | undefined, returnedNonce: string): StateRecord | null {
    if (!cookieValue) return null;
    const parts = cookieValue.split('.');
    if (parts.length !== 2) return null;
    const [encoded, mac] = parts;
    const key = process.env.SSO_STATE_SECRET || process.env.SSO_SESSION_SECRET;
    if (!key || key.length < 32) return null;
    let raw: string;
    try {
        raw = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch { return null; }
    const expected = crypto.createHmac('sha256', key).update(raw).digest('base64url');
    if (expected.length !== mac.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
    let record: StateRecord;
    try { record = JSON.parse(raw) as StateRecord; } catch { return null; }
    if (!record.n || !record.t || !record.c) return null;
    if (record.n !== returnedNonce) return null;
    if (Date.now() - record.ts > 10 * 60 * 1000) return null;
    return record;
}

/**
 * GET /api/auth/sso/callback?code=...&state=<nonce>
 *
 * Verifies the returned `state` nonce against an HMAC-signed cookie that was
 * issued at /sso/start; only then trusts the bound tenantId+connectionId.
 * Verifies the WorkOS profile's connection matches the bound connection.
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const code = searchParams.get("code");
        const state = searchParams.get("state");

        if (!code || !state) {
            return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
        }
        if (!isWorkOSConfigured()) {
            return NextResponse.json({ error: "SSO not configured" }, { status: 503 });
        }

        const stateCookie = request.cookies.get(STATE_COOKIE)?.value;
        const record = verifyStateCookie(stateCookie, state);
        if (!record) {
            return NextResponse.json({ error: "Invalid SSO state" }, { status: 400 });
        }

        const workos = getWorkOS();
        const { profile } = await workos.sso.getProfileAndToken({
            code,
            clientId: process.env.WORKOS_CLIENT_ID!,
        });

        const profileConnectionId = (profile as { connection_id?: string; connectionId?: string }).connection_id
            ?? (profile as { connection_id?: string; connectionId?: string }).connectionId;
        if (!profileConnectionId || profileConnectionId !== record.c) {
            return NextResponse.json(
                { error: "SSO connection mismatch" },
                { status: 403 }
            );
        }

        const email = profile.email || "";
        const workosUserId = profile.id || "";

        if (!email) {
            return NextResponse.json({ error: "Email not provided by IdP" }, { status: 400 });
        }

        // El dashboard vive en la raíz del locale; /overview (sin subruta) es 404.
        const response = NextResponse.redirect(
            new URL(`/${process.env.NEXT_PUBLIC_DEFAULT_LOCALE || "es"}`, request.url)
        );

        await setSsoCookie(response, {
            tenantId: record.t,
            email,
            workosUserId,
        });
        response.cookies.delete(STATE_COOKIE);

        return response;
    } catch (err) {
        console.error("SSO callback error:", err);
        return NextResponse.json({ error: "SSO callback failed" }, { status: 500 });
    }
}
