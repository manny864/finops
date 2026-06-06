import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { AdvisorManagementClient } from "@azure/arm-advisor";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    const locale = request.headers.get('accept-language') || 'es';
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as any;
    if (!decoded || !decoded.tid) {
      return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
    }

    const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
    const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

    if (decoded.tid !== tenantId && !isAdmin) {
      return NextResponse.json({ error: `Acceso denegado. El token no coincide con el tenant.` }, { status: 403 });
    }

    const credential = await getAzureCredential(tenantId);
    
    // Obtener suscripciones
    const tokenResponse = await credential.getToken("https://management.azure.com/.default");
    const fetchRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
        headers: { "Authorization": `Bearer ${tokenResponse.token}`, "Accept-Language": locale }
    });
    
    let subs: any[] = [];
    if (fetchRes.ok) {
        const data = await fetchRes.json();
        for (const sub of data.value) {
            if (sub.subscriptionId) subs.push({ id: sub.subscriptionId, name: sub.displayName });
        }
    } else {
        throw new Error("Failed to fetch subscriptions");
    }

    if (subs.length === 0) {
        return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector en las suscripciones." }, { status: 403 });
    }

    const grouped: Record<string, any[]> = {
        Cost: [],
        Security: [],
        HighAvailability: [],
        Performance: [],
        OperationalExcellence: []
    };
    
    const scoresMap: Record<string, number> = {};

    for (const sub of subs) {
        const subId = sub.id;
        
        // Extraer Scores REST API
        try {
            const scoreRes = await fetch(`https://management.azure.com/subscriptions/${subId}/providers/Microsoft.Advisor/advisorScores?api-version=2020-01-01`, {
                headers: { "Authorization": `Bearer ${tokenResponse.token}`, "Accept-Language": locale }
            });
            if (scoreRes.ok) {
                const scoreData = await scoreRes.json();
                if (scoreData && scoreData.value && scoreData.value.length > 0) {
                    const score = scoreData.value[0].properties?.score;
                    if (score !== undefined) {
                        scoresMap[subId] = score;
                    }
                }
            }
        } catch (err) {
            console.warn(`Error reading scores for sub ${subId}:`, err);
        }

        // Extraer Recomendaciones
        try {
            const advisorClient = new AdvisorManagementClient(credential, subId);
            const recs = advisorClient.recommendations.list({ requestOptions: { customHeaders: { 'Accept-Language': locale } } });
            for await (const r of recs) {
                const cat = r.category;
                const recWithSub = { ...r, subscriptionId: subId };
                if (cat && grouped[cat as keyof typeof grouped]) {
                    grouped[cat as keyof typeof grouped].push(recWithSub);
                } else if (cat) {
                    grouped.OperationalExcellence.push(recWithSub as never);
                }
            }
        } catch (err) {
            console.warn(`Error reading advisor for sub ${subId}:`, err);
        }
    }

    return NextResponse.json({ 
        success: true, 
        recommendations: grouped,
        subscriptions: subs,
        scores: scoresMap
    });
  } catch (error: any) {
    console.error("Advisor Error:", error);
    
    // Detectar falta de Admin Consent (Service Principal faltante)
    if (error.message && error.message.includes("AADSTS7000229")) {
      return NextResponse.json({
        error: "MISSING_ADMIN_CONSENT",
        details: "Falta el Service Principal en el Tenant destino. Debe proporcionar Admin Consent a la aplicación."
      }, { status: 403 });
    }

    return NextResponse.json({ error: "Error en el Motor de Advisor", details: error.message }, { status: 500 });
  }
}
