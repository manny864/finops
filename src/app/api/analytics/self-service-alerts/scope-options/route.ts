/**
 * GET /api/analytics/self-service-alerts/scope-options?tenantId=
 *
 * Los valores que puede tomar el alcance de una regla de alerta: grupos de
 * recursos y centros de costos. Hasta ahora el campo era texto libre, así que
 * bastaba un typo para que la regla apuntara a algo que no existe.
 *
 * Sale de `CostSnapshots` y no de Azure: son exactamente los RG y centros de
 * costos que tienen consumo --que es sobre lo que se alerta-- y evita dos
 * llamadas más a una API que ya venimos conteniendo por throttling. Las
 * suscripciones no van acá: el cliente ya las tiene con nombre en
 * `useSubscription()`, cargadas una vez para toda la app.
 *
 * Ventana de 90 días: un RG borrado hace medio año no es un alcance válido para
 * una alerta nueva, y la lista se mantiene corta.
 */
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { errorMessage } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    if (isMockTenant(tenantId)) {
      return NextResponse.json({
        success: true,
        resourceGroups: ["rg-produccion", "rg-datos", "rg-compartido"],
        costCenters: ["engineering", "marketing", "data-platform"],
      });
    }

    await requireTenantAccess(request, tenantId);

    const [rgRows]: any = await pool.query(
      `SELECT DISTINCT resource_group AS nombre
         FROM CostSnapshots
        WHERE tenant_id = ?
          AND resource_group IS NOT NULL AND resource_group NOT IN ('', '*', 'unknown')
          AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        ORDER BY resource_group
        LIMIT 500`,
      [tenantId]
    );

    // Mismos tres nombres de tag que usa el resto de la app para el centro de
    // costos (ver getDiscoveredCostCenterTags / cost-groups), pero sin su
    // fallback a una lista de ejemplo: acá una lista inventada haría que el
    // usuario eligiera un alcance que no existe en su Azure.
    const [ccRows]: any = await pool.query(
      `SELECT DISTINCT COALESCE(
                NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')), 'null'),
                NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$."Cost Center"')), 'null'),
                NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$."centro-de-costo"')), 'null')
              ) AS nombre
         FROM CostSnapshots
        WHERE tenant_id = ? AND Tags IS NOT NULL
          AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        LIMIT 200`,
      [tenantId]
    );

    // Un centro de costos con presupuesto es un alcance válido aunque todavía no
    // tenga consumo etiquetado en la ventana.
    const [budgetRows]: any = await pool.query(
      `SELECT DISTINCT cost_center_tag_value AS nombre FROM Budgets WHERE tenant_id = ?`,
      [tenantId]
    );

    const centros = new Set<string>();
    for (const r of [...(ccRows || []), ...(budgetRows || [])]) {
      const v = String(r.nombre || "").trim();
      if (v && v !== "null" && v !== "Untagged") centros.add(v);
    }

    return NextResponse.json({
      success: true,
      resourceGroups: (rgRows || []).map((r: any) => String(r.nombre)),
      costCenters: [...centros].sort((a, b) => a.localeCompare(b)),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[self-service-alerts/scope-options]", errorMessage(error));
    return NextResponse.json({ error: "No se pudieron leer las opciones de alcance" }, { status: 500 });
  }
}
