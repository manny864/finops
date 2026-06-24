import { NextRequest, NextResponse } from "next/server";
import { createSubscriptionBudget } from "@/services/budgetService";
import { getAzureCredential } from "@/lib/azure";
import jwt from "jsonwebtoken";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { subscriptionId, budgetName, amount, contactEmail, tenantId: bodyTenantId } = body;

        if (!subscriptionId || !budgetName || amount === undefined || !contactEmail) {
            return NextResponse.json({ error: "Faltan parámetros requeridos." }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }
        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }

        const tenantId = bodyTenantId || decoded.tid;

        const email = decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "";
        const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") && decoded.tid === "8b41364f-581a-4e43-b7cb-13138dac5517";

        if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: "El token no coincide con el tenant." }, { status: 403 });
        }

        const credential = await getAzureCredential(tenantId);
        
        const result = await createSubscriptionBudget(credential, subscriptionId, {
            budgetName,
            amount: parseFloat(amount),
            contactEmails: [contactEmail]
        });

        return NextResponse.json({ success: true, data: result }, { status: 201 });

    } catch (e: any) {
        console.error("Error creating budget in route:", e);
        return NextResponse.json({ error: "Fallo al crear el presupuesto en Azure", details: e.message }, { status: 500 });
    }
}
