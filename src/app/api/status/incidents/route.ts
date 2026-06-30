import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { requireSuperAdmin, AuthError } from "@/lib/requestAuth";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await initializeDatabase();

    // Get incidents from last 30 days
    const [rows]: any = await pool.query(
      `SELECT id, title, severity, status, started_at AS startedAt, resolved_at AS resolvedAt, description
       FROM PlatformIncidents
       WHERE started_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
       ORDER BY started_at DESC`
    );

    return NextResponse.json(
      { incidents: rows || [] },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=60",
        },
      }
    );
  } catch (e) {
    console.error("Incidents endpoint error:", e);
    return NextResponse.json({ error: "Failed to retrieve incidents" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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

    const body = await request.json();
    const { title, severity, description } = body;

    if (!title || !severity) {
      return NextResponse.json({ error: "Missing title or severity" }, { status: 400 });
    }

    if (!["minor", "major", "critical"].includes(severity)) {
      return NextResponse.json({ error: "Invalid severity" }, { status: 400 });
    }

    // Insert new incident
    const [result]: any = await pool.query(
      `INSERT INTO PlatformIncidents (title, severity, status, started_at, description)
       VALUES (?, ?, 'investigating', NOW(), ?)`,
      [title, severity, description || null]
    );

    return NextResponse.json({
      id: result.insertId,
      title,
      severity,
      status: "investigating",
      startedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("POST incidents error:", e);
    return NextResponse.json({ error: "Failed to create incident" }, { status: 500 });
  }
}
