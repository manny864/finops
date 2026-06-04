import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get('subscriptionId');
    const tenantId = searchParams.get('tenantId');

    if (!subscriptionId || !tenantId) {
      return NextResponse.json(
        { error: "Los parámetros 'tenantId' y 'subscriptionId' son estrictamente obligatorios en la URL." },
        { status: 400 }
      );
    }

    // Inicializar credenciales estrictamente para validar funcionamiento multi-tenant
    getAzureCredential(tenantId);
    
    // Placeholder para la lógica real (ej. CostManagementClient)
    const costSummary = {
      amortizedCost: 0,
      currency: "USD",
      note: "El extractor de datos CostManagementClient para este Tenant aún no está implementado."
    };

    return NextResponse.json({
      success: true,
      tenantId,
      subscriptionId,
      costSummary,
    });

  } catch (error: any) {
    console.error("Consumption API Error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor al consultar Consumo", details: error.message },
      { status: 500 }
    );
  }
}
