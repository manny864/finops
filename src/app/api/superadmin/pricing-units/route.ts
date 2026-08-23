/**
 * API Route para el Catálogo de Unidades de Precio (SuperAdmin).
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import {
    getPricingUnitsCatalog,
    testNormalization,
    reseedPricingUnitsCatalog,
} from "@/services/pricingUnitsNormalizer.service";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";
        const testUom = searchParams.get("test");
        const testQty = searchParams.get("qty");

        if (!isMock) {
            await requireSuperAdmin(request);
        }

        if (testUom) {
            const qty = testQty ? parseFloat(testQty) : 1;
            const testResult = await testNormalization({ unitOfMeasure: testUom, quantity: qty });
            return NextResponse.json({
                success: true,
                test: {
                    uom_raw: testResult.originalUom,
                    qty: testResult.originalQuantity,
                    normalized_qty: testResult.normalizedQuantity,
                    base_unit: testResult.baseUnit,
                    display: testResult.displayUnit,
                    category: testResult.category,
                    inferred: testResult.inferred,
                },
            });
        }

        const catalog = await getPricingUnitsCatalog(isMock);
        return NextResponse.json(catalog);
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";

        if (!isMock) {
            await requireSuperAdmin(request);
        }

        const result = await reseedPricingUnitsCatalog(isMock);
        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
