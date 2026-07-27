import { NextRequest, NextResponse } from "next/server";
import { createSubscriptionBudget } from "@/services/budgetService";
import { getAzureCredential } from "@/lib/azure";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { requireDecimalStrict } from "@/lib/moneyDecimal";

export async function POST(request: NextRequest) {
    let subscriptionId: string | undefined;
    try {
        const body = await request.json();
        const { budgetName, amount, contactEmail, alertThreshold, tenantId: bodyTenantId, timeGrain } = body;
        subscriptionId = body.subscriptionId;

        if (!subscriptionId || !budgetName || amount === undefined || !contactEmail) {
            return NextResponse.json({ error: "Faltan parámetros requeridos." }, { status: 400 });
        }

        if (!bodyTenantId) {
            return NextResponse.json({ error: "Falta tenantId." }, { status: 400 });
        }

        await requireTenantRole(request, bodyTenantId, ['Admin', 'Owner']);

        const tenantId = bodyTenantId;

        const credential = await getAzureCredential(tenantId);
        
        const parsedAmount = requireDecimalStrict(amount, "amount", { maxScale: 4 });
        const parsedThreshold = alertThreshold === undefined || alertThreshold === null || String(alertThreshold).trim() === ""
            ? undefined
            : requireDecimalStrict(alertThreshold, "alertThreshold", { maxScale: 4 });

        const result = await createSubscriptionBudget(credential, subscriptionId, {
            budgetName,
            amount: parsedAmount.toNumber(),
            contactEmails: [contactEmail],
            alertThreshold: parsedThreshold?.toNumber(),
            timeGrain: timeGrain || 'BillingMonth'
        });

        return NextResponse.json({ success: true, data: result }, { status: 201 });

    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("Error creating budget in route:", e);
        
        const err = e as { code?: string; details?: { error?: { code?: string } } };
        if (err.code === 'RBACAccessDenied' || (err.details?.error?.code === 'RBACAccessDenied')) {
            return NextResponse.json({
                error: "Permisos insuficientes en Azure",
                details: `La aplicación (Service Principal) no tiene permiso para crear presupuestos en la suscripción ${subscriptionId}. Asigná el rol 'Cost Management Contributor' (mínimo privilegio, incluye Microsoft.Consumption/budgets/write) al App Registration del tenant sobre esa suscripción y reintentá.`
            }, { status: 403 });
        }

        if ((e as Error)?.message?.includes("inválido")) {
            return NextResponse.json({ error: (e as Error).message }, { status: 400 });
        }
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
