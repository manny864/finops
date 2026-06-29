import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { isMockTenant } from "@/lib/mockData";

const MOCK_PAYLOAD = {
    success: true,
    mock: true,
    items: [
        {
            resourceId: "/subscriptions/sub-1/resourceGroups/rg-network/providers/Microsoft.Network/applicationGateways/agw-prod",
            resourceName: "agw-prod",
            resourceType: "applicationGateway",
            resourceGroup: "rg-network",
            subscriptionId: "sub-1",
            monthlyCost: 420.00,
            reason: "No backend addresses configured",
            daysIdle: 45,
        },
        {
            resourceId: "/subscriptions/sub-2/resourceGroups/rg-shared/providers/Microsoft.Network/loadBalancers/lb-internal",
            resourceName: "lb-internal",
            resourceType: "loadBalancer",
            resourceGroup: "rg-shared",
            subscriptionId: "sub-2",
            monthlyCost: 18.25,
            reason: "Zero traffic in 30 days",
            daysIdle: 60,
        },
    ],
    totalMonthlyWaste: 438.25,
};

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
        }
        const decoded = jwt.decode(authHeader.split(" ")[1]) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }
        const email = (decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "").toLowerCase();
        const isSuperAdmin = email.endsWith("@cscloudsolutions.com.ar");
        if (decoded.tid !== tenantId && !isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });
        }

        // Real implementation is stubbed — ARG query would go here.
        // Returning mock payload with mock:true for all tenants until ARG integration is scoped.
        return NextResponse.json(MOCK_PAYLOAD);
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Error interno" }, { status: 500 });
    }
}
