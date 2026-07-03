import { ResourceManagementClient } from "@azure/arm-resources";
import finopsTemplate from "@/lib/templates/finops-workbook.json";
import zombieTemplate from "@/lib/templates/zombie-workbook.json";

const INSIGHTS_NAMESPACE = "microsoft.insights";

function isMissingProviderError(e: unknown): boolean {
    const err = e as { code?: string; body?: { error?: { code?: string } }; message?: string };
    const code = err?.code || err?.body?.error?.code || "";
    return code === "MissingSubscriptionRegistration" ||
        /MissingSubscriptionRegistration/i.test(err?.message || "");
}

/**
 * Registra el resource provider microsoft.insights en la suscripción (si no lo
 * está ya) y espera (poll) hasta que quede 'Registered'. Requiere permiso
 * Microsoft.Insights/register/action (incluido en Contributor).
 */
async function registerInsightsProvider(client: ResourceManagementClient): Promise<void> {
    const current = await client.providers.get(INSIGHTS_NAMESPACE);
    if ((current.registrationState || "").toLowerCase() !== "registered") {
        await client.providers.register(INSIGHTS_NAMESPACE);
    }
    const maxAttempts = 18; // ~90s
    for (let i = 0; i < maxAttempts; i++) {
        const provider = await client.providers.get(INSIGHTS_NAMESPACE);
        if ((provider.registrationState || "").toLowerCase() === "registered") return;
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    throw Object.assign(
        new Error("El registro del provider microsoft.insights no se completó a tiempo. Reintente en unos minutos."),
        { code: "ProviderRegistrationTimeout" }
    );
}

export async function deployFinOpsWorkbook(credential: any, subscriptionId: string, resourceGroupName: string, workbookType: string) {
    const client = new ResourceManagementClient(credential, subscriptionId);
    
    let templateContent;
    let workbookName;
    let workbookDisplayName;

    if (workbookType === 'cost-optimization') {
        templateContent = finopsTemplate;
        workbookName = `finops-workbook-${Date.now()}`;
        workbookDisplayName = 'FinOps Cost Optimization Workbook';
    } else if (workbookType === 'zombie-resources') {
        templateContent = zombieTemplate;
        workbookName = `zombie-workbook-${Date.now()}`;
        workbookDisplayName = 'Zombie Resources Tracker';
    } else {
        throw new Error(`Tipo de workbook inválido: ${workbookType}`);
    }

    // Las propiedades del Workbook directamente
    const resourceParams = {
        location: "eastus", 
        kind: "shared",
        properties: {
            displayName: workbookDisplayName,
            serializedData: JSON.stringify(templateContent),
            category: "workbook"
        }
    };

    const createWorkbook = () => client.resources.beginCreateOrUpdateAndWait(
        resourceGroupName,
        "Microsoft.Insights",
        "",
        "workbooks",
        workbookName,
        "2022-04-01",
        resourceParams as any
    );

    try {
        return await createWorkbook();
    } catch (e: unknown) {
        // Suscripciones nuevas no tienen registrado microsoft.insights (409
        // MissingSubscriptionRegistration). Nota: incluso con el provider ya
        // 'Registered', ARM puede devolver 409 unos minutos por propagación.
        // Estrategia: asegurar registro y reintentar con backoff (10/20/30s).
        if (!isMissingProviderError(e)) throw e;
        console.warn(`[Workbooks] 409 MissingSubscriptionRegistration en ${subscriptionId}. Verificando/registrando provider y reintentando con backoff...`);
        await registerInsightsProvider(client);

        const delaysMs = [10000, 20000, 30000];
        for (let i = 0; i < delaysMs.length; i++) {
            await new Promise(resolve => setTimeout(resolve, delaysMs[i]));
            try {
                return await createWorkbook();
            } catch (retryErr: unknown) {
                if (!isMissingProviderError(retryErr) || i === delaysMs.length - 1) throw retryErr;
                console.warn(`[Workbooks] Reintento ${i + 1} aún con 409 (propagación ARM). Esperando ${delaysMs[i + 1] / 1000}s...`);
            }
        }
        // Inalcanzable (el loop retorna o lanza), pero TypeScript lo requiere.
        throw e;
    }
}
