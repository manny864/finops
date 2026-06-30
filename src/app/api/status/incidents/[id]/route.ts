import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { requireSuperAdmin, AuthError } from "@/lib/requestAuth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    await initializeDatabase();

    // Check superadmin auth
    try {
      await requireSuperAdmin(request);
    } catch (e) {
      if (e instanceof AuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const incidentId = parseInt(params.id, 10);
    if (isNaN(incidentId)) {
      return NextResponse.json({ error: "Invalid incident ID" }, { status: 400 });
    }

    const body = await request.json();
    const { status, resolved_at } = body;

    if (!status) {
      return NextResponse.json({ error: "Missing status" }, { status: 400 });
    }

    if (!["investigating", "identified", "monitoring", "resolved"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // Update incident
    const updateParams: any[] = [status];
    let query = `UPDATE PlatformIncidents SET status = ?`;

    if (status === "resolved") {
      query += `, resolved_at = ?`;
      updateParams.push(resolved_at || new Date().toISOString());
    } else if (resolved_at) {
      query += `, resolved_at = NULL`;
    }

    query += ` WHERE id = ?`;
    updateParams.push(incidentId);

    await pool.query(query, updateParams);

    return NextResponse.json({ success: true, incidentId, status });
  } catch (e) {
    console.error("PATCH incidents error:", e);
    return NextResponse.json({ error: "Failed to update incident" }, { status: 500 });
  }
}
