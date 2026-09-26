/**
 * GET /api/intelligence/cost-centers/resources — lista de recursos
 * individuales (id/name/type/resourceGroup) que componen un Centro de Costos
 * (o el bucket especial 'Sin asignar'), para poblar el drawer de detalle y
 * — en el caso de 'Sin asignar' — alimentar BulkTagModal con IDs reales para
 * la remediación "Aplicar Tags".
 */
import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockCostCenterResources } from "@/lib/mockData";
import { fetchResourcesInResourceGroups } from "@/lib/azureResourceCounts";
import {
    filtroDeLaRequest, exigirRecorte, comoFilaDeCosto, DIMENSIONES_DE_ALCANCE,
    type FilaConDimensiones, type Permiso,
} from "@/services/perspectivesData.service";
import type { FilaDeCosto } from "@/services/perspectives.service";

const UNASSIGNED_NAME = "Sin asignar";

function predicadoDelCentro(costCenterName: string, tenantId: string) {
    const tagPredicate = costCenterName === UNASSIGNED_NAME
        ? "(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')) IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')) = 'null')"
        : "JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')) = ?";
    const params = costCenterName === UNASSIGNED_NAME ? [tenantId] : [tenantId, costCenterName];
    const ventana = `tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 2 MONTH)
                     AND ${tagPredicate}`;
    return { ventana, params };
}

async function getResourceGroupsForCostCenter(tenantId: string, costCenterName: string): Promise<string[]> {
    const { ventana, params } = predicadoDelCentro(costCenterName, tenantId);
    const [rows]: any = await pool.query(
        `SELECT DISTINCT resource_group AS rg FROM CostSnapshots WHERE ${ventana}`,
        params
    );
    return (rows as any[]).map(r => r.rg).filter(Boolean);
}

/**
 * MEJ-34 — los recursos del centro de costo que además caen en el alcance.
 *
 * ACÁ EL RECORTE NO ES COSMÉTICO. Esta lista alimenta `BulkTagModal`: con el
 * tablero acotado a un grupo, devolver los recursos del centro entero deja al
 * usuario etiquetando en masa recursos de FUERA de su alcance. No es mostrar de
 * más, es actuar de más.
 *
 * Se devuelven identificadores de recurso porque es con lo que `fetchResources-
 * InResourceGroups` se puede intersectar: el grupo de recursos no alcanza —uno
 * solo puede tener recursos dentro y fuera del alcance a la vez—.
 *
 * `medible: false` cuando hay filas en alcance pero ninguna trae `ResourceId`:
 * ahí no hay con qué intersectar, y devolver la lista vacía se leería como "este
 * grupo no tiene recursos", que es falso.
 */
async function recursosEnAlcance(
    tenantId: string, costCenterName: string, alcance: (f: FilaDeCosto) => boolean,
): Promise<{ ids: Set<string>; rgs: string[]; medible: boolean }> {
    const { ventana, params } = predicadoDelCentro(costCenterName, tenantId);
    const [detalle]: any = await pool.query(
        `SELECT ${DIMENSIONES_DE_ALCANCE},
                SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS costo
         FROM CostSnapshots WHERE ${ventana}
         GROUP BY ${DIMENSIONES_DE_ALCANCE}`,
        params
    );

    const ids = new Set<string>();
    const rgs = new Set<string>();
    let filasEnAlcance = 0;
    for (const f of (detalle as Array<FilaConDimensiones & { costo: unknown }>)) {
        if (!alcance(comoFilaDeCosto(f, Number(f.costo) || 0))) continue;
        filasEnAlcance += 1;
        if (f.ResourceId) ids.add(String(f.ResourceId).toLowerCase());
        if (f.resource_group) rgs.add(f.resource_group);
    }
    return { ids, rgs: [...rgs], medible: filasEnAlcance === 0 || ids.size > 0 };
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const costCenterName = request.nextUrl.searchParams.get("costCenterName");
        if (!tenantId || !costCenterName) return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });

        const identidad = await requireTenantRole(request, tenantId, ["Admin", "Owner", "Reader", "Colaborador"]);
        await requireTenantTier(request, tenantId, "Business");

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockCostCenterResources(costCenterName, "enterprise"));
        }

        const permiso: Permiso | null = identidad.alcance ?? null;
        const alcance = await filtroDeLaRequest(tenantId, request.nextUrl.searchParams, permiso);
        const recorte = alcance ? await recursosEnAlcance(tenantId, costCenterName, alcance) : null;
        // MEJ-38: acá el recorte es lo que evita entregar recursos de fuera del
        // alcance a `BulkTagModal`. Sin poder recortar, no se entrega nada.
        exigirRecorte(permiso, recorte?.medible === true);

        if (recorte?.medible) {
            // Resource Graph devuelve TODO lo que vive en esos grupos de
            // recursos, así que la intersección con los identificadores en
            // alcance es lo que efectivamente acota. Un recurso sin fila de
            // costo queda afuera: no hay con qué probar que está en el grupo, y
            // para etiquetar en masa vale más quedarse corto que de más.
            const resources = (await fetchResourcesInResourceGroups(tenantId, recorte.rgs))
                .filter((r) => recorte.ids.has(r.id.toLowerCase()));
            return NextResponse.json({
                success: true, costCenterName, resourceGroups: recorte.rgs, resources, scopeApplied: true,
            });
        }

        const rgNames = await getResourceGroupsForCostCenter(tenantId, costCenterName);
        const resources = await fetchResourcesInResourceGroups(tenantId, rgNames);

        return NextResponse.json({
            success: true, costCenterName, resourceGroups: rgNames, resources, scopeApplied: false,
        });
    } catch (err: unknown) {
        if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
        console.error("[cost-centers/resources] GET error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
