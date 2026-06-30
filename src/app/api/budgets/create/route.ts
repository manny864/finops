import { NextRequest, NextResponse } from "next/server";
import { createSubscriptionBudget } from "@/services/budgetService";
import { getAzureCredential } from "@/lib/azure";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { subscriptionId, budgetName, amount, contactEmail, alertThreshold, tenantId: bodyTenantId, timeGrain } = body;

        if (!subscriptionId || !budgetName || amount === undefined || !contactEmail) {
            return NextResponse.json({ error: "Faltan parámetros requeridos." }, { status: 400 });
        }

        if (!bodyTenantId) {
            return NextResponse.json({ error: "Falta tenantId." }, { status: 400 });
        }

        await requireTenantRole(request, bodyTenantId, ['Admin', 'Owner']);

        const tenantId = bodyTenantId;

        const credential = await getAzureCredential(tenantId);
        
        const result = await createSubscriptionBudget(credential, subscriptionId, {
            budgetName,
            amount: parseFloat(amount),
            contactEmails: [contactEmail],
            alertThreshold: alertThreshold ? parseFloat(alertThreshold) : undefined,
            timeGrain: timeGrain || 'BillingMonth'
        });

        return NextResponse.json({ success: true, data: result }, { status: 201 });

    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("Error creating budget in route:", e);
        
        const err = e as { code?: string; details?: { error?: { code?: string } } };
        if (err.code === 'RBACAccessDenied' || (err.details?.error?.code === 'RBACAccessDenied')) {
            return NextResponse.json({ 
                error: "Permisos insuficientes", 
                details: "La aplicación no tiene permisos para crear presupuestos. Debes asignar el rol 'Cost Management Contributor' a la aplicación en la suscripción de Azure." 
            }, { status: 403 });
        }

        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
