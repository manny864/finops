import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole } from "@/lib/requestAuth";
import { generateApiKey, ApiError } from "@/lib/publicApiAuth";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ success: false, error: "Missing tenantId" }, { status: 400 });
    }

    // Verify tenant access and ADMIN role
    await requireTenantRole(request, tenantId, ["Admin", "ADMIN"]);

    const [rows] = await pool.query(
      `SELECT id, name, key_prefix, scopes, rate_limit_per_min, enabled, last_used_at, created_by, created_at
       FROM PublicApiKeys WHERE tenant_id = ? ORDER BY created_at DESC`,
      [tenantId]
    );

    const keys = (rows as any[]).map((row) => ({
      id: row.id,
      name: row.name,
      key_prefix: row.key_prefix,
      scopes: typeof row.scopes === "string" ? JSON.parse(row.scopes) : row.scopes,
      rate_limit_per_min: row.rate_limit_per_min,
      enabled: row.enabled,
      last_used_at: row.last_used_at,
      created_by: row.created_by,
      created_at: row.created_at,
    }));

    return NextResponse.json({ success: true, keys });
  } catch (error: any) {
    if (error.status) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status }
      );
    }
    console.error("Error in GET /api/admin/public-api-keys:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ success: false, error: "Missing tenantId" }, { status: 400 });
    }

    // Verify tenant access and ADMIN role
    const identity = await requireTenantRole(request, tenantId, ["Admin", "ADMIN"]);

    const body = await request.json();
    const { name, scopes, rate_limit_per_min } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ success: false, error: "Name is required" }, { status: 400 });
    }

    const scopesList = Array.isArray(scopes)
      ? scopes
      : ["read:cost", "read:resources"];

    const rateLimitPerMin = Math.min(
      Math.max(Number(rate_limit_per_min) || 60, 10),
      1000
    );

    const { plaintext, hash, prefix } = generateApiKey();

    const [result] = await pool.query(
      `INSERT INTO PublicApiKeys (tenant_id, name, key_hash, key_prefix, scopes, rate_limit_per_min, created_by, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [
        tenantId,
        name.trim(),
        hash,
        prefix,
        JSON.stringify(scopesList),
        rateLimitPerMin,
        identity.email,
      ]
    );

    return NextResponse.json(
      {
        success: true,
        key: plaintext,
        prefix,
        id: (result as any).insertId,
        message: "API key created. Copy it now—you won't see it again!",
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error.status) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status }
      );
    }
    console.error("Error in POST /api/admin/public-api-keys:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
