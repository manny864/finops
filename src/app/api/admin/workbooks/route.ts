import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { deployFinOpsWorkbook } from "@/services/workbookService";
import jwt from "jsonwebtoken";

export async function POST(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
        }

        const body = await request.json();
        const { subscriptionId, resourceGroupName, workbookType } = body;

        if (!subscriptionId || !resourceGroupName || !workbookType) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: subscriptionId, resourceGroupName o workbookType" }, { status: 400 });
        }

        const credential = await getAzureCredential(decoded.tid);
        const deploymentResult = await deployFinOpsWorkbook(credential, subscriptionId, resourceGroupName, workbookType);

        return NextResponse.json({ 
            success: true, 
            message: "Workbook desplegado exitosamente", 
            deploymentId: deploymentResult.id 
        });

    } catch (error: any) {
        console.error("Workbook Deployment Error:", error);
        const azureCode = error?.code || error?.body?.error?.code || error?.statusCode;
        const azureMsg = error?.body?.error?.message || error?.details?.message || error?.message;
        const isAuthz = azureCode === 'AuthorizationFailed' || /AuthorizationFailed/i.test(azureMsg || '');
        const status = isAuthz ? 403 : (typeof azureCode === 'number' ? azureCode : 500);
        return NextResponse.json({
            error: isAuthz
                ? "El Service Principal no tiene permisos para desplegar Workbooks. Se requiere 'Monitoring Contributor' o 'Workbook Contributor' sobre el Resource Group destino. Vuelve a ejecutar el script de onboarding del tier Enterprise."
                : (azureMsg || "Fallo al desplegar el Workbook."),
            azureCode,
            details: azureMsg
        }, { status });
    }
}
