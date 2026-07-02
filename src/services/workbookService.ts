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
 * Registra el resource provider microsoft.insights en la suscripción y espera
 * (poll) hasta que quede 'Registered'. Requiere permiso
 * Microsoft.Insights/register/action (incluido en Contributor).
 */
async function registerInsightsProvider(client: ResourceManagementClient): Promise<void> {
    await client.providers.register(INSIGHTS_NAMESPACE);
    const maxAttempts = 18; // ~90s
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const provider = await client.providers.get(INSIGHTS_NAMESPACE);
        if ((provider.registrationState || "").toLowerCase() === "registered") return;
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
        // MissingSubscriptionRegistration). Lo registramos y reintentamos una vez.
        if (!isMissingProviderError(e)) throw e;
        console.warn(`[Workbooks] microsoft.insights no registrado en ${subscriptionId}. Registrando provider y reintentando...`);
        await registerInsightsProvider(client);
        return await createWorkbook();
    }
}
