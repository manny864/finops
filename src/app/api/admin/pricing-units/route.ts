import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { normalizeUnit, resetCache, getCacheSize } from "@/lib/pricingUnits";

/**
 * GET /api/admin/pricing-units?test=<uom>&qty=<n>
 * Inspecciona la tabla y opcionalmente prueba la normalización.
 * Super-admin only.
 */
export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        await requireSuperAdmin(request);

        const { searchParams } = new URL(request.url);
        const test = searchParams.get("test");
        const qty = searchParams.get("qty") || "1";

        if (test) {
            const result = await normalizeUnit(test, qty);
            return NextResponse.json({
                success: true,
                input: { uom: test, qty },
                output: {
                    baseUnit: result.baseUnit,
                    normalizedQty: result.normalizedQty.toString(),
                    display: result.display,
                    category: result.category,
                    inferred: result.inferred,
                },
            });
        }

        const [rows]: any = await pool.query(
            "SELECT uom_raw, block_size, base_unit, display_unit, category FROM PricingUnits ORDER BY category, uom_raw LIMIT 500"
        );
        return NextResponse.json({
            success: true,
            cacheSize: await getCacheSize(),
            total: rows.length,
            items: rows,
        });
    } catch (e: any) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        return NextResponse.json({ error: e.message || "Error" }, { status: 500 });
    }
}

/**
 * POST /api/admin/pricing-units — refresca cache + re-seed desde el dataset embebido.
 */
export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();
        await requireSuperAdmin(request);
        const { seedPricingUnits } = await import("../../../../../scripts/seed-pricing-units");
        const result = await seedPricingUnits(true);
        resetCache();
        return NextResponse.json({ success: true, ...result });
    } catch (e: any) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        return NextResponse.json({ error: e.message || "Error" }, { status: 500 });
    }
}
