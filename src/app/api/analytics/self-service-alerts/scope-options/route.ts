/**
 * GET /api/analytics/self-service-alerts/scope-options?tenantId=&subscriptionId=
 *
 * Opciones de alcance para reglas de alertas: Grupos de Recursos (RG) y Centros de Costos.
 *
 * 1. Grupos de Recursos:
 *    - Fuente principal: Azure Resource Graph en vivo (ResourceContainers where type =~ 'microsoft.resources/subscriptions/resourcegroups').
 *      Garantiza que RGs recién creados o con costo $0 aparezcan siempre.
 *    - Fuente complementaria: CostSnapshots (historial de consumo de la base de datos).
 *    - Degradación elegante: si Azure ARG falla o no hay credenciales, usa CostSnapshots sin romper la API.
 *
 * 2. Centros de Costos:
 *    - CostCenterBudgets (presupuestos por CC en /intelligence/cost-centers).
 *    - CostGroups (grupos definidos por usuario en /grupos-de-costos).
 *    - Budgets (presupuestos generales de la plataforma).
 *    - Tags de CostSnapshots (CostCenter, Cost Center, centro-de-costo).
 *    - Azure Resource Graph tags en vivo.
 *    - Fallback de sugerencias estándar de la plataforma si no hay etiquetas activas aún.
 */
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { errorMessage } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { getResourceGraphClient } from "@/lib/azure";

export const dynamic = "force-dynamic";

const MOCK_RESOURCE_GROUPS = [
  "rg-aks-production-eastus",
  "rg-analytics-prod",
  "rg-core-apps",
  "rg-cscs-dev-sandbox",
  "rg-cscs-network-shared",
  "rg-cscs-prod-compute",
  "rg-datos",
  "rg-finops-analytics",
  "rg-produccion",
];

const MOCK_COST_CENTERS = [
  "AI-Services",
  "Customer Facing Apps",
  "Data",
  "data-platform",
  "Databases",
  "engineering",
  "HR",
  "IT",
  "Marketing",
  "Operations",
  "shared-services",
];

const SUGGESTED_COST_CENTERS = [
  "engineering",
  "marketing",
  "data-platform",
  "shared-services",
  "Databases",
  "AI-Services",
];

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    const subscriptionId = request.nextUrl.searchParams.get("subscriptionId");

    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    if (isMockTenant(tenantId)) {
      return NextResponse.json({
        success: true,
        resourceGroups: MOCK_RESOURCE_GROUPS,
        costCenters: MOCK_COST_CENTERS,
      });
    }

    await requireTenantAccess(request, tenantId);

    const rgs = new Set<string>();
    const centros = new Set<string>();

    // ─── 1. GRUPOS DE RECURSOS: Azure Resource Graph en vivo ───
    try {
      const argClient = await getResourceGraphClient(tenantId);
      const subFilter =
        subscriptionId && subscriptionId !== "All"
          ? `| where subscriptionId =~ '${subscriptionId.replace(/['\\]/g, "")}'`
          : "";
      const argQuery = `ResourceContainers | where type =~ 'microsoft.resources/subscriptions/resourcegroups' ${subFilter} | project name | order by name asc | limit 1000`;
      const argRes: any = await argClient.resources({ query: argQuery });
      for (const row of argRes?.data || []) {
        const name = String(row.name || "").trim();
        if (name && name !== "*" && name.toLowerCase() !== "unknown") {
          rgs.add(name);
        }
      }
    } catch (argErr) {
      console.warn("[self-service-alerts/scope-options] Azure Resource Graph RG query no disponible o falló:", errorMessage(argErr));
    }

    // ─── 2. GRUPOS DE RECURSOS: CostSnapshots (Historial de BD) ───
    try {
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
      for (const r of rgRows || []) {
        const n = String(r.nombre || "").trim();
        if (n) rgs.add(n);
      }

      // Si aún no tenemos RGs en 90 días, buscar sin límite estricto de fecha
      if (rgs.size === 0) {
        const [allRgRows]: any = await pool.query(
          `SELECT DISTINCT resource_group AS nombre
             FROM CostSnapshots
            WHERE tenant_id = ?
              AND resource_group IS NOT NULL AND resource_group NOT IN ('', '*', 'unknown')
            ORDER BY resource_group
            LIMIT 500`,
          [tenantId]
        );
        for (const r of allRgRows || []) {
          const n = String(r.nombre || "").trim();
          if (n) rgs.add(n);
        }
      }
    } catch (dbErr) {
      console.warn("[self-service-alerts/scope-options] Error consultando CostSnapshots para RGs:", errorMessage(dbErr));
    }

    // ─── 3. CENTROS DE COSTO: CostCenterBudgets (/intelligence/cost-centers) ───
    try {
      const [ccbRows]: any = await pool.query(
        `SELECT DISTINCT cost_center_name AS nombre FROM CostCenterBudgets WHERE tenant_id = ?`,
        [tenantId]
      );
      for (const r of ccbRows || []) {
        const v = String(r.nombre || "").trim();
        if (v && v !== "null" && v !== "Untagged" && v !== "Sin asignar") centros.add(v);
      }
    } catch (e) {
      console.warn("[self-service-alerts/scope-options] Error leyendo CostCenterBudgets:", errorMessage(e));
    }

    // ─── 4. CENTROS DE COSTO: CostGroups (/grupos-de-costos) ───
    try {
      const [cgRows]: any = await pool.query(
        `SELECT DISTINCT name AS nombre FROM CostGroups WHERE tenant_id = ?`,
        [tenantId]
      );
      for (const r of cgRows || []) {
        const v = String(r.nombre || "").trim();
        if (v && v !== "null" && v !== "Untagged" && v !== "Sin asignar") centros.add(v);
      }
    } catch {
      // CostGroups puede no existir en esquemas antiguos sin migración
    }

    // ─── 5. CENTROS DE COSTO: Budgets (Presupuestos Generales) ───
    try {
      const [budgetRows]: any = await pool.query(
        `SELECT DISTINCT cost_center_tag_value AS nombre FROM Budgets WHERE tenant_id = ?`,
        [tenantId]
      );
      for (const r of budgetRows || []) {
        const v = String(r.nombre || "").trim();
        if (v && v !== "null" && v !== "Untagged" && v !== "Sin asignar") centros.add(v);
      }
    } catch (e) {
      console.warn("[self-service-alerts/scope-options] Error leyendo Budgets:", errorMessage(e));
    }

    // ─── 6. CENTROS DE COSTO: Tags en CostSnapshots (Consumo) ───
    try {
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
      for (const r of ccRows || []) {
        const v = String(r.nombre || "").trim();
        if (v && v !== "null" && v !== "Untagged" && v !== "Sin asignar") centros.add(v);
      }
    } catch (e) {
      console.warn("[self-service-alerts/scope-options] Error leyendo tags de CostSnapshots:", errorMessage(e));
    }

    // ─── 7. CENTROS DE COSTO: Tags en vivo vía Azure Resource Graph ───
    try {
      const argClient = await getResourceGraphClient(tenantId);
      const tagQuery = `Resources | where isnotnull(tags) | extend cc = coalesce(tags.CostCenter, tags['Cost Center'], tags['centro-de-costo']) | where isnotempty(cc) | distinct tostring(cc) | limit 100`;
      const tagRes: any = await argClient.resources({ query: tagQuery });
      for (const row of tagRes?.data || []) {
        const v = String(row.cc || "").trim();
        if (v && v !== "null" && v !== "Untagged" && v !== "Sin asignar") centros.add(v);
      }
    } catch {}

    // Fallback amigable: si aún no hay centros descubiertos ni creados, sugerencias estándar
    if (centros.size === 0) {
      for (const c of SUGGESTED_COST_CENTERS) {
        centros.add(c);
      }
    }

    return NextResponse.json({
      success: true,
      resourceGroups: [...rgs].sort((a, b) => a.localeCompare(b)),
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

