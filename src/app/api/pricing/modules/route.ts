import { NextResponse } from "next/server";
import { getModulePrices } from "@/services/paddlePrices.service";

/**
 * GET /api/pricing/modules — precios de lista y pases de los módulos/add-ons.
 *
 * Pública y sin auth a propósito, tal cual /api/pricing/plans.
 * No expone información sensible y permite que las vistas y componentes
 * consulten los precios reales cobrados por Paddle.
 *
 * Si Paddle no responde, devuelve las tarifas base de fallback de ADDON_CATALOG
 * indicando source: "catalog".
 */
export async function GET() {
    const desdePaddle = await getModulePrices();

    return NextResponse.json(
        { success: true, source: desdePaddle.source, modules: desdePaddle.modules },
        { headers: { "Cache-Control": "public, max-age=600, stale-while-revalidate=3600" } }
    );
}
