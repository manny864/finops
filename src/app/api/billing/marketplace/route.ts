import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { ADDON_CATALOG } from "@/lib/addonCatalog";
import { TenantAddonsService } from "@/services/tenantAddons.service";
import pool from "@/modules/storage/db";
import { normalizeTier } from "@/lib/tierLogic";

import { getModulePrices } from "@/services/paddlePrices.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/marketplace
 * Retorna el catálogo completo de add-ons y capacidades a la carta con precios
 * sincronizados desde Paddle Billing (o fallback al catálogo estático),
 * junto con el estado de los add-ons vigentes para el tenant.
 */
export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro tenantId" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner", "Viewer", "Contributor"]);

        let currentTier = "Professional";
        try {
            const [rows]: any = await pool.query(
                `SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1`,
                [tenantId]
            );
            if (rows?.[0]?.tier) {
                currentTier = normalizeTier(rows[0].tier) || "Professional";
            }
        } catch {
            // Si la base no está disponible en mock mode, default a Professional
        }

        const [activeAddons, modulePricesResult] = await Promise.all([
            TenantAddonsService.getActiveAddons(tenantId),
            getModulePrices(),
        ]);

        const catalog = Object.values(ADDON_CATALOG).map((item) => {
            const live = modulePricesResult.modules[item.key];
            if (!live) return item;
            return {
                ...item,
                currency: live.currency,
                basePriceUSD: {
                    monthly: live.monthly,
                    pass1m: live.pass1m,
                    pass3m: live.pass3m,
                    pass6m: live.pass6m,
                    pass9m: live.pass9m,
                    pass12m: live.pass12m,
                },
            };
        });

        return NextResponse.json({
            success: true,
            source: modulePricesResult.source,
            tenantId,
            currentTier,
            catalog,
            activeAddons,
        });
    } catch (err) {
        return NextResponse.json(
            { error: errorMessage(err) },
            { status: errorStatus(err) }
        );
    }
}

/**
 * POST /api/billing/marketplace
 * Permite adquirir un add-on recurrente o pase temporal a la carta (1m, 3m, 6m, 9m).
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, addonKey, addonType, months = 1 } = body;

        if (!tenantId || !addonKey) {
            return NextResponse.json(
                { error: "tenantId y addonKey son requeridos" },
                { status: 400 }
            );
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        const product = ADDON_CATALOG[addonKey];
        if (!product) {
            return NextResponse.json(
                { error: `El add-on '${addonKey}' no existe en el catálogo.` },
                { status: 404 }
            );
        }

        const validMonths = [1, 3, 6, 9, 12];
        const selectedMonths = validMonths.includes(Number(months)) ? Number(months) : 1;
        const type = addonType === "recurring" ? "recurring" : "pass";

        const purchased = await TenantAddonsService.purchaseAddon(
            tenantId,
            addonKey,
            type,
            selectedMonths
        );

        return NextResponse.json({
            success: true,
            addon: purchased,
            message: `Add-on '${product.name}' activado con éxito.`,
        });
    } catch (err) {
        return NextResponse.json(
            { error: errorMessage(err) },
            { status: errorStatus(err) }
        );
    }
}
