/**
 * GET & PATCH /api/analytics/anomalies
 * FinOps Anomaly Detection — Statistical Z-Score, 3-Sigma Bands & Root Cause Attribution
 *
 * Directiva Auth: isMockTenant ANTES del guard RBAC para literales sintéticos puros.
 * Para tenants reales: requireTenantAccess y tolerancia cero a fallbacks mock.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import pool from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import { getDailyCostsForTenant } from "@/services/anomalyDetectionService";
import {
  assembleLiveAnomalies,
  getMockAnomalyPayload,
} from "@/services/azureAnomalyDetection.service";

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      return NextResponse.json(getMockAnomalyPayload(tenantId));
    }

    await requireTenantAccess(request, tenantId);

    const payload = await getWithStaleWhileRevalidate(
      `anomalies:v2:${tenantId}`,
      async () => {
        try {
          const dailyCosts = await getDailyCostsForTenant(tenantId, "All");

          const [dbRows]: any = await pool.query(
            `SELECT id, subscription_id, date, amount, expected_amount, z_score, top_contributors, status, detected_at, resolved_at, resolution_notes
             FROM Anomalies
             WHERE tenant_id = ?
             ORDER BY date DESC
             LIMIT 50`,
            [tenantId]
          );

          return assembleLiveAnomalies({
            dailyCosts,
            dbAnomalies: Array.isArray(dbRows) ? dbRows : [],
          });
        } catch (err) {
          console.error("[API Anomalies] Live assembly error:", errorMessage(err));
          return assembleLiveAnomalies({ dailyCosts: [] });
        }
      },
      300 // 5 minutos de cache
    );

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Anomalies] Error:", errorMessage(error));
    return NextResponse.json(
      { error: "Error interno procesando detección de anomalías" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, anomalyId, action, snoozeDays, notes } = body;

    if (!tenantId || !anomalyId || !action) {
      return NextResponse.json({ error: "Faltan parámetros obligatorios" }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      return NextResponse.json({
        success: true,
        message: `Acción ${action} aplicada al registro demo ${anomalyId}`,
      });
    }

    await requireTenantAccess(request, tenantId);

    let newStatus = "Open";
    let resolvedAt: string | null = null;

    if (action === "RESOLVE") {
      newStatus = "Completed";
      resolvedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
    } else if (action === "SNOOZE") {
      newStatus = "Postponed";
    } else if (action === "DISMISS") {
      newStatus = "Dismissed";
      resolvedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
    } else if (action === "REOPEN") {
      newStatus = "Open";
      resolvedAt = null;
    }

    await pool.query(
      `UPDATE Anomalies 
       SET status = ?, 
           resolved_at = ?, 
           resolution_notes = COALESCE(?, resolution_notes)
       WHERE tenant_id = ? AND id = ?`,
      [newStatus, resolvedAt, notes || null, tenantId, anomalyId]
    );

    return NextResponse.json({ success: true, anomalyId, status: newStatus });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Anomalies] PATCH Error:", errorMessage(error));
    return NextResponse.json({ error: "Error actualizando anomalía" }, { status: 500 });
  }
}
