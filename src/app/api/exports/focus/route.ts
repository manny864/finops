/**
 * GET /api/exports/focus
 *
 * FOCUS 1.1 conformant export of a tenant's billing data, sourced from the
 * CostSnapshots table (which already carries FOCUS-shape columns since the
 * 2024 FOCUS migration in db.ts).
 *
 * Auth:
 *  - Cookie / Bearer (Entra ID JWT) → requires ADMIN/OWNER on the tenant via
 *    requireTenantRole.
 *  - Alternatively a programmatic MCP API key (`Authorization: Bearer mcp_...`)
 *    bound to the same tenant, for ETL / Power BI / FinOps platforms.
 *
 * Query params:
 *  - tenantId   (required)
 *  - from       (ISO date, optional — defaults to 30d ago)
 *  - to         (ISO date, optional — defaults to today)
 *  - format     (csv | json | ndjson, default csv)
 *  - subscriptionId (optional scope filter)
 *  - limit      (max rows, default 100000, hard cap 500000)
 *
 * Output is streamed so multi-MB exports do not buffer in memory.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import pool from "@/modules/storage/db";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { mapCostSnapshotToFocus, type CostSnapshotRow } from "@/lib/focus/mapper";
import {
    buildFocusCsvHeader,
    buildFocusCsvRow,
} from "@/lib/focus/csv";
import { FOCUS_VERSION } from "@/lib/focus/columns";

const HARD_CAP = 500_000;
const DEFAULT_LIMIT = 100_000;
const BATCH_SIZE = 5_000;

interface ExportParams {
    tenantId: string;
    from: string;
    to: string;
    format: "csv" | "json" | "ndjson";
    subscriptionId?: string;
    limit: number;
}

function isoDateOrNull(s: string | null): string | null {
    if (!s) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}

function parseParams(request: NextRequest): ExportParams {
    const sp = request.nextUrl.searchParams;
    const tenantId = sp.get("tenantId");
    if (!tenantId) throw new AuthError("Falta tenantId", 400);

    const today = new Date();
    const defFrom = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    const from = isoDateOrNull(sp.get("from")) || defFrom.toISOString().slice(0, 10);
    const to = isoDateOrNull(sp.get("to")) || today.toISOString().slice(0, 10);

    const fmt = (sp.get("format") || "csv").toLowerCase();
    if (!["csv", "json", "ndjson"].includes(fmt)) {
        throw new AuthError("format debe ser csv | json | ndjson", 400);
    }

    const limitRaw = Number(sp.get("limit") || DEFAULT_LIMIT);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT, 1), HARD_CAP);

    return {
        tenantId,
        from,
        to,
        format: fmt as ExportParams["format"],
        subscriptionId: sp.get("subscriptionId") || undefined,
        limit,
    };
}

function hashMcpKey(plain: string): string {
    return crypto.createHash("sha256").update(plain).digest("hex");
}

async function mcpKeyTenantId(request: NextRequest): Promise<string | null> {
    const auth = request.headers.get("authorization") || "";
    if (!auth.toLowerCase().startsWith("bearer ")) return null;
    const token = auth.slice(7).trim();
    if (!token.startsWith("mcp_")) return null;
    try {
        const [rows] = await pool.query(
            `SELECT tenant_id FROM MCPApiKeys WHERE key_hash=? AND revoked_at IS NULL LIMIT 1`,
            [hashMcpKey(token)]
        );
        const arr = rows as Array<{ tenant_id: string }>;
        return arr.length > 0 ? arr[0].tenant_id : null;
    } catch {
        return null;
    }
}

async function authorise(request: NextRequest, tenantId: string): Promise<void> {
    const mcpTid = await mcpKeyTenantId(request);
    if (mcpTid && mcpTid === tenantId) return;
    if (mcpTid && mcpTid !== tenantId) {
        throw new AuthError("MCP key no autorizada para este tenant.", 403);
    }
    // Rol: siempre exigido, en los dos caminos.
    await requireTenantRole(request, tenantId, ["ADMIN", "OWNER"]);

    // FOCUS 1.1 Export es feature Enterprise (ver Sidebar).
    await requireTenantTier(request, tenantId, "Enterprise");
}

async function* streamFocusRows(params: ExportParams): AsyncGenerator<CostSnapshotRow[]> {
    let offset = 0;
    let total = 0;
    while (total < params.limit) {
        const limit = Math.min(BATCH_SIZE, params.limit - total);
        const where: string[] = ["tenant_id = ?", "date >= ?", "date <= ?"];
        const values: unknown[] = [params.tenantId, params.from, params.to];
        if (params.subscriptionId) {
            where.push("subscription_id = ?");
            values.push(params.subscriptionId);
        }
        const [rows] = await pool.query(
            `SELECT tenant_id, subscription_id, date, resource_group, service_name,
                    cost_usd, currency,
                    ChargePeriodStart, ChargePeriodEnd, ProviderName, PublisherName,
                    SubAccountId, BilledCost, EffectiveCost, CommitmentDiscountId,
                    MeterId, MeterName, MeterCategory, MeterSubCategory, Quantity,
                    UnitOfMeasure, ResourceId, ServiceFamily, Tags
               FROM CostSnapshots
              WHERE ${where.join(" AND ")}
              ORDER BY date ASC, id ASC
              LIMIT ? OFFSET ?`,
            [...values, limit, offset]
        );
        const batch = rows as CostSnapshotRow[];
        if (batch.length === 0) break;
        yield batch;
        offset += batch.length;
        total += batch.length;
        if (batch.length < limit) break;
    }
}

function csvStream(params: ExportParams): ReadableStream<string> {
    const billingOpts = {
        billingPeriodStart: new Date(params.from).toISOString(),
        billingPeriodEnd: new Date(params.to).toISOString(),
    };
    return new ReadableStream<string>({
        async start(controller) {
            try {
                controller.enqueue(buildFocusCsvHeader() + "\n");
                for await (const batch of streamFocusRows(params)) {
                    for (const row of batch) {
                        const rec = mapCostSnapshotToFocus(row, billingOpts);
                        controller.enqueue(buildFocusCsvRow(rec) + "\n");
                    }
                }
                controller.close();
            } catch (e) {
                controller.error(e);
            }
        },
    });
}

function ndjsonStream(params: ExportParams): ReadableStream<string> {
    const billingOpts = {
        billingPeriodStart: new Date(params.from).toISOString(),
        billingPeriodEnd: new Date(params.to).toISOString(),
    };
    return new ReadableStream<string>({
        async start(controller) {
            try {
                for await (const batch of streamFocusRows(params)) {
                    for (const row of batch) {
                        const rec = mapCostSnapshotToFocus(row, billingOpts);
                        controller.enqueue(JSON.stringify(rec) + "\n");
                    }
                }
                controller.close();
            } catch (e) {
                controller.error(e);
            }
        },
    });
}

async function jsonResponse(params: ExportParams): Promise<NextResponse> {
    const billingOpts = {
        billingPeriodStart: new Date(params.from).toISOString(),
        billingPeriodEnd: new Date(params.to).toISOString(),
    };
    const rows: ReturnType<typeof mapCostSnapshotToFocus>[] = [];
    for await (const batch of streamFocusRows(params)) {
        for (const row of batch) {
            rows.push(mapCostSnapshotToFocus(row, billingOpts));
        }
    }
    return NextResponse.json(
        {
            focusVersion: FOCUS_VERSION,
            tenantId: params.tenantId,
            from: params.from,
            to: params.to,
            count: rows.length,
            rows,
        },
        {
            headers: {
                "Content-Disposition": `attachment; filename="focus-${params.tenantId}-${params.from}-${params.to}.json"`,
            },
        }
    );
}

export async function GET(request: NextRequest) {
    try {
        const params = parseParams(request);
        await authorise(request, params.tenantId);

        const filenameBase = `focus-${params.tenantId}-${params.from}-${params.to}`;

        if (params.format === "json") {
            return jsonResponse(params);
        }

        const stream = params.format === "ndjson" ? ndjsonStream(params) : csvStream(params);
        const ext = params.format === "ndjson" ? "ndjson" : "csv";
        const contentType =
            params.format === "ndjson"
                ? "application/x-ndjson; charset=utf-8"
                : "text/csv; charset=utf-8";

        return new NextResponse(stream, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Content-Disposition": `attachment; filename="${filenameBase}.${ext}"`,
                "X-FOCUS-Version": FOCUS_VERSION,
            },
        });
    } catch (e: unknown) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        const msg = e instanceof Error ? e.message : "Error interno";
        console.error("FOCUS export error:", e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
