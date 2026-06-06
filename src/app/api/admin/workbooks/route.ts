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
        return NextResponse.json({ error: "Fallo al desplegar el Workbook." }, { status: 500 });
    }
}
