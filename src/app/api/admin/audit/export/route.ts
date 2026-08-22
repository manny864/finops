import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { buildCsv, AuditLogRow } from "@/lib/csvExport";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

interface ExportParams {
  tenantId: string;
  user_email?: string;
  action_type?: string;
  status?: string;
  from?: string;
  to?: string;
}

function parseParams(request: NextRequest): ExportParams {
  const { searchParams } = request.nextUrl;
  
  const tenantId = searchParams.get("tenantId");
  if (!tenantId) {
    throw new AuthError("Falta tenantId", 400);
  }

  return {
    tenantId,
    user_email: searchParams.get("user_email") || undefined,
    action_type: searchParams.get("action_type") || undefined,
    status: searchParams.get("status") || undefined,
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
  };
}

function buildQuery(params: ExportParams): {
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

async function* streamCsvBatches(
  params: ExportParams,
  batchSize: number = 5000,
  maxRows: number = 100000
): AsyncGenerator<string> {
  const { where, values } = buildQuery(params);
  let offset = 0;
  let totalFetched = 0;
  let isFirst = true;

  while (totalFetched < maxRows) {
    const limit = Math.min(batchSize, maxRows - totalFetched);
    const [rows] = await pool.query(
      `SELECT id, timestamp, user_email, action_type, resource_id, status 
       FROM ActionLogs 
       WHERE ${where} 
       ORDER BY timestamp DESC 
       LIMIT ? OFFSET ?`,
      [...values, limit, offset]
    );

    const logs = rows as AuditLogRow[];
    if (logs.length === 0) break;

    // Yield header only on first batch
    if (isFirst) {
      yield buildCsv(logs);
      isFirst = false;
    } else {
      // For subsequent batches, skip header
      yield logs.map((log) => {
        return [log.id, log.timestamp, log.user_email, log.action_type, log.resource_id, log.status]
          .map((v) => (typeof v === "string" && (v.includes(",") || v.includes('"') || v.includes("\n")) ? `"${v.replace(/"/g, '""')}"` : v))
          .join(",");
      }).join("\n") + "\n";
    }

    offset += logs.length;
    totalFetched += logs.length;

    if (logs.length < limit) break;
  }
}

export async function GET(request: NextRequest) {
  try {
    const params = parseParams(request);

    // Require ADMIN role to export full history
    await requireTenantRole(request, params.tenantId, ["ADMIN", "OWNER"]);

    const iso = new Date().toISOString().split("T")[0];
    const filename = `audit-${params.tenantId}-full-${iso}.csv`;

    // Use ReadableStream for streaming response
    const readable = new ReadableStream<string>({
      async start(controller) {
        try {
          for await (const chunk of streamCsvBatches(params)) {
            controller.enqueue(chunk);
            controller.enqueue("\n");
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
    });

    return new NextResponse(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error("Error exporting audit logs:", e);

    if (e instanceof AuthError) {
      return NextResponse.json(
        { error: errorMessage(e) },
        { status: errorStatus(e) || 401 }
      );
    }

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
