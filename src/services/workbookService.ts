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

    const deploymentParameters = {
        properties: {
            mode: "Incremental",
            template: {
                "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
                "contentVersion": "1.0.0.0",
                "resources": [
                    {
                        "type": "microsoft.insights/workbooks",
                        "apiVersion": "2022-04-01",
                        "name": workbookName,
                        "location": "[resourceGroup().location]",
                        "kind": "shared",
                        "properties": {
                            "displayName": workbookDisplayName,
                            "serializedData": JSON.stringify(templateContent),
                            "category": "workbook"
                        }
                    }
                ]
            }
        }
    };

    const deploymentName = `deploy-${workbookType}-${Date.now()}`;
    
    // Ejecutar el despliegue a través del Azure Resource Manager (ARM)
    const result = await client.deployments.beginCreateOrUpdateAndWait(
        resourceGroupName,
        deploymentName,
        deploymentParameters as any
    );

    return result;
}
