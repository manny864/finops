import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { getWithCache } from "@/lib/cache";
import { isMockTenant } from "@/lib/mockData";
import { hasAccess } from "@/lib/tierLogic";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        const [rows] = await pool.query("SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1", [tenantId]);
        const userTier = (Array.isArray(rows) && rows.length > 0 ? (rows[0] as { tier?: string }).tier : null) || 'Essential';

        if (!hasAccess(userTier, 'Enterprise')) {
            return NextResponse.json({ error: "Funcionalidad requiere plan Enterprise o superior." }, { status: 403 });
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json({
                success: true,
                data: [
                    { id: "/providers/Microsoft.Authorization/policyDefinitions/mock-1", displayName: "Requiere Etiqueta Específica", description: "Fuerza la existencia de una etiqueta en los recursos.", parameters: { tagName: { type: "String", metadata: { displayName: "Tag Name", description: "Name of the tag to require" } } } },
                    { id: "/providers/Microsoft.Authorization/policyDefinitions/mock-2", displayName: "Allowed Locations", description: "Fuerza que los recursos solo se creen en ciertas regiones.", parameters: { listOfAllowedLocations: { type: "Array", metadata: { displayName: "Allowed locations", description: "The list of allowed locations for resources." } } } },
                    { id: "/providers/Microsoft.Authorization/policyDefinitions/mock-3", displayName: "Allowed Virtual Machine Size SKUs", description: "Restringe qué tamaños de VM se pueden crear.", parameters: { listOfAllowedSKUs: { type: "Array", metadata: { displayName: "Allowed Size SKUs" } } } },
                    { id: "/providers/Microsoft.Authorization/policyDefinitions/mock-4", displayName: "Storage Accounts must disable public network access", description: "Mejora la seguridad bloqueando el acceso público a Storage Accounts.", parameters: {} }
                ]
            });
        }

        const cacheKey = `azure-policy-definitions-v7:${tenantId}`;
        const realData = await getWithCache(cacheKey, async () => {
            const credential = await getAzureCredential(tenantId);
            const token = await credential.getToken("https://management.azure.com/.default");
            const url = `https://management.azure.com/providers/Microsoft.Authorization/policyDefinitions?api-version=2020-09-01&$filter=policyType%20eq%20'BuiltIn'`;

            const fetchRes = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token.token}` }
            });

            if (!fetchRes.ok) {
                console.error(`Azure policy definitions fetch ${fetchRes.status} for tenant ${tenantId}`);
                throw new Error(`Azure API error ${fetchRes.status}`);
            }

            const data = await fetchRes.json();
            if (!data.value || !Array.isArray(data.value)) {
                throw new Error("Azure response invalid");
            }
            if (data.value.length === 0) {
                throw new Error("No policies found");
            }

            return data.value.map((p: { id: string; name: string; properties?: { displayName?: string; description?: string; parameters?: unknown } }) => ({
                id: p.id,
                displayName: p.properties?.displayName || p.name,
                description: p.properties?.description || '',
                parameters: p.properties?.parameters || {}
            }));
        }, 86400);

        return NextResponse.json({ success: true, data: realData });

    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error('azure-policies error:', error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

