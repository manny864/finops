import { MonitorClient } from "@azure/arm-monitor";
import { getAzureCredential } from "../lib/azure";

export async function getVmUtilization(tenantId: string, subscriptionId: string, resourceId: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new MonitorClient(credential, subscriptionId);

    const now = new Date();
    const past14Days = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const timespan = `${past14Days.toISOString()}/${now.toISOString()}`;

    try {
        const metrics = await client.metrics.list(resourceId, {
            timespan,
            interval: "P1D",
            metricnames: "Percentage CPU",
            aggregation: "Maximum,Average"
        });

        let maxCpu = 0;
        let avgSum = 0;
        let avgCount = 0;

        const timeSeries = metrics.value[0]?.timeseries?.[0]?.data || [];
        
        for (const data of timeSeries) {
            if (data.maximum !== undefined && data.maximum > maxCpu) {
                maxCpu = data.maximum;
            }
            if (data.average !== undefined) {
                avgSum += data.average;
                avgCount++;
            }
        }

        const avgCpu = avgCount > 0 ? avgSum / avgCount : 0;

        return { maxCpu, avgCpu };
    } catch (error) {
        console.error(`Error fetching metrics for ${resourceId}:`, error);
        return { maxCpu: 0, avgCpu: 0 };
    }
}
