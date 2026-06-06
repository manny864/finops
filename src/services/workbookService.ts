import { ResourceManagementClient } from "@azure/arm-resources";
import finopsTemplate from "@/lib/templates/finops-workbook.json";
import zombieTemplate from "@/lib/templates/zombie-workbook.json";

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
    
    // Ejecutar el despliegue del recurso directamente
    const result = await client.resources.beginCreateOrUpdateAndWait(
        resourceGroupName,
        "Microsoft.Insights",
        "",
        "workbooks",
        workbookName,
        "2022-04-01",
        resourceParams as any
    );

    return result;
}
