import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { calculateReservationSavings } from "@/services/rateService";
import { getReservationRecommendations } from "@/services/reservationService";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const subscriptionId = searchParams.get('subscriptionId');

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId, subscriptionId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        const cacheKey = `rates:${tenantId}:${subscriptionId}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
            let credential;
            try {
                credential = await getAzureCredential(tenantId);
            } catch (credErr) {
                const msg = errorMessage(credErr) || "";
                throw new Error(
                    /credenciales|credentials|client_id|client_secret/i.test(msg)
                        ? "El tenant no tiene credenciales de Service Principal configuradas. Ingresá clientId/clientSecret en Admin → Configuración."
                        : `No se pudieron obtener credenciales de Azure: ${msg}`
                );
            }

            let recommendations: any[] = [];
            try {
                recommendations = await calculateReservationSavings(credential, subscriptionId);
            } catch (err) {
                const msg = errorMessage(err) || "";
                if (/AuthorizationFailed|Forbidden|403/i.test(msg)) {
                    throw new Error("El Service Principal no tiene permisos de Reader sobre Resource Graph. Asigná el rol 'Reader' a nivel de suscripción.");
                }
                if (/timeout|ETIMEDOUT|ECONNRESET/i.test(msg)) {
                    throw new Error("Azure Resource Graph tardó demasiado en responder. Reintentá en unos segundos.");
                }
                throw new Error(`Resource Graph falló: ${msg}`);
            }

            let reservations: any[] = [];
            try {
                reservations = await getReservationRecommendations(credential, subscriptionId, tenantId);
            } catch (error) {
                console.error("[Rates API] Error en recomendador de reservas (atrapado de forma segura):", error);
            }

            return { recommendations, reservations };
        }, 3600);

        return NextResponse.json(data);
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        }
        console.error("Rates Fetch Error:", error);
        return NextResponse.json(
            { error: errorMessage(error) || "Fallo al obtener recomendaciones de tarifas.", details: errorMessage(error) },
            { status: 500 }
        );
    }
}
