import { getAzureCredential } from "@/lib/azure";
import { AdvisorManagementClient } from "@azure/arm-advisor";

export async function collectAdvisorData(tenantId: string, locale: string) {
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
        const err = new Error("MISSING_RBAC_ROLE");
        (err as any).code = "MISSING_RBAC_ROLE";
        throw err;
    }

    const grouped: Record<string, any[]> = {
        Cost: [],
        Security: [],
        HighAvailability: [],
        Performance: [],
        OperationalExcellence: []
    };
    
    const scoresMap: Record<string, Record<string, number>> = {};

    for (const sub of subs) {
        const subId = sub.id;
        
        // Extraer Scores REST API
        try {
            const scoreRes = await fetch(`https://management.azure.com/subscriptions/${subId}/providers/Microsoft.Advisor/advisorScore?api-version=2023-01-01`, {
                headers: { "Authorization": `Bearer ${tokenResponse.token}`, "Accept-Language": locale }
            });
            if (scoreRes.ok) {
                const scoreData = await scoreRes.json();
                if (scoreData && scoreData.value && scoreData.value.length > 0) {
                    const subScores: Record<string, number> = {};
                    for (const item of scoreData.value) {
                        const name = item.name;
                        const score = item.properties?.lastRefreshedScore?.score;
                        if (name && score !== undefined) {
                            subScores[name] = score;
                        }
                    }
                    scoresMap[subId] = subScores;
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

    return { recommendations: grouped, subscriptions: subs, scores: scoresMap };
}
