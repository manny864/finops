import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ success: false, error: "Missing tenantId" }, { status: 400 });
    }

    const keyId = parseInt((await params).id, 10);
    if (!keyId) {
      return NextResponse.json({ success: false, error: "Invalid key ID" }, { status: 400 });
    }

    // Verify tenant access and ADMIN role
    await requireTenantRole(request, tenantId, ["Admin", "ADMIN", "Owner"]);

    // Verify the key belongs to this tenant
    const [rows] = await pool.query(
      `SELECT id FROM PublicApiKeys WHERE id = ? AND tenant_id = ?`,
      [keyId, tenantId]
    );

    if ((rows as any[]).length === 0) {
      return NextResponse.json(
        { success: false, error: "Key not found" },
        { status: 404 }
      );
    }

    // Delete the key
    await pool.query(`DELETE FROM PublicApiKeys WHERE id = ?`, [keyId]);

    return NextResponse.json({ success: true, message: "Key deleted" });
  } catch (error) {
    if (errorStatus(error)) {
      return NextResponse.json(
        { success: false, error: errorMessage(error) },
        { status: errorStatus(error) }
      );
    }
    console.error("Error in DELETE /api/admin/public-api-keys/[id]:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ success: false, error: "Missing tenantId" }, { status: 400 });
    }

    const keyId = parseInt((await params).id, 10);
    if (!keyId) {
      return NextResponse.json({ success: false, error: "Invalid key ID" }, { status: 400 });
    }

    // Verify tenant access and ADMIN role
    await requireTenantRole(request, tenantId, ["Admin", "ADMIN", "Owner"]);

    // Verify the key belongs to this tenant
    const [rows] = await pool.query(
      `SELECT id FROM PublicApiKeys WHERE id = ? AND tenant_id = ?`,
      [keyId, tenantId]
    );

    if ((rows as any[]).length === 0) {
      return NextResponse.json(
        { success: false, error: "Key not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { name, enabled, scopes, rate_limit_per_min } = body;

    const updates: string[] = [];
    const values: any[] = [];

    if (name !== undefined && name !== null) {
      updates.push(`name = ?`);
      values.push(String(name).trim());
    }

    if (enabled !== undefined && enabled !== null) {
      updates.push(`enabled = ?`);
      values.push(Boolean(enabled) ? 1 : 0);
    }

    if (scopes !== undefined && scopes !== null && Array.isArray(scopes)) {
      updates.push(`scopes = ?`);
      values.push(JSON.stringify(scopes));
    }

    if (rate_limit_per_min !== undefined && rate_limit_per_min !== null) {
      const limit = Math.min(Math.max(Number(rate_limit_per_min) || 60, 10), 1000);
      updates.push(`rate_limit_per_min = ?`);
      values.push(limit);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      );
    }

    values.push(keyId);
    const sql = `UPDATE PublicApiKeys SET ${updates.join(", ")} WHERE id = ?`;

    await pool.query(sql, values);

    return NextResponse.json({ success: true, message: "Key updated" });
  } catch (error) {
    if (errorStatus(error)) {
      return NextResponse.json(
        { success: false, error: errorMessage(error) },
        { status: errorStatus(error) }
      );
    }
    console.error("Error in PUT /api/admin/public-api-keys/[id]:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
