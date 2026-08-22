import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

function isSafeWebhookUrl(input: string): boolean {
    try {
        const u = new URL(input);
        if (u.protocol !== "https:") return false;
        const host = u.hostname.toLowerCase();
        if (!host) return false;
        // Bloquea loopback / RFC1918 / link-local / metadata.
        if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
        if (/^10\./.test(host)) return false;
        if (/^192\.168\./.test(host)) return false;
        if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return false;
        if (host === "169.254.169.254" || host.startsWith("169.254.")) return false;
        if (host.endsWith(".internal") || host.endsWith(".local")) return false;
        return true;
    } catch {
        return false;
    }
}

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const tenantId = searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        const [rows] = await pool.query("SELECT webhook_url FROM Tenants WHERE tenant_id = ?", [tenantId]);
        const tenants = rows as any[];

        if (tenants.length === 0) {
            return NextResponse.json({ webhook_url: "" });
        }

        return NextResponse.json({ webhook_url: tenants[0].webhook_url || "" });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, webhookUrl } = body || {};

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        if (webhookUrl && !isSafeWebhookUrl(webhookUrl)) {
            return NextResponse.json({
                error: "URL inválida: debe ser HTTPS pública (no RFC1918, loopback ni metadata)."
            }, { status: 400 });
        }

        await pool.query("UPDATE Tenants SET webhook_url = ? WHERE tenant_id = ?", [webhookUrl || null, tenantId]);

        return NextResponse.json({ success: true });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
    }
}
