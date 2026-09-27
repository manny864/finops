/**
 * GET /api/governance/lifecycle — MEJ-39, fin de soporte (EOL/EOS).
 *
 * Cruza lo que el tenant tiene desplegado contra el catálogo curado de fechas
 * de retiro, y le pone al lado el costo mensual de lo afectado. Sin el costo es
 * una lista de deuda técnica; con el costo es una decisión de presupuesto, que
 * es lo que convierte esto en FinOps y no en un inventario más.
 *
 * RBAC: requireTenantAccess.
 *
 * No la ve un usuario con alcance asignado (MEJ-38): no está en
 * `RUTAS_CON_ALCANCE`, así que el default-deny la niega. Es lo correcto — el
 * inventario de toda la plataforma no es su porción— y no hace falta escribir
 * nada para que pase.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { redis } from "@/lib/redis";
import {
    getMtdCostByResourceId,
    listResourcesByTypes,
} from "@/app/api/intelligence/databases/diagnosticsShared";
import {
    CATALOGO_REVISADO_EL,
    DIAS_CRITICO,
    DIAS_PROXIMO,
    TIPOS_DEL_CATALOGO,
    evaluarCicloDeVida,
    familiaDeTipo,
    type Ventana,
} from "@/lib/azureLifecycleCatalog";

const CLAVE_CACHE = (tenantId: string) => `governance:lifecycle:v1:${tenantId}`;
const TTL_SEGUNDOS = 60 * 60 * 6;

interface RecursoConCicloDeVida {
    id: string;
    name: string;
    type: string;
    familia: string;
    resourceGroup?: string;
    subscriptionId?: string;
    location?: string;
    version: string | null;
    ventana: Ventana;
    finDeSoporte: string | null;
    finExtendido: string | null;
    diasRestantes: number | null;
    nota: string | null;
    motivo: string | null;
    costoMensualUsd: number | null;
    fuente: string;
}

/** El orden en que un humano quiere ver esto: lo urgente arriba. */
const PESO: Record<Ventana, number> = { retirado: 0, critico: 1, proximo: 2, "sin-datos": 3, soportado: 4 };

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "tenantId parameter is required" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("governance_lifecycle", tenantId));
        }

        const clave = CLAVE_CACHE(tenantId);
        if (searchParams.get("bust") === "1") {
            await redis.del(clave).catch(() => undefined);
        } else {
            const cacheado = await redis.get(clave).catch(() => null);
            if (cacheado) return NextResponse.json(JSON.parse(cacheado));
        }

        const credential = await getAzureCredential(tenantId);
        const subscriptionIds = await getSubscriptionsForTenant(tenantId, credential);
        if (subscriptionIds.length === 0) {
            return NextResponse.json({
                mock: false,
                revisadoEl: CATALOGO_REVISADO_EL,
                resources: [],
                resumen: vacio(),
                message: "No existen suscripciones activas para este tenant.",
            });
        }

        const crudos = await listResourcesByTypes(tenantId, TIPOS_DEL_CATALOGO, subscriptionIds, credential);

        // El costo se pide UNA vez para todos, no por recurso: la consulta de
        // Cost Management se paga por suscripción, no por id.
        const costos = await getMtdCostByResourceId(
            tenantId,
            credential,
            crudos.map((r) => ({ id: r.id, subscriptionId: r.subscriptionId })),
        );

        const hoy = new Date();
        const recursos: RecursoConCicloDeVida[] = [];
        for (const r of crudos) {
            const familia = familiaDeTipo(r.type);
            if (!familia) continue;
            const cruda = (r.properties as Record<string, unknown> | undefined)?.[familia.campoDeVersion];
            const estado = evaluarCicloDeVida(familia, cruda, hoy);
            const costo = costos.get(String(r.id).toLowerCase());
            recursos.push({
                id: r.id,
                name: r.name,
                type: r.type,
                familia: familia.etiqueta,
                resourceGroup: r.resourceGroup,
                subscriptionId: r.subscriptionId,
                location: r.location,
                version: estado.version,
                ventana: estado.ventana,
                finDeSoporte: estado.finDeSoporte,
                finExtendido: estado.finExtendido,
                diasRestantes: estado.diasRestantes,
                nota: estado.nota,
                motivo: estado.motivo,
                // `null` y `0` no son lo mismo: null es "no se pudo atribuir
                // costo a este id", 0 es "costó cero". Colapsarlos haría que un
                // recurso sin dato baje el total y el riesgo se vea más chico.
                costoMensualUsd: costo === undefined ? null : Number(costo.toFixed(2)),
                fuente: familia.fuente,
            });
        }

        recursos.sort(
            (a, b) =>
                PESO[a.ventana] - PESO[b.ventana] ||
                (b.costoMensualUsd ?? 0) - (a.costoMensualUsd ?? 0),
        );

        const payload = {
            mock: false,
            revisadoEl: CATALOGO_REVISADO_EL,
            umbrales: { critico: DIAS_CRITICO, proximo: DIAS_PROXIMO },
            resources: recursos,
            resumen: resumir(recursos),
        };
        await redis.set(clave, JSON.stringify(payload), "EX", TTL_SEGUNDOS).catch(() => undefined);
        return NextResponse.json(payload);
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        console.error("[governance/lifecycle] GET error:", e);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

function vacio() {
    return {
        porVentana: { retirado: 0, critico: 0, proximo: 0, soportado: 0, "sin-datos": 0 },
        costoEnRiesgoUsd: 0,
        recursosSinCosto: 0,
    };
}

function resumir(recursos: RecursoConCicloDeVida[]) {
    const r = vacio();
    for (const x of recursos) {
        r.porVentana[x.ventana] += 1;
        // "En riesgo" es lo retirado y lo que vence dentro del año: es el
        // número que entra en una conversación de presupuesto.
        if (x.ventana === "retirado" || x.ventana === "critico" || x.ventana === "proximo") {
            if (x.costoMensualUsd === null) r.recursosSinCosto += 1;
            else r.costoEnRiesgoUsd += x.costoMensualUsd;
        }
    }
    r.costoEnRiesgoUsd = Number(r.costoEnRiesgoUsd.toFixed(2));
    return r;
}
