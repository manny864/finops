import { getAzureCredential } from "../src/lib/azure";
import { ConsumptionManagementClient } from "@azure/arm-consumption";

async function main() {
    const tenantId = process.env.TEST_TENANT_ID || "54d7cf18-0baa-4da7-8242-fbf59a92aaac";
    const subId = process.env.TEST_SUB_ID || "292fdd9f-2ff3-465b-9091-d554c1af4456";
    try {
        const credential = await getAzureCredential(tenantId);
        const client = new ConsumptionManagementClient(credential, subId);
        const scope = `/subscriptions/${subId}`;
        
        const filter = `properties/scope eq 'Single' and properties/lookBackPeriod eq 'Last30Days'`;
        
        let firstRec = null;
        for await (const rec of client.reservationRecommendations.list(scope, { filter })) {
            firstRec = rec;
            break;
        }

        if (firstRec) {
            console.log("Found recommendation:", firstRec.name);
            console.log("Term:", (firstRec as any).term, "Region:", firstRec.location, "Sku:", firstRec.sku);
            try {
                const details = await client.reservationRecommendationDetails.get(
                    scope,
                    (firstRec as any).term as string,
                    firstRec.location as string,
                    firstRec.sku as string,
                    (firstRec as any).lookBackPeriod as string
                );
                console.log("Details keys:", Object.keys(details));
                console.log("Details:", JSON.stringify(details, null, 2));
            } catch (err: any) {
                console.error("Failed to get details:", err.message);
            }
        }
    } catch(e) {
        console.error(e);
    }
}
main();
