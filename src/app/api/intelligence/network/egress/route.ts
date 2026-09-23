/**
 * GET /api/intelligence/network/egress — mapa de transferencia de datos (MEJ-19).
 *
 * El hermano `service-cost-v2` desglosa el costo de los RECURSOS de red; éste,
 * el del TRÁFICO, que es lo que no se veía en ningún lado.
 *
 * El mock se resuelve ANTES del auth y la ruta NO se intercepta en
 * `TenantProvider`: es el patrón al que MEJ-03 llegó después de que una copia
 * del payload en `mockData.ts` se quedara en un contrato viejo y vaciara una
 * pantalla entera de la demo sin que nada fallara. Una ruta nueva no tiene por
 * qué nacer con esa deuda.
 */
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { errorMessage, errorStatus, serverError } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";
import { getMapaEgress, type MapaEgress } from "@/services/networkEgress.service";

export const dynamic = "force-dynamic";

/** Techo de la ventana: más de un año de meters diarios no entra en una pantalla. */
const MAX_DIAS = 365;

/**
 * Demo calibrada para que se vea lo que la pantalla existe para mostrar: el
 * inter-AZ y el NAT Gateway pesando juntos casi tanto como la salida a
 * internet, que es el hallazgo típico y el que nadie mira. Los nombres de
 * medidor son los reales de la Retail Prices API.
 */
function datosDemo(dias: number): MapaEgress {
    const flujos = [
        { categoria: "internet" as const, region: "eastus", medidor: "Standard Data Transfer Out", costoUsd: 412.8, gigabytes: 4703.0 },
        { categoria: "entre_zonas" as const, region: "eastus", medidor: "Standard Inter-Availability Zone Data Transfer Out", costoUsd: 268.4, gigabytes: 26840.0 },
        { categoria: "nat_gateway" as const, region: "eastus", medidor: "Standard Data Processed", costoUsd: 121.5, gigabytes: 2700.0 },
        { categoria: "entre_regiones" as const, region: "westus2", medidor: "Intra Continent Data Transfer Out", costoUsd: 74.2, gigabytes: 3710.0 },
        { categoria: "entre_continentes" as const, region: "westeurope", medidor: "Inter Continent Data Transfer Out - NAM or EU To Any", costoUsd: 38.9, gigabytes: 778.0 },
        { categoria: "entrada" as const, region: "eastus", medidor: "Standard Data Transfer In", costoUsd: 0.0, gigabytes: 9120.0 },
    ];
    const porCategoria = flujos.map((f) => ({ categoria: f.categoria, costoUsd: f.costoUsd, gigabytes: f.gigabytes }));
    return {
        flujos,
        porCategoria,
        costoTotalUsd: 915.8,
        costoSalidaUsd: 915.8,
        dias,
        gigabytesParciales: false,
    };
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const pedidos = Number(searchParams.get("dias"));
        const dias = Number.isFinite(pedidos) && pedidos > 0 ? Math.min(Math.trunc(pedidos), MAX_DIAS) : 30;

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ ...datosDemo(dias), mock: true });
        }

        await requireTenantAccess(request, tenantId);

        return NextResponse.json(await getMapaEgress(tenantId, dias));
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        }
        console.error("[/api/intelligence/network/egress]", errorMessage(e));
        return serverError(e);
    }
}
