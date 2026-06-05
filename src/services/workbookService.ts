import { ResourceManagementClient } from "@azure/arm-resources";

export async function deployFinOpsWorkbook(credential: any, subscriptionId: string, resourceGroupName: string) {
    const client = new ResourceManagementClient(credential, subscriptionId);
    
    const workbookName = `FinOps-Cost-Optimization-${Date.now()}`;
    const location = "eastus";
    
    const resourceParams = {
        location,
        kind: "shared",
        properties: {
            displayName: "FinOps Cost Optimization",
            serializedData: "{\"version\":\"Notebook/1.0\",\"items\":[{\"type\":1,\"content\":{\"json\":\"# FinOps Cost Optimization\\n\\nWelcome to your cost optimization dashboard.\"}}]}",
            category: "workbook",
            sourceId: "Azure Monitor"
        }
    };

    const result = await client.resources.beginCreateOrUpdateAndWait(
        resourceGroupName,
        "Microsoft.Insights",
        "",
        "workbooks",
        workbookName,
        "2021-03-08",
        resourceParams
    );
    
    return result;
}
