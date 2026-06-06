import { ConsumptionManagementClient } from "@azure/arm-consumption";
import { TokenCredential } from "@azure/identity";

export async function getReservationRecommendations(
  credential: TokenCredential,
  subscriptionId: string,
  scopeType: 'Single' | 'Shared' = 'Single',
  lookBackPeriod: 'Last7Days' | 'Last30Days' | 'Last60Days' = 'Last30Days'
) {
  try {
    const client = new ConsumptionManagementClient(credential, subscriptionId);
    const scope = `/subscriptions/${subscriptionId}`;
    
    const filter = `properties/scope eq '${scopeType}' and properties/lookBackPeriod eq '${lookBackPeriod}'`;
    
    const recommendations = [];
    // PagedAsyncIterableIterator handling
    for await (const rec of client.reservationRecommendations.list(scope, { filter })) {
      recommendations.push(rec);
    }
    
    return recommendations;
  } catch (error: any) {
    console.error("Error fetching reservation recommendations:", error);
    throw new Error(error.message || "Failed to fetch recommendations");
  }
}
