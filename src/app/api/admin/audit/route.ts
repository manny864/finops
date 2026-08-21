import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { buildCsv, AuditLogRow } from "@/lib/csvExport";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

interface AuditFilterParams {
  tenantId: string;
  user_email?: string;
  action_type?: string;
  status?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
  format: "json" | "csv" | "ndjson";
}

function parseParams(request: NextRequest): AuditFilterParams {
  const { searchParams } = request.nextUrl;
  
  const tenantId = searchParams.get("tenantId");
  if (!tenantId) {
    throw new AuthError("Falta tenantId", 400);
  }

  const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 1000);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0"), 0);
  const format = (searchParams.get("format") || "json") as "json" | "csv" | "ndjson";

  if (!["json", "csv", "ndjson"].includes(format)) {
    throw new AuthError("Formato inválido", 400);
  }

  return {
    tenantId,
    user_email: searchParams.get("user_email") || undefined,
    action_type: searchParams.get("action_type") || undefined,
    status: searchParams.get("status") || undefined,
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    limit,
    offset,
    format,
  };
}

function buildQuery(params: AuditFilterParams): {
  where: string;
  values: unknown[];
} {
  const conditions: string[] = ["tenant_id = ?"];
  const values: unknown[] = [params.tenantId];

  if (params.user_email) {
    conditions.push("user_email LIKE ?");
    values.push(`%${params.user_email}%`);
  }

  if (params.action_type) {
    conditions.push("action_type = ?");
    values.push(params.action_type);
  }

  if (params.status) {
    conditions.push("status = ?");
    values.push(params.status);
  }

  if (params.from) {
    conditions.push("timestamp >= ?");
    values.push(new Date(params.from).toISOString());
  }

  if (params.to) {
    conditions.push("timestamp <= ?");
    values.push(new Date(params.to).toISOString());
  }

  return {
    where: conditions.join(" AND "),
    values,
  };
}

export async function GET(request: NextRequest) {
  try {
    const params = parseParams(request);

    // Validate tenant access
    await requireTenantAccess(request, params.tenantId);

    const { where, values } = buildQuery(params);

    // Get total count
    const [countResult] = (await pool.query(
      `SELECT COUNT(*) as total FROM ActionLogs WHERE ${where}`,
      values
    )) as any[];
    const total = countResult?.[0]?.total || 0;

    // Get paginated logs
    const [rows] = await pool.query(
      `SELECT id, timestamp, user_email, action_type, resource_id, status 
       FROM ActionLogs 
       WHERE ${where} 
       ORDER BY timestamp DESC 
       LIMIT ? OFFSET ?`,
      [...values, params.limit, params.offset]
    );

    const logs = rows as AuditLogRow[];

    // Format response based on format parameter
    if (params.format === "csv") {
      const csv = buildCsv(logs);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit-${params.tenantId}-${new Date().toISOString().split("T")[0]}.csv"`,
        },
      });
    }

    if (params.format === "ndjson") {
      const ndjson = logs.map((log) => JSON.stringify(log)).join("\n");
      return new NextResponse(ndjson, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson",
          "Content-Disposition": `attachment; filename="audit-${params.tenantId}-${new Date().toISOString().split("T")[0]}.ndjson"`,
        },
      });
    }

    // Default JSON format
    const hasMore = params.offset + params.limit < total;
    return NextResponse.json({
      logs,
      total,
      limit: params.limit,
      offset: params.offset,
      hasMore,
    });
  } catch (e) {
    console.error("Error fetching audit logs:", e);

    if (e instanceof AuthError) {
      return NextResponse.json(
        { error: errorMessage(e) },
        { status: errorStatus(e) || 401 }
      );
    }

    // Parse error (invalid ISO date format)
    if (e instanceof SyntaxError && errorMessage(e).includes("Invalid time value")) {
      return NextResponse.json(
        { error: "Formato de fecha inválido. Use ISO 8601." },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Error interno del servidor", details: errorMessage(e) },
      { status: 500 }
    );
  }
}
