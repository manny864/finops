import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getUserSignInHistory } from "@/services/m365UserActivity.service";

/**
 * GET /api/m365/user-activity/signin-history?tenantId=X&userId=Y
 *
 * Returns the last 10 sign-in events for a specific user.
 * Used by the user detail drawer in the "Actividad de Usuarios" tab.
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = request.nextUrl;
        const tenantId = searchParams.get("tenantId");
        const userId = searchParams.get("userId");

        if (!tenantId || !userId) {
            return NextResponse.json({ error: "Faltan tenantId o userId" }, { status: 400 });
        }

        // CRITICAL: isMockTenant check BEFORE requireTenantAccess
        if (isMockTenant(tenantId)) {
            return NextResponse.json({
                success: true,
                mock: true,
                entries: generateMockSignInHistory(),
            });
        }

        await requireTenantAccess(request, tenantId);

        const entries = await getUserSignInHistory(tenantId, userId);
        return NextResponse.json({ success: true, mock: false, entries });
    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("[m365/signin-history] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

function generateMockSignInHistory() {
    const apps = [
        "Microsoft Teams", "Office 365 SharePoint Online", "Microsoft Azure Portal",
        "Office 365 Exchange Online", "Microsoft Graph Explorer", "My Apps",
    ];
    const locations = [
        { city: "Buenos Aires", state: "CABA", countryOrRegion: "AR" },
        { city: "São Paulo", state: "SP", countryOrRegion: "BR" },
        { city: "Mexico City", state: "CDMX", countryOrRegion: "MX" },
        { city: null, state: null, countryOrRegion: "US" },
    ];
    const now = Date.now();
    return Array.from({ length: 10 }, (_, i) => ({
        createdDateTime: new Date(now - i * 3600000 * 8).toISOString(),
        ipAddress: `203.0.113.${40 + i}`,
        appDisplayName: apps[i % apps.length],
        location: locations[i % locations.length],
        status: { errorCode: i === 7 ? 50057 : 0, failureReason: i === 7 ? "User account is disabled." : undefined },
        isInteractive: i !== 3,
    }));
}