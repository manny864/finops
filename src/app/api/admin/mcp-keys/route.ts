/**
 * Admin endpoint para crear/listar/revocar API keys MCP.
 * Auth: requireTenantRole(['Admin','Owner']) — solo admins del tenant.
 *
 * El plaintext del key SOLO se devuelve UNA VEZ en el POST de creación.
 * Después solo se guarda el hash (sha256).
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { AuthError, requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";

function hashKey(plain: string): string {
    return crypto.createHash("sha256").update(plain).digest("hex");
}

function generateKey(): { plaintext: string; prefix: string; hash: string } {
    // mcp_<32 hex chars> → identificable + sufficient entropy
    const raw = crypto.randomBytes(24).toString("hex");
    const plaintext = `mcp_${raw}`;
    return { plaintext, prefix: plaintext.slice(0, 12), hash: hashKey(plaintext) };
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });

        // MCP API Keys es feature Business (ver Sidebar).
        await requireTenantTier(request, tenantId, "Business");

        const [rows] = await pool.query(
            `SELECT id, key_prefix, label, created_by_email, created_at, last_used_at, revoked_at
             FROM MCPApiKeys WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200`,
            [tenantId]
        );
        return NextResponse.json({ success: true, keys: rows });
    } catch (err: any) {
        if (err instanceof AuthError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
        return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId, label } = body as { tenantId?: string; label?: string };
        if (!tenantId || !label) {
            return NextResponse.json({ success: false, error: "Falta tenantId o label" }, { status: 400 });
        }

        await requireTenantTier(request, tenantId, "Business");
        const identity = await requireTenantRole(request, tenantId, ["Admin", "Owner"]);
        const { plaintext, prefix, hash } = generateKey();

        await pool.query(
            `INSERT INTO MCPApiKeys (tenant_id, key_prefix, key_hash, label, created_by_email)
             VALUES (?, ?, ?, ?, ?)`,
            [tenantId, prefix, hash, label, identity.email || ""]
        );

        return NextResponse.json({
            success: true,
            key: plaintext,
            prefix,
            warning: "Guarda este key ahora — no se puede recuperar después.",
        });
    } catch (err: any) {
        if (err instanceof AuthError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
        return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const keyId = searchParams.get("keyId");
        if (!tenantId || !keyId) {
            return NextResponse.json({ success: false, error: "Falta tenantId o keyId" }, { status: 400 });
        }

        await requireTenantTier(request, tenantId, "Business");
        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        await pool.query(
            `UPDATE MCPApiKeys SET revoked_at=NOW() WHERE id=? AND tenant_id=? AND revoked_at IS NULL`,
            [keyId, tenantId]
        );
        return NextResponse.json({ success: true });
    } catch (err: any) {
        if (err instanceof AuthError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
        return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
    }
}
