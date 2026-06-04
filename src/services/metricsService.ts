import { getAzureCredential } from "@/lib/azure";
import { MonitorClient } from "@azure/arm-monitor";

export async function getVmUtilization(tenantId: string, subscriptionId: string, resourceId: string) {
    const credential = await getAzureCredential(tenantId);
    // MonitorClient requires credential and an optional subscriptionId (though usually omitted for ARM calls directly on resourceId)
    const client = new MonitorClient(credential, subscriptionId);
    
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 14);
    const timespan = `${start.toISOString()}/${end.toISOString()}`;
    const interval = "P1D";
    
    try {
        const response = await client.metrics.list(resourceId, {
            metricnames: "Percentage CPU,Available Memory Bytes",
            timespan: timespan,
            interval: interval,
            aggregation: "Maximum,Average"
        });
        
        const metrics = response.value || [];
        
        let maxCpu = 0;
        let avgCpu = 0;
        
        for (const metric of metrics) {
            if (metric.name?.value === "Percentage CPU") {
                const timeseries = metric.timeseries?.[0]?.data || [];
                for (const point of timeseries) {
                    if (point.maximum && point.maximum > maxCpu) maxCpu = point.maximum;
                    if (point.average && point.average > avgCpu) avgCpu = point.average;
                }
            }
        }
        
        return {
            maxCpu,
            avgCpu
        };
    } catch (e) {
        console.error(`Error fetching metrics for ${resourceId}:`, e);
        return { maxCpu: 0, avgCpu: 0 };
    }
}
