/**
 * GET /api/intelligence/network/capacity — MEJ-19 criterio 3.
 *
 * Ancho de banda contratado contra el P95 realmente usado, en circuitos
 * ExpressRoute y gateways de VPN. Por debajo del 15% el enlace está
 * sobredimensionado y se puede bajar de SKU.
 *
 * ES OTRA FUENTE que el resto de la pantalla de redes: acá no hay costo, hay
 * métricas de Azure Monitor. Por eso no comparte nada con `network/egress`
 * salvo el hub donde se muestran.
 *
 * RBAC: requireTenantAccess. Tier: Business (routeTiers).
 */

import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { redis } from "@/lib/redis";
import { listResourcesByTypes } from "@/app/api/intelligence/databases/diagnosticsShared";
import {
    CATALOGO_RED_REVISADO_EL, FUENTE_ER, FUENTE_VPN, UMBRAL_SUBUTILIZADO_PCT,
    capacidadDeCircuito, evaluarEnlace, percentil, throughputDeVpn, type Veredicto,
} from "@/lib/networkCapacityCatalog";
import { errorMessage } from "@/lib/apiErrors";

const TIPO_ER = "microsoft.network/expressroutecircuits";
const TIPO_VNG = "microsoft.network/virtualnetworkgateways";
const CLAVE = (t: string) => `network:capacity:v1:${t}`;
const TTL = 60 * 60 * 12;
/** Ventana de medición. 30 días es lo que hace creíble un P95. */
const DIAS = 30;

interface Enlace {
    id: string;
    name: string;
    tipo: "ExpressRoute" | "VPN Gateway";
    sku: string | null;
    resourceGroup?: string;
    location?: string;
    capacidadMbps: number | null;
    p95Mbps: number | null;
    utilizacionPct: number | null;
    veredicto: Veredicto;
    motivo: string | null;
    fuente: string;
}

/**
 * Serie de una métrica, ya en Mbps.
 *
 * `factorAMbps` no es cosmético: el circuito informa en **BitsPerSecond** y el
 * gateway en **BytesPerSecond**. Sin el factor, el gateway saldría ocho veces
 * más ocioso de lo que está — y hacia el lado que recomienda achicar.
 */
async function serieEnMbps(
    resourceId: string, metricas: string[], factorAMbps: number, headers: Record<string, string>, timespan: string,
): Promise<number[][]> {
    const query = new URLSearchParams({
        "api-version": "2018-01-01",
        metricnames: metricas.join(","),
        timespan,
        // Grano horario: 30 días al minuto son 43.200 puntos por métrica y la
        // API los pagina. Con muestras horarias el P95 es "la hora 95 de cada
        // 100", que es la pregunta correcta para dimensionar un enlace.
        interval: "PT1H",
        aggregation: "Average",
    });
    const res = await fetch(`https://management.azure.com${resourceId}/providers/Microsoft.Insights/metrics?${query}`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.value || []).map((m: any) =>
        (m.timeseries || []).flatMap((s: any) =>
            (s.data || []).map((p: any) => Number(p.average)).filter((n: number) => Number.isFinite(n))
        ).map((v: number) => v * factorAMbps)
    );
}

export async function GET(request: NextRequest) {
    try {
        const sp = request.nextUrl.searchParams;
        const tenantId = sp.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        // EL MOCK VA ANTES DEL AUTH, igual que en `network/egress`. Es el
        // patrón al que llegó MEJ-03: un tenant de demo no tiene sesión real, y
        // con el auth primero la pantalla contesta 401 y se ve rota. Los datos
        // de demo son fabricados, así que no hay nada que proteger.
        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("network_capacity", tenantId));
        }

        await requireTenantAccess(request, tenantId);

        const clave = CLAVE(tenantId);
        if (sp.get("bust") === "1") await redis.del(clave).catch(() => undefined);
        else {
            const cacheado = await redis.get(clave).catch(() => null);
            if (cacheado) return NextResponse.json(JSON.parse(cacheado));
        }

        const credential = await getAzureCredential(tenantId);
        const subs = await getSubscriptionsForTenant(tenantId, credential);
        if (subs.length === 0) {
            return NextResponse.json({ success: true, revisadoEl: CATALOGO_RED_REVISADO_EL, enlaces: [], resumen: vacio() });
        }

        const recursos = await listResourcesByTypes(tenantId, [TIPO_ER, TIPO_VNG], subs, credential);
        const token = await credential.getToken("https://management.azure.com/.default");
        const headers = { Authorization: `Bearer ${token.token}` };
        const fin = new Date();
        const timespan = `${new Date(fin.getTime() - DIAS * 86_400_000).toISOString()}/${fin.toISOString()}`;

        const enlaces: Enlace[] = [];
        for (const r of recursos) {
            const props = (r.properties || {}) as any;
            const esER = r.type === TIPO_ER;

            // Un `virtualNetworkGateways` puede ser de ExpressRoute y no de VPN:
            // no tiene throughput de VPN y su ancho de banda no significa lo
            // mismo. Se saltea en vez de evaluarlo con el catálogo equivocado.
            if (!esER && String(props?.gatewayType || "").toLowerCase() !== "vpn") continue;

            const capacidad = esER
                ? capacidadDeCircuito(props)
                : throughputDeVpn(props?.vpnGatewayGeneration, r.skuName ?? props?.sku?.name);

            let p95: number | null = null;
            try {
                const series = esER
                    // bits/s → Mbps
                    ? await serieEnMbps(r.id, ["BitsInPerSecond", "BitsOutPerSecond"], 1 / 1e6, headers, timespan)
                    // bytes/s → Mbps: ×8 y después /1e6
                    : await serieEnMbps(r.id, ["AverageBandwidth"], 8 / 1e6, headers, timespan);

                // Por DIRECCIÓN, no la suma: un circuito soporta su ancho de
                // banda en cada sentido. Sumarlos inflaría la utilización y
                // taparía justamente los que están de más.
                const porSerie = series.map((s) => percentil(s, 95)).filter((x): x is number => x !== null);
                p95 = porSerie.length > 0 ? Math.max(...porSerie) : null;
            } catch (e) {
                console.warn(`[network/capacity] métricas de ${r.name}:`, errorMessage(e));
            }

            const ev = evaluarEnlace(capacidad, p95);
            enlaces.push({
                id: r.id, name: r.name,
                tipo: esER ? "ExpressRoute" : "VPN Gateway",
                sku: (r.skuName ?? props?.sku?.name ?? null) as string | null,
                resourceGroup: r.resourceGroup, location: r.location,
                capacidadMbps: capacidad,
                p95Mbps: p95 === null ? null : Number(p95.toFixed(2)),
                utilizacionPct: ev.utilizacionPct,
                veredicto: ev.veredicto,
                motivo: ev.motivo,
                fuente: esER ? FUENTE_ER : FUENTE_VPN,
            });
        }

        const peso: Record<Veredicto, number> = { subutilizado: 0, "sin-datos": 1, "sin-capacidad": 2, ajustado: 3 };
        enlaces.sort((a, b) => peso[a.veredicto] - peso[b.veredicto] || (a.utilizacionPct ?? 0) - (b.utilizacionPct ?? 0));

        const payload = {
            success: true,
            revisadoEl: CATALOGO_RED_REVISADO_EL,
            ventanaDias: DIAS,
            umbralPct: UMBRAL_SUBUTILIZADO_PCT,
            enlaces,
            resumen: resumir(enlaces),
        };
        await redis.set(clave, JSON.stringify(payload), "EX", TTL).catch(() => undefined);
        return NextResponse.json(payload);
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[network/capacity] GET:", errorMessage(e));
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

function vacio() {
    return { subutilizado: 0, ajustado: 0, "sin-datos": 0, "sin-capacidad": 0, sinMedir: 0 };
}

function resumir(enlaces: Enlace[]) {
    const r = vacio();
    for (const e of enlaces) r[e.veredicto] += 1;
    // Los que no se pudieron medir se cuentan aparte y NO como "todo bien":
    // un enlace sin métricas puede estar saturado o vacío, y no lo sabemos.
    r.sinMedir = r["sin-datos"] + r["sin-capacidad"];
    return r;
}
