import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { deployFinOpsWorkbook } from "@/services/workbookService";
import { requireRequestIdentity, requireTenantRole, AuthError } from "@/lib/requestAuth";
import { bloqueoPorDelegacionDeLectura } from "@/lib/lighthouseAccess";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { subscriptionId, resourceGroupName, workbookType } = body;

        if (!subscriptionId || !resourceGroupName || !workbookType) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: subscriptionId, resourceGroupName o workbookType" }, { status: 400 });
        }

        const tmpIdentity = await requireRequestIdentity(request);
        const tenantId = tmpIdentity.tenantId;
        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        // Delegacion de solo lectura: el Workbook es un recurso de Azure (resources.beginCreateOrUpdateAndWait).
        const bloqueo = await bloqueoPorDelegacionDeLectura(tenantId);
        if (bloqueo) return bloqueo;

        const credential = await getAzureCredential(tenantId);
        const deploymentResult = await deployFinOpsWorkbook(credential, subscriptionId, resourceGroupName, workbookType);

        return NextResponse.json({ 
            success: true, 
            message: "Workbook desplegado exitosamente", 
            deploymentId: deploymentResult.id 
        });

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Workbook Deployment Error:", error);
        const err = error as { code?: string; body?: { error?: { code?: string; message?: string } }; statusCode?: number; details?: { message?: string }; message?: string };
        const azureCode = err?.code || err?.body?.error?.code || err?.statusCode;
        const azureMsg = err?.body?.error?.message || err?.details?.message || err?.message;
        const isAuthz = azureCode === 'AuthorizationFailed' || /AuthorizationFailed/i.test(azureMsg || '');
        const isProviderReg = azureCode === 'MissingSubscriptionRegistration' || azureCode === 'ProviderRegistrationTimeout'
            || /MissingSubscriptionRegistration/i.test(azureMsg || '');
        const status = isAuthz ? 403 : isProviderReg ? 409 : (typeof azureCode === 'number' ? azureCode : 500);
        return NextResponse.json({
            error: isAuthz
                ? "El Service Principal no tiene permisos para desplegar Workbooks. Se requiere 'Monitoring Contributor' o 'Workbook Contributor' sobre el Resource Group destino. Vuelve a ejecutar el script de onboarding del tier Enterprise."
                : isProviderReg
                ? "La suscripción no tiene registrado el resource provider 'microsoft.insights' y el registro automático no se completó. Regístrelo manualmente (az provider register --namespace microsoft.insights) y reintente."
                : "Internal server error",
            azureCode,
        }, { status });
    }
}
