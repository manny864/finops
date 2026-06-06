import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const subscriptionId = searchParams.get('subscriptionId');

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId, subscriptionId" }, { status: 400 });
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
    } catch (error: any) {
        console.error("Locations Fetch Error:", error);
        return NextResponse.json({ error: "Fallo al obtener locations." }, { status: 500 });
    }
}
