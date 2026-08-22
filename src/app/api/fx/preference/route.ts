import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { getUserDisplayCurrency, setUserDisplayCurrency, isSupportedCurrency, SUPPORTED_CURRENCIES } from "@/lib/fx";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });

        const identity = await requireTenantAccess(request, tenantId);
        const oid = identity.claims.oid || identity.email || "";
        const currency = await getUserDisplayCurrency(tenantId, oid);
        return NextResponse.json({ success: true, currency, supported: SUPPORTED_CURRENCIES });
    } catch (err) {
        if (err instanceof AuthError) return NextResponse.json({ success: false, error: errorMessage(err) }, { status: errorStatus(err) });
        return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId, currency } = body as { tenantId?: string; currency?: string };
        if (!tenantId || !currency) return NextResponse.json({ success: false, error: "Falta tenantId o currency" }, { status: 400 });
        if (!isSupportedCurrency(currency)) return NextResponse.json({ success: false, error: `Currency no soportada: ${currency}` }, { status: 400 });

        const identity = await requireTenantAccess(request, tenantId);
        const oid = identity.claims.oid || identity.email || "";
        if (!oid) return NextResponse.json({ success: false, error: "Identidad sin OID" }, { status: 400 });

        await setUserDisplayCurrency(tenantId, oid, currency);
        return NextResponse.json({ success: true, currency });
    } catch (err) {
        if (err instanceof AuthError) return NextResponse.json({ success: false, error: errorMessage(err) }, { status: errorStatus(err) });
        return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 500 });
    }
}
