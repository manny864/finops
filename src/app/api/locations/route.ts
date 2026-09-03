import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { isMockTenant } from "@/lib/mockData";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const subscriptionId = searchParams.get('subscriptionId');

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId, subscriptionId" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ['Admin', 'Owner', 'Reader', 'Colaborador']);

        // Tenant demo: sin esto `getAzureCredential` falla y el selector de
        // regiones del modal de crear Resource Group queda vacío. El catálogo
        // de regiones no depende del tenant, así que va inline en vez de
        // mockData: no es dato FinOps simulado, es una lista estática.
        if (isMockTenant(tenantId)) {
            return NextResponse.json({
                locations: [
                    { name: "eastus", displayName: "East US" },
                    { name: "eastus2", displayName: "East US 2" },
                    { name: "westus2", displayName: "West US 2" },
                    { name: "centralus", displayName: "Central US" },
                    { name: "brazilsouth", displayName: "Brazil South" },
                    { name: "westeurope", displayName: "West Europe" },
                    { name: "northeurope", displayName: "North Europe" },
                ],
            });
        }

        const credential = await getAzureCredential(tenantId);
        const tokenResponse = await credential.getToken("https://management.azure.com/.default");
        
        const res = await fetch(`https://management.azure.com/subscriptions/${subscriptionId}/locations?api-version=2022-12-01`, {
            headers: {
                'Authorization': `Bearer ${tokenResponse.token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!res.ok) {
            throw new Error(`Error fetching locations: ${res.statusText}`);
        }

        const data = await res.json();
        const locations = [];
        
        for (const loc of data.value || []) {
            // Azure devuelve muchas regiones lógicas. Es útil filtrar por 'Region' para tener solo físicas si se desea, o devolver todas.
            if (loc.metadata?.regionType === 'Physical') {
                locations.push({
                    name: loc.name,
                    displayName: loc.displayName
                });
            }
        }

        // Si physical es muy restrictivo y no devuelve, devolvemos todas:
        if (locations.length === 0) {
            for (const loc of data.value || []) {
                locations.push({
                    name: loc.name,
                    displayName: loc.displayName
                });
            }
        }

        return NextResponse.json({ locations });
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        console.error("Locations Fetch Error:", error);
        return NextResponse.json({ error: "Fallo al obtener locations." }, { status: 500 });
    }
}
