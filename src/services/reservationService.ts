import { TokenCredential } from "@azure/identity";

export interface ReservationOpportunity {
    skuName: string;
    resourceType: string;
    recommendedQuantity: number;
    totalMonthlyPAYGCost: number;
    costWith1YReservation: number;
    netSavings1Y: number;
    costWith3YReservation: number;
    netSavings3Y: number;
}

export async function getReservationRecommendations(credential: TokenCredential, subscriptionId: string): Promise<ReservationOpportunity[]> {
    try {
        console.log(`[ReservationService] Fetching reservation recommendations for subscription: ${subscriptionId}`);
        
        // Obtenemos el token de Azure Management
        const tokenData = await credential.getToken("https://management.azure.com/.default");
        if (!tokenData) {
            throw new Error("No se pudo obtener el token de acceso de Azure Management");
        }

        const url = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/generateReservationRecommendation?api-version=2023-03-01`;
        
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokenData.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({}) // Cuerpo vacío requerido para llamadas generadoras POST en ARM
        });

        if (!res.ok) {
            const errorText = await res.text().catch(() => "No response body");
            console.error(`[ReservationService] Azure REST API returned status ${res.status}: ${errorText}`);
            throw new Error(`Azure API error ${res.status}: ${errorText}`);
        }

        const json = await res.json();
        console.log(`[ReservationService] Successful response received. Mapping data...`);

        const value = json.value || [];
        const mapped: ReservationOpportunity[] = value.map((item: any) => {
            const props = item.properties || {};
            
            // Extraer y normalizar propiedades
            const skuName = props.skuName || props.instanceFlexibilityGroup || props.sku || "Unknown SKU";
            const resourceType = props.resourceType || "VirtualMachines";
            const recommendedQuantity = Number(props.recommendedQuantity || props.recommendedQuantityFor1Year || props.recommendedQuantityFor3Years || 1);
            
            // PAYG
            const totalMonthlyPAYGCost = Number(props.totalMonthlyPAYGCost || props.monthlyPAYGCost || props.costWithNoReservation || props.currentCost || 0);
            
            // 1 Year RI
            const costWith1YReservation = Number(props.costWith1YReservation || props.costWith1YearReservation || props.totalCostWith1YearReservation || (totalMonthlyPAYGCost * 0.7)); // fallback teórico 30% ahorro
            const netSavings1Y = Number(props.netSavings1Y || props.netSavingsFor1Year || props.netSavings || (totalMonthlyPAYGCost - costWith1YReservation));
            
            // 3 Years RI
            const costWith3YReservation = Number(props.costWith3YReservation || props.costWith3YearReservation || props.totalCostWith3YearReservation || (totalMonthlyPAYGCost * 0.5)); // fallback teórico 50% ahorro
            const netSavings3Y = Number(props.netSavings3Y || props.netSavingsFor3Years || props.netSavings || (totalMonthlyPAYGCost - costWith3YReservation));

            return {
                skuName,
                resourceType,
                recommendedQuantity,
                totalMonthlyPAYGCost,
                costWith1YReservation,
                netSavings1Y: netSavings1Y > 0 ? netSavings1Y : 0,
                costWith3YReservation,
                netSavings3Y: netSavings3Y > 0 ? netSavings3Y : 0
            };
        });

        return mapped;
    } catch (error: any) {
        console.error(`[ReservationService] Error querying Azure CostManagement generateReservationRecommendation:`, error);
        throw error;
    }
}
