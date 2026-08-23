import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { buildCsv, AuditLogRow } from "@/lib/csvExport";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";
import { getAuditTrailLogs } from "@/services/auditTrail.service";

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

  const limit = Math.min(parseInt(searchParams.get("limit") || searchParams.get("pageSize") || "100"), 1000);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0"), 0);
  const format = (searchParams.get("format") || "json") as "json" | "csv" | "ndjson";

  if (!["json", "csv", "ndjson"].includes(format)) {
    throw new AuthError("Formato inválido", 400);
  }

  return {
    tenantId,
    user_email: searchParams.get("user_email") || searchParams.get("userEmail") || undefined,
    action_type: searchParams.get("action_type") || searchParams.get("actionType") || undefined,
    status: searchParams.get("status") || undefined,
    from: searchParams.get("from") || searchParams.get("fromDate") || undefined,
    to: searchParams.get("to") || searchParams.get("toDate") || undefined,
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

  if (params.action_type && params.action_type !== "ALL" && params.action_type !== "TODAS") {
    conditions.push("action_type = ?");
    values.push(params.action_type);
  }

  if (params.status && params.status !== "ALL" && params.status !== "TODOS") {
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

    // Directiva 1: Mock tenant primero sin requerir OAuth
    if (isMockTenant(params.tenantId) || request.nextUrl.searchParams.get("mock") === "true") {
      const page = Math.floor(params.offset / params.limit) + 1;
      const data = await getAuditTrailLogs({
        tenantId: params.tenantId,
        userEmail: params.user_email,
        actionType: params.action_type,
        status: params.status,
        fromDate: params.from,
        toDate: params.to,
        page,
        pageSize: params.limit,
      });

      const legacyLogs = data.items.map((i) => ({
        id: i.id,
        timestamp: i.createdAtIso,
        user_email: i.userEmail,
        action_type: i.actionType,
        resource_id: i.resourceTargetId || i.resourceTargetName,
        status: i.status,
      }));

      if (params.format === "csv") {
        const csv = buildCsv(legacyLogs as any);
        return new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="audit-${params.tenantId}-${new Date().toISOString().split("T")[0]}.csv"`,
          },
        });
      }

      if (params.format === "ndjson") {
        const ndjson = legacyLogs.map((log) => JSON.stringify(log)).join("\n");
        return new NextResponse(ndjson, {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson",
            "Content-Disposition": `attachment; filename="audit-${params.tenantId}-${new Date().toISOString().split("T")[0]}.ndjson"`,
          },
        });
      }

      const hasMore = params.offset + params.limit < data.totalCount;
      return NextResponse.json({
        success: true,
        logs: legacyLogs,
        items: data.items,
        total: data.totalCount,
        totalCount: data.totalCount,
        limit: params.limit,
        pageSize: params.limit,
        offset: params.offset,
        page,
        totalPages: data.totalPages,
        hasMore,
        mock: true,
      });
    }

    // Validate tenant access for real tenant
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
    const page = Math.floor(params.offset / params.limit) + 1;
    const totalPages = Math.max(1, Math.ceil(total / params.limit));

    const formattedItems = (logs || []).map((l: any) => ({
      id: String(l.id),
      tenantId: params.tenantId,
      userEmail: l.user_email || "system@cloud",
      actionType: l.action_type || "ROTATE_APP_SECRET",
      resourceTargetName: l.resource_id || "Recurso Azure",
      status: l.status || "SUCCESS",
      createdAtIso: l.timestamp ? new Date(l.timestamp).toISOString() : new Date().toISOString(),
      formattedCreatedAt: l.timestamp ? new Date(l.timestamp).toLocaleString("es-ES") : new Date().toLocaleString("es-ES"),
    }));

    return NextResponse.json({
      success: true,
      logs,
      items: formattedItems,
      total,
      totalCount: total,
      limit: params.limit,
      pageSize: params.limit,
      offset: params.offset,
      page,
      totalPages,
      hasMore,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: errorMessage(error) },
        { status: errorStatus(error) }
      );
    }
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
