import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { getNetworkEgressCosts } from "@/services/networkCostService";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const subscriptionId = searchParams.get('subscriptionId');

        if (!subscriptionId) {
            return NextResponse.json({ error: "Falta subscriptionId" }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
        }

        const tenantId = request.headers.get("x-tenant-id") || decoded.tid;
        const credential = await getAzureCredential(tenantId);
        const rawCosts = await getNetworkEgressCosts(credential, subscriptionId);

        // Process CostManagement Data
        const rows = rawCosts.rows || [];
        const columns = rawCosts.columns || [];
        
        let processedData: any[] = [];
        
        if (rows.length > 0) {
            const costIndex = columns.findIndex(c => c.name === "PreTaxCost");
            const subcatIndex = columns.findIndex(c => c.name === "MeterSubCategory");
            const rgIndex = columns.findIndex(c => c.name === "ResourceGroup");

            processedData = rows.map(row => ({
                cost: row[costIndex],
                subCategory: row[subcatIndex],
                resourceGroup: row[rgIndex]
            })).filter(item => item.subCategory && item.subCategory.toLowerCase().includes('bandwidth') || item.subCategory?.toLowerCase().includes('egress') || item.cost > 0);
        } else {
            // Provide Mock data if empty for demo purposes of the UI
            processedData = [
                { cost: 1250.45, subCategory: "Bandwidth - Inter-VNet", resourceGroup: "rg-core-network" },
                { cost: 890.20, subCategory: "Bandwidth - Internet Egress", resourceGroup: "rg-public-web" },
                { cost: 450.00, subCategory: "ExpressRoute Egress", resourceGroup: "rg-onprem-hybrid" },
                { cost: 210.50, subCategory: "Bandwidth - Internet Egress", resourceGroup: "rg-dev-sandbox" },
                { cost: 110.00, subCategory: "Bandwidth - Cross-Region", resourceGroup: "rg-dr-site" }
            ];
        }

        return NextResponse.json({ data: processedData });

    } catch (error: any) {
        console.error("Network API Error:", error);
        let errorCode = "ERR_INTERNAL_SERVER";
        let status = 500;
        
        const msg = (error.message || "").toLowerCase();
        if (error.code === "AuthorizationFailed" || error.code === "ScopeNotFound" || msg.includes("authorization") || msg.includes("linkedinvalidpropertyid") || msg.includes("subscriptionnotfound")) {
            errorCode = "ERR_NETWORK_ACCESS_DENIED";
            status = 403;
        }
        return NextResponse.json({ error: errorCode, message: error.message }, { status });
    }
}
