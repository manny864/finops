import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { getWithCache } from "@/lib/cache";
import { isMockTenant } from "@/lib/mockData";
import { hasAccess } from "@/lib/tierLogic";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        const subscriptionId = request.nextUrl.searchParams.get('subscriptionId');
        const userTier = request.nextUrl.searchParams.get('tier') || 'Essential';

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        if (!hasAccess(userTier, 'Enterprise')) {
            return NextResponse.json({ error: "Funcionalidad requiere plan Enterprise o superior." }, { status: 403 });
        }

        if (isMockTenant(tenantId)) {
            // Retornar lista de políticas de prueba simulando las de Azure
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

        // Fetch real policy definitions from Azure
        const cacheKey = `azure-policy-definitions-v7:${tenantId}`;
        const realData = await getWithCache(cacheKey, async () => {
            const credential = await getAzureCredential(tenantId);
            const token = await credential.getToken("https://management.azure.com/.default");
            
            // La forma correcta de obtener Built-In policies globales es filtrando por policyType='BuiltIn'
            const url = `https://management.azure.com/providers/Microsoft.Authorization/policyDefinitions?api-version=2020-09-01&$filter=policyType%20eq%20'BuiltIn'`;
                
            const fetchRes = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token.token}` }
            });

            if (!fetchRes.ok) {
                const errorText = await fetchRes.text();
                throw new Error(`Azure Error ${fetchRes.status}: URL=${url} - Body=${errorText}`);
            }

            const data = await fetchRes.json();
            
            if (!data.value || !Array.isArray(data.value)) {
                console.error("Respuesta sin 'value':", data);
                throw new Error("Azure devolvió un formato inválido.");
            }
            if (data.value.length === 0) {
                throw new Error("Azure devolvió 0 políticas. Verifica que tengas permisos de lectura en el Tenant Root Group.");
            }

            // Filtrar y mapear para reducir payload
            return data.value.map((p: any) => ({
                id: p.id,
                displayName: p.properties?.displayName || p.name,
                description: p.properties?.description || '',
                parameters: p.properties?.parameters || {}
            }));
        }, 86400); // Cachear por 24 horas (no cambian frecuentemente)

        return NextResponse.json({ success: true, data: realData });

    } catch (error: any) {
        require('fs').appendFileSync('/tmp/finops_azure_error.log', new Date().toISOString() + ' - ' + error.message + '\n');
        return NextResponse.json({ error: error.message, details: error.message }, { status: 500 });
    }
}
