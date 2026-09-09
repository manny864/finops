import { getAzureCredential, listTenantSubscriptions } from "@/lib/azure";

function normalizeAdvisorLocale(locale: string): string {
    const normalized = (locale || "es").toLowerCase();
    if (normalized.startsWith("es")) return "es";
    if (normalized.startsWith("pt")) return "pt-BR";
    if (normalized.startsWith("en")) return "en";
    return "en";
}

function buildAzureHeaders(token: string, locale: string): Record<string, string> {
    return {
        Authorization: `Bearer ${token}`,
        "Accept-Language": locale,
        // Best-effort extra hint: varios endpoints ARM respetan este header
        // cuando Accept-Language no alcanza para localizar descripciones.
        "x-ms-localization-language": locale,
    };
}

export async function collectAdvisorData(tenantId: string, locale: string) {
    const credential = await getAzureCredential(tenantId);
    const advisorLocale = normalizeAdvisorLocale(locale);

    // Obtener suscripciones (sólo las de este directorio: ver
    // listTenantSubscriptions en lib/azure)
    const tokenResponse = await credential.getToken("https://management.azure.com/.default");
    const headers = buildAzureHeaders(tokenResponse?.token || "", advisorLocale);
    const subs = (await listTenantSubscriptions(tenantId, credential)).map((sub) => ({
        id: sub.subscriptionId,
        name: sub.displayName || sub.subscriptionId,
    }));

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
        OperationalExcellence: [],
    };

    const scoresMap: Record<string, Record<string, number>> = {};
    // Peso por consumo (consumptionUnits) de cada categoría/sub, para agregar el
    // Advisor Score entre suscripciones tal como lo hace Azure: media PONDERADA
    // por consumo, no media simple.
    const scoreUnitsMap: Record<string, Record<string, number>> = {};

    // La Advisor Score API devuelve una entrada por categoría real, PERO también
    // entradas con nombre GUID (contribución por tipo de recomendación) con
    // scores 0–2 que NO son categorías. Solo capturamos las categorías conocidas.
    const SCORE_CATS = new Set(["Advisor", "Cost", "Security", "HighAvailability", "Performance", "OperationalExcellence"]);

    for (const sub of subs) {
        const subId = sub.id;

        // Extraer Scores REST API
        try {
            const scoreRes = await fetch(`https://management.azure.com/subscriptions/${subId}/providers/Microsoft.Advisor/advisorScore?api-version=2023-01-01`, {
                headers,
            });
            if (scoreRes.ok) {
                const scoreData = await scoreRes.json();
                if (scoreData && scoreData.value && scoreData.value.length > 0) {
                    const subScores: Record<string, number> = {};
                    const subUnits: Record<string, number> = {};
                    for (const item of scoreData.value) {
                        const name = item.name;
                        if (!name || !SCORE_CATS.has(name)) continue;
                        const lrs = item.properties?.lastRefreshedScore;
                        const score = lrs?.score;
                        if (score !== undefined) subScores[name] = score;
                        const cu = lrs?.consumptionUnits;
                        if (cu !== undefined && cu !== null) subUnits[name] = Number(cu) || 0;
                    }
                    scoresMap[subId] = subScores;
                    scoreUnitsMap[subId] = subUnits;
                }
            }
        } catch (err) {
            console.warn(`Error reading scores for sub ${subId}:`, err);
        }

        // Suppressions API -> estado real de las recomendaciones (Postponed / Dismissed).
        // Advisor no tiene "Completed" en su API pública. Una suppression con TTL
        // finito = Postponed (hasta expirationTimeStamp); sin expiración = Dismissed.
        // El id de la suppression contiene el nombre de la recomendación:
        //   .../recommendations/{recName}/suppressions/{suppName}
        const suppByRec: Record<string, { state: "postponed" | "dismissed"; until?: string; on?: string }> = {};
        try {
            const supRes = await fetch(`https://management.azure.com/subscriptions/${subId}/providers/Microsoft.Advisor/suppressions?api-version=2023-01-01`, {
                headers,
            });
            if (supRes.ok) {
                const supData = await supRes.json();
                for (const s of supData.value || []) {
                    const m = String(s.id || "").match(/\/recommendations\/([^/]+)\/suppressions\//i);
                    if (!m) continue;
                    const recName = m[1];
                    const exp = s.properties?.expirationTimeStamp;
                    const ttl = s.properties?.ttl;
                    const hasExpiry = !!exp && new Date(exp).getFullYear() < 9000;
                    suppByRec[recName] = hasExpiry
                        ? { state: "postponed", until: exp, on: s.properties?.createdOn || undefined }
                        : { state: "dismissed", on: s.properties?.createdOn || undefined, until: ttl };
                }
            }
        } catch (err) {
            console.warn(`Error reading suppressions for sub ${subId}:`, err);
        }

        // Extraer Recomendaciones vía REST cruda (NO el SDK @azure/arm-advisor):
        // el SDK fija api-version=2020-01-01 y su deserializador descarta en
        // silencio recomendaciones cuyo shape no matchea su modelo TS — se
        // confirmó que "Right-size or shutdown underutilized virtual machines"
        // (la única con datos de carbono) desaparecía en al menos una
        // suscripción con el SDK, mientras la REST API (2020/2022/2023) la
        // devuelve siempre. Usamos 2023-01-01, la misma versión que score y
        // suppressions, con paginación manual vía nextLink.
        try {
            let url: string | null = `https://management.azure.com/subscriptions/${subId}/providers/Microsoft.Advisor/recommendations?api-version=2023-01-01`;
            while (url) {
                const res: Response = await fetch(url, { headers });
                if (!res.ok) {
                    console.warn(`Advisor recommendations REST ${res.status} para sub ${subId}`);
                    break;
                }
                const json: any = await res.json();
                for (const item of json.value || []) {
                    const p = item.properties || {};
                    const cat = p.category;
                    const recName = item.name;
                    const supp = recName ? suppByRec[recName] : undefined;
                    const recWithSub = {
                        id: item.id,
                        name: recName,
                        category: cat,
                        impact: p.impact,
                        impactedField: p.impactedField,
                        impactedValue: p.impactedValue,
                        recommendationTypeId: p.recommendationTypeId,
                        lastUpdated: p.lastUpdated,
                        shortDescription: p.shortDescription,
                        extendedProperties: p.extendedProperties,
                        resourceMetadata: p.resourceMetadata,
                        subscriptionId: subId,
                        _state: supp?.state || "active",
                        _suppressedUntil: supp?.until,
                        _suppressedOn: supp?.on,
                    };
                    if (cat && grouped[cat as keyof typeof grouped]) {
                        grouped[cat as keyof typeof grouped].push(recWithSub as never);
                    } else if (cat) {
                        grouped.OperationalExcellence.push(recWithSub as never);
                    }
                }
                url = json.nextLink || null;
            }
        } catch (err) {
            console.warn(`Error reading advisor for sub ${subId}:`, err);
        }
    }

    return { recommendations: grouped, subscriptions: subs, scores: scoresMap, scoreUnits: scoreUnitsMap };
}
