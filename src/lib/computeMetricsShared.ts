/**
 * Helper compartido para leer métricas puntuales de Azure Monitor (REST directo,
 * sin SDK) para un recurso individual. Usado por el cockpit de Workloads
 * (`/api/intelligence/compute/workloads`) y por el motor de Unit Economics
 * (`/api/intelligence/compute-cost-per-core`) para no duplicar la llamada.
 * Roles Azure: Monitoring Reader (ya asignado en el baseline del tenant).
 */

function summarizeNumeric(values: number[]): number | null {
    if (values.length === 0) return null;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return Number(avg.toFixed(4));
}

export async function getAzureResourceMetricsSummary(
    credential: any,
    resourceId: string,
    metricNames: string[],
): Promise<Record<string, number | null>> {
    try {
        const token = await credential.getToken("https://management.azure.com/.default");
        if (!token?.token) return {};
        const now = new Date();
        const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const url = new URL(`https://management.azure.com${resourceId}/providers/Microsoft.Insights/metrics`);
        url.searchParams.set("api-version", "2018-01-01");
        url.searchParams.set("metricnames", metricNames.join(","));
        url.searchParams.set("timespan", `${start.toISOString()}/${now.toISOString()}`);
        url.searchParams.set("interval", "PT1H");
        url.searchParams.set("aggregation", "Average,Maximum,Total");

        const response = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${token.token}` },
            cache: "no-store",
        });
        if (!response.ok) return {};
        const payload: any = await response.json();
        const result: Record<string, number | null> = {};
        for (const metric of payload.value || []) {
            const name = String(metric?.name?.value || "");
            const points = (metric.timeseries?.[0]?.data || []) as Array<Record<string, number>>;
            const numbers = points
                .map((p) => {
                    if (typeof p.average === "number") return p.average;
                    if (typeof p.maximum === "number") return p.maximum;
                    if (typeof p.total === "number") return p.total;
                    return null;
                })
                .filter((v): v is number => typeof v === "number");
            result[name] = summarizeNumeric(numbers);
        }
        return result;
    } catch {
        return {};
    }
}
