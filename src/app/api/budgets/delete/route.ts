import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { getAzureCredential } from "@/lib/azure";
import { deleteSubscriptionBudget } from "@/services/budgetService";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, subscriptionId, budgetName } = body;

    if (!tenantId || !subscriptionId || !budgetName) {
      return NextResponse.json(
        { error: "tenantId, subscriptionId y budgetName son requeridos." },
        { status: 400 }
      );
    }

    await requireTenantRole(request, tenantId, ["Owner", "Admin"]);

    const credential = await getAzureCredential(tenantId);
    await deleteSubscriptionBudget(credential, subscriptionId, budgetName);

    return NextResponse.json({ success: true, message: "Budget eliminado exitosamente." });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Error al eliminar budget:", error);
    return NextResponse.json(
      { error: error.message || "Error al eliminar budget." },
      { status: 500 }
    );
  }
}
