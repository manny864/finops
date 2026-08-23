import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { buildCsv, AuditLogRow } from "@/lib/csvExport";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";
import { getAuditTrailLogs, serializeAuditTrailCsv } from "@/services/auditTrail.service";

interface ExportFilterParams {
  tenantId: string;
  user_email?: string;
  action_type?: string;
  status?: string;
  from?: string;
  to?: string;
  format?: string;
}

function parseParams(request: NextRequest): ExportFilterParams {
  const { searchParams } = request.nextUrl;

  const tenantId = searchParams.get("tenantId");
  if (!tenantId) {
    throw new AuthError("Falta tenantId", 400);
  }

  return {
    tenantId,
    user_email: searchParams.get("user_email") || searchParams.get("userEmail") || undefined,
    action_type: searchParams.get("action_type") || searchParams.get("actionType") || undefined,
    status: searchParams.get("status") || undefined,
    from: searchParams.get("from") || searchParams.get("fromDate") || undefined,
    to: searchParams.get("to") || searchParams.get("toDate") || undefined,
    format: searchParams.get("format") || "csv",
  };
}

function buildQuery(params: ExportFilterParams): {
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

    if (isMockTenant(params.tenantId) || request.nextUrl.searchParams.get("mock") === "true") {
      const data = await getAuditTrailLogs({
        tenantId: params.tenantId,
        userEmail: params.user_email,
        actionType: params.action_type,
        status: params.status,
        fromDate: params.from,
        toDate: params.to,
        page: 1,
        pageSize: 5000,
      });

      const dateStr = new Date().toISOString().split("T")[0];

      if (params.format === "json") {
        return new NextResponse(JSON.stringify(data.items, null, 2), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="audit-${params.tenantId}-full-${dateStr}.json"`,
          },
        });
      }

      if (params.format === "ndjson") {
        const ndjson = data.items.map((i) => JSON.stringify(i)).join("\n");
        return new NextResponse(ndjson, {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Content-Disposition": `attachment; filename="audit-${params.tenantId}-full-${dateStr}.ndjson"`,
          },
        });
      }

      const csv = serializeAuditTrailCsv(data.items);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit-${params.tenantId}-full-${dateStr}.csv"`,
        },
      });
    }

    // Requiere rol Admin / Owner
    await requireTenantRole(request, params.tenantId, [
      "Admin",
      "ADMIN",
      "Owner",
      "FinOps Manager",
      "Reader",
    ]);

    const { where, values } = buildQuery(params);

    const [rows] = await pool.query(
      `SELECT id, timestamp, user_email, action_type, resource_id, status 
       FROM ActionLogs 
       WHERE ${where} 
       ORDER BY timestamp DESC`,
      values
    );

    const logs = rows as AuditLogRow[];
    const dateStr = new Date().toISOString().split("T")[0];

    if (params.format === "json") {
      return new NextResponse(JSON.stringify(logs, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit-${params.tenantId}-full-${dateStr}.json"`,
        },
      });
    }

    if (params.format === "ndjson") {
      const ndjson = (logs || []).map((i) => JSON.stringify(i)).join("\n");
      return new NextResponse(ndjson, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit-${params.tenantId}-full-${dateStr}.ndjson"`,
        },
      });
    }

    const csv = buildCsv(logs || []);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-${params.tenantId}-full-${dateStr}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: errorMessage(error) },
        { status: errorStatus(error) }
      );
    }
    return NextResponse.json(
      { error: "Error al exportar registros" },
      { status: 500 }
    );
  }
}
