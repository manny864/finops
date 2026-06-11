import { MonitorClient } from "@azure/arm-monitor";
import { getAzureCredential } from '@/lib/azure';

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
            metricnames: "Percentage CPU,Available Memory Bytes,Network In Total,Network Out Total",
            aggregation: "Maximum,Average"
        });

        let maxCpu = 0;
        const cpuAverages: number[] = [];
        const memAverages: number[] = [];

        for (const metric of metrics.value) {
            const timeSeries = metric.timeseries?.[0]?.data || [];
            
            if (metric.name?.value === "Percentage CPU") {
                for (const data of timeSeries) {
                    if (data.maximum !== undefined && data.maximum > maxCpu) {
                        maxCpu = data.maximum;
                    }
                    if (data.average !== undefined) {
                        cpuAverages.push(data.average);
                    }
                }
            } else if (metric.name?.value === "Available Memory Bytes") {
                for (const data of timeSeries) {
                    if (data.average !== undefined) {
                        memAverages.push(data.average);
                    }
                }
            }
        }

        // Calculate P95 for CPU and Memory
        cpuAverages.sort((a, b) => a - b);
        memAverages.sort((a, b) => a - b);
        
        const getP95 = (arr: number[]) => {
            if (arr.length === 0) return 0;
            const idx = Math.floor(arr.length * 0.95);
            return arr[idx];
        };

        const p95Cpu = getP95(cpuAverages);
        const avgCpu = cpuAverages.length > 0 ? cpuAverages.reduce((a,b)=>a+b,0)/cpuAverages.length : 0;
        
        // Memory is "Available Bytes". Let's assume we want to know if it's idle.
        // For simplicity in this FinOps proxy metric, we return what we have.
        const p95Mem = getP95(memAverages);

        return { maxCpu, p95Cpu, avgCpu, p95Mem };
    } catch (error) {
        console.error(`Error fetching metrics for ${resourceId}:`, error);
        return { maxCpu: 0, p95Cpu: 0, avgCpu: 0, p95Mem: 0 };
    }
}
