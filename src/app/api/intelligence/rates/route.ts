import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { getReservationRecommendations } from "@/services/rateService";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const subscriptionId = searchParams.get('subscriptionId');
        
        const scopeType = (searchParams.get('scopeType') as 'Single' | 'Shared') || 'Single';
        const lookBackPeriod = (searchParams.get('lookBackPeriod') as 'Last7Days' | 'Last30Days' | 'Last60Days') || 'Last30Days';

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId, subscriptionId" }, { status: 400 });
        }

        const credential = await getAzureCredential(tenantId);
        
        const recommendations = await getReservationRecommendations(
            credential, 
            subscriptionId, 
            scopeType, 
            lookBackPeriod
        );

        return NextResponse.json({ recommendations });
    } catch (error: any) {
        console.error("Rates Fetch Error:", error);
        return NextResponse.json({ error: "Fallo al obtener recomendaciones de tarifas.", details: error.message }, { status: 500 });
    }
}
