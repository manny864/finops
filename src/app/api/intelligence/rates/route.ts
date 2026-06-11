import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { calculateReservationSavings } from "@/services/rateService";
import { getReservationRecommendations } from "@/services/reservationService";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const subscriptionId = searchParams.get('subscriptionId');

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId, subscriptionId" }, { status: 400 });
        }

        const credential = await getAzureCredential(tenantId);
        const recommendations = await calculateReservationSavings(credential, subscriptionId);

        let reservations: any[] = [];
        try {
            reservations = await getReservationRecommendations(credential, subscriptionId);
        } catch (error: any) {
            console.error("[Rates API] Error en recomendador de reservas (atrapado de forma segura):", error);
        }

        return NextResponse.json({ recommendations, reservations });
    } catch (error: any) {
        console.error("Rates Fetch Error:", error);
        return NextResponse.json({ error: "Fallo al obtener recomendaciones de tarifas.", details: error.message }, { status: 500 });
    }
}
