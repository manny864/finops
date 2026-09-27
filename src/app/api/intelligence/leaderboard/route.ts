/**
 * GET/PUT /api/intelligence/leaderboard — MEJ-37.
 *
 * El ranking de equipos de una Perspective, ordenado por MEJORA y no por gasto,
 * más el split COGS/OpEx que es lo que permite llevar el costo de nube a un
 * cálculo de margen bruto.
 *
 * La decisión de orden vive en `leaderboard.service.ts`, que es puro. Acá sólo
 * se juntan los números.
 *
 * RBAC: tier Business (GET). Clasificar COGS/OpEx pide Admin/Owner: cambia cómo
 * se lee el margen de toda la empresa, no es una preferencia de pantalla.
 *
 * NO la ve un usuario con alcance asignado (MEJ-38): un leaderboard es una
 * comparación ENTRE grupos, y su recorte es justamente no ver los otros. El
 * default-deny la niega sin que haya que escribir nada.
 */

import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { filasDeCosto, listarPerspectivas } from "@/services/perspectivesData.service";
import { repartir, type FilaDeCosto } from "@/services/perspectives.service";
import { armarLeaderboard, margenBruto, type Clasificacion, type EntradaDeGrupo } from "@/services/leaderboard.service";
import { errorMessage } from "@/lib/apiErrors";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** El mes en curso y el anterior completo. */
function periodos(referencia = new Date()) {
    const finActual = referencia;
    const inicioActual = new Date(referencia.getFullYear(), referencia.getMonth(), 1);
    const finPrevio = new Date(inicioActual.getTime() - 86_400_000);
    const inicioPrevio = new Date(finPrevio.getFullYear(), finPrevio.getMonth(), 1);
    return {
        actual: { desde: iso(inicioActual), hasta: iso(finActual) },
        previo: { desde: iso(inicioPrevio), hasta: iso(finPrevio) },
    };
}

/**
 * Ahorro capturado por grupo.
 *
 * Son remediaciones APROBADAS Y CON RESULTADO DE EJECUCIÓN ARM, no aprobadas a
 * secas: aprobar es una intención, y esta columna dice "esto ya se hizo". El
 * enum de `status` no tiene un valor "ejecutada" —es
 * `Pending/Approved/Rejected/Failed`—, así que la evidencia de que corrió es
 * que exista el resultado de la llamada a ARM.
 */
async function ahorroCapturadoPorRecurso(tenantId: string, desde: string, hasta: string) {
    const [filas] = await pool.query<any[]>(
        `SELECT LOWER(COALESCE(resource_id, '')) AS resourceId,
                LOWER(COALESCE(resource_group, '')) AS resourceGroup,
                COALESCE(subscription_id, '') AS subscriptionId,
                COALESCE(estimated_savings, 0) AS ahorro
           FROM RemediationRequests
          WHERE tenant_id = ?
            AND status = 'Approved'
            AND arm_execution_result_json IS NOT NULL
            AND DATE(resolved_at) BETWEEN ? AND ?`,
        [tenantId, desde, hasta]
    );
    return filas || [];
}

export async function GET(request: NextRequest) {
    try {
        const sp = request.nextUrl.searchParams;
        const tenantId = sp.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        // Tier Business, como pide la propuesta.
        await requireTenantTier(request, tenantId, "Business");

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("leaderboard", tenantId));
        }

        const perspectivas = await listarPerspectivas(tenantId);
        const idPedido = Number(sp.get("perspective"));
        const perspectiva = Number.isInteger(idPedido) && idPedido > 0
            ? perspectivas.find((p) => p.id === idPedido)
            : perspectivas[0];

        if (!perspectiva) {
            // Sin Perspective no hay equipos que comparar. Se dice, en vez de
            // devolver una tabla vacía que se leería como "nadie gastó".
            return NextResponse.json({
                success: true,
                sinPerspectiva: true,
                message: "Este tablero compara los grupos de una Perspective, y todavía no hay ninguna definida.",
                perspectivas: perspectivas.map((p) => ({ id: p.id, name: p.name })),
            });
        }

        const { actual, previo } = periodos();
        const [filasActual, filasPrevio, clasificaciones, presupuestos, remediaciones, ingresosFila] = await Promise.all([
            filasDeCosto(tenantId, actual.desde, actual.hasta),
            filasDeCosto(tenantId, previo.desde, previo.hasta),
            pool.query<any[]>(
                "SELECT group_name AS grupo, classification AS clase FROM PerspectiveGroupClassification WHERE tenant_id = ? AND perspective_id = ?",
                [tenantId, perspectiva.id]
            ).then(([r]) => r || []),
            pool.query<any[]>(
                "SELECT cost_center_name AS nombre, monthly_budget_usd AS monto FROM CostCenterBudgets WHERE tenant_id = ?",
                [tenantId]
            ).then(([r]) => r || []),
            ahorroCapturadoPorRecurso(tenantId, actual.desde, actual.hasta),
            /**
             * MEJ-37 fase 2 — los ingresos del período.
             *
             * Salen de `TenantUnitMetrics`, la serie que Unit Economics ya
             * ingesta por API Key: no hizo falta un endpoint nuevo, sólo el
             * tipo `REVENUE`. `SUM` sobre el mismo rango que el costo, porque
             * un margen que cruza períodos distintos no es un margen.
             */
            pool.query<any[]>(
                `SELECT COALESCE(SUM(unit_count), 0) AS total, COUNT(*) AS dias
                   FROM TenantUnitMetrics
                  WHERE tenant_id = ? AND metric_type = 'REVENUE'
                    AND metric_date BETWEEN ? AND ?`,
                [tenantId, actual.desde, actual.hasta]
            ).then(([r]) => r?.[0] ?? { total: 0, dias: 0 }),
        ]);

        const repActual = repartir(filasActual, perspectiva.reglas);
        const repPrevio = repartir(filasPrevio, perspectiva.reglas);
        const previoPorGrupo = new Map(repPrevio.grupos.map((g) => [g.grupo, g.costo]));
        const clasePorGrupo = new Map<string, Clasificacion>(
            clasificaciones.map((c: any) => [String(c.grupo), String(c.clase) as Clasificacion])
        );

        /**
         * El presupuesto se cruza POR NOMBRE con el centro de costo.
         *
         * Un grupo de Perspective y un centro de costo son cosas distintas: no
         * hay ninguna clave que los una. El match por nombre es una convención,
         * no un dato, y por eso cuando no coincide la columna queda vacía en vez
         * de mostrar el presupuesto de otro — que sería peor que no mostrar
         * ninguno. El criterio 2 pide exactamente eso: el grupo aparece igual.
         */
        const presupuestoPorNombre = new Map<string, number>(
            presupuestos.map((b: any) => [String(b.nombre).trim().toLowerCase(), Number(b.monto) || 0])
        );

        /**
         * El ahorro se atribuye con LAS MISMAS REGLAS que el costo: cada
         * remediación entra como una fila de costo y `repartir` la agrupa. Una
         * segunda forma de decidir a qué equipo pertenece un recurso sería una
         * segunda forma de equivocarse.
         *
         * `tags: null` es literal y tiene consecuencia: `RemediationRequests`
         * no guarda etiquetas, así que una Perspective cuyas reglas sean por
         * tag no puede atribuir ahorro y esos montos caen en `sinAsignar`. Es
         * preferible a inventar la etiqueta desde el nombre del recurso, que
         * pondría el ahorro en el equipo equivocado.
         */
        const filasDeAhorro: FilaDeCosto[] = remediaciones.map((r: any) => ({
            costo: Number(r.ahorro) || 0,
            subscriptionId: r.subscriptionId || null,
            resourceGroup: r.resourceGroup || null,
            resourceId: r.resourceId || null,
            tags: null,
        }));
        const repAhorro = repartir(filasDeAhorro, perspectiva.reglas);
        const ahorroPorGrupo = new Map(repAhorro.grupos.map((g) => [g.grupo, g.costo]));

        const entradas: EntradaDeGrupo[] = repActual.grupos.map((g) => ({
            grupo: g.grupo,
            gasto: g.costo,
            gastoPrevio: previoPorGrupo.has(g.grupo) ? previoPorGrupo.get(g.grupo)! : null,
            presupuesto: presupuestoPorNombre.get(g.grupo.trim().toLowerCase()) ?? null,
            ahorroCapturado: Number((ahorroPorGrupo.get(g.grupo) || 0).toFixed(2)),
            clasificacion: clasePorGrupo.get(g.grupo) ?? "UNCLASSIFIED",
        }));

        const leaderboard = armarLeaderboard(entradas);

        // Sin ninguna fila de REVENUE el margen es `null`, no cero: cero por
        // ciento sería afirmar que todo lo que entra se va en nube, y lo que
        // pasa es que nadie ingestó el dato.
        const ingresos = Number(ingresosFila?.dias || 0) > 0 ? Number(ingresosFila.total) : null;
        const margen = margenBruto(ingresos, leaderboard.split);

        return NextResponse.json({
            success: true,
            perspective: { id: perspectiva.id, name: perspectiva.name },
            perspectivas: perspectivas.map((p) => ({ id: p.id, name: p.name })),
            periodos: { actual, previo },
            ...leaderboard,
            margen,
            // Lo que ninguna regla asignó. Va al lado del split porque si no, el
            // total de la tabla no cuadra con la factura y nadie sabe por qué.
            sinAsignar: repActual.sinAsignar,
            coberturaPct: repActual.coberturaPct,
        });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[intelligence/leaderboard] GET:", errorMessage(e));
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const { tenantId, perspectiveId, groupName, classification } = (await request.json().catch(() => ({}))) || {};
        if (!tenantId || !groupName) {
            return NextResponse.json({ error: "Faltan tenantId o groupName" }, { status: 400 });
        }
        const id = Number(perspectiveId);
        if (!Number.isInteger(id) || id <= 0) {
            return NextResponse.json({ error: "perspectiveId inválido" }, { status: 400 });
        }
        if (!["COGS", "OPEX", "UNCLASSIFIED"].includes(String(classification))) {
            return NextResponse.json({ error: "classification debe ser COGS, OPEX o UNCLASSIFIED" }, { status: 400 });
        }

        // Guard inline: `local/no-unauth-tenant-id` existe para que la
        // autorización se lea en el handler. Clasificar mueve el margen bruto
        // de toda la empresa, no es una preferencia de pantalla.
        await requireTenantRole(request, tenantId, ["Owner", "Admin"]);

        const existe = (await listarPerspectivas(tenantId)).some((p) => p.id === id);
        if (!existe) return NextResponse.json({ error: "La Perspective no existe en este tenant" }, { status: 404 });

        if (classification === "UNCLASSIFIED") {
            // Sin fila ya significa sin clasificar: no se guarda un "no sé".
            await pool.query(
                "DELETE FROM PerspectiveGroupClassification WHERE tenant_id = ? AND perspective_id = ? AND group_name = ?",
                [tenantId, id, groupName]
            );
        } else {
            await pool.query(
                `INSERT INTO PerspectiveGroupClassification (tenant_id, perspective_id, group_name, classification)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE classification = VALUES(classification)`,
                [tenantId, id, groupName, classification]
            );
        }

        return NextResponse.json({ success: true });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[intelligence/leaderboard] PUT:", errorMessage(e));
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
