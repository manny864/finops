import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { ADDON_CATALOG, isAddonVisibleForTier, priceIdForAddon, resolveAddonForTier } from "@/lib/addonCatalog";
import { customDataFirmado } from "@/lib/checkoutBinding";
import { normalizeTier } from "@/lib/tierLogic";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";

export const dynamic = "force-dynamic";

const MESES_VALIDOS = [1, 3, 6, 9, 12];

/**
 * POST /api/billing/marketplace/checkout
 * Datos para abrir el checkout de Paddle de un add-on: el precio lo elige el SERVIDOR según el módulo, el tipo y los meses
 * pedidos, y el `custom_data` va FIRMADO (tenant + precio + módulo + tipo + meses). El webhook sólo acredita lo que
 * verifica contra esa firma, así que quien abre su propio checkout con Paddle.js no puede pagar un mes y llevarse doce, ni
 * acreditar a un tenant ajeno (ver `checkoutBinding.ts`).
 */
export async function POST(request: NextRequest) {
    try {
        const { tenantId, addonKey, addonType, months = 1 } = await request.json();
        if (!tenantId || !addonKey) {
            return NextResponse.json({ error: "tenantId y addonKey son requeridos" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ error: "Un tenant demo no paga: se activa desde /api/billing/marketplace." }, { status: 400 });
        }

        const base = ADDON_CATALOG[addonKey];
        if (!base) {
            return NextResponse.json({ error: `El add-on '${addonKey}' no existe en el catálogo.` }, { status: 404 });
        }
        if (base.fulfilledBy === "capacity") {
            return NextResponse.json({ error: "Este add-on no se compra por el checkout: se contrata sobre la suscripción existente." }, { status: 400 });
        }
        if (!MESES_VALIDOS.includes(Number(months))) {
            return NextResponse.json({ error: "months debe ser 1, 3, 6, 9 o 12" }, { status: 400 });
        }

        const [rows]: any = await pool.query("SELECT tier, marketplace_source FROM Tenants WHERE tenant_id = ? LIMIT 1", [tenantId]);
        if (!Array.isArray(rows) || rows.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }
        if (rows[0].marketplace_source === "azure_marketplace") {
            return NextResponse.json({ error: "Este tenant factura por el marketplace de Azure." }, { status: 403 });
        }

        const tier = normalizeTier(rows[0].tier) || "Professional";
        const product = resolveAddonForTier(base, tier);
        if (!isAddonVisibleForTier(product, tier)) {
            return NextResponse.json({ error: "Este add-on no está disponible para el plan del tenant." }, { status: 403 });
        }

        const recurring = addonType === "recurring";
        const priceId = priceIdForAddon(product, recurring, Number(months));
        if (!priceId) {
            return NextResponse.json({ error: "El Price ID no está configurado para este período." }, { status: 400 });
        }

        return NextResponse.json({
            success: true,
            priceId,
            customData: customDataFirmado({
                tenantId,
                priceId,
                addonKey,
                addonType: recurring ? "recurring" : "pass",
                months: Number(months),
            }),
        });
    } catch (err) {
        return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
    }
}
