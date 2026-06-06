import os
import json

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    print("1. Creando Directiva SOP...")
    os.makedirs(os.path.join(base_dir, "directivas"), exist_ok=True)
    sop_path = os.path.join(base_dir, "directivas/rightsizing_network_SOP.md")
    with open(sop_path, "w", encoding='utf-8') as f:
        f.write("# Directiva: Rightsizing P95 y Network API Fix\n\n")
        f.write("## Objetivo\nMejorar el motor de rightsizing usando métricas reales (P95/Max en 14 días). Solucionar error 500 en Network aislando tenants y capturando fallos de SDK.\n\n")
        f.write("## Restricciones/Casos Borde\n")
        f.write("- **Azure Monitor API**: El parámetro `aggregation` requiere especificar `Maximum,Average` (o los soportados explícitamente). No asumas que la API devuelve P95 nativamente si no lo pides, o en su defecto, calcula el P95 basado en las métricas listadas.\n")
        f.write("- **Network SDK (AuthorizationFailed)**: Siempre envuelve `networkClient` y `getNetworkEgressCosts` en try/catch. Un error 403 del SDK (`AuthorizationFailed` o `ScopeNotFound`) significa que el SPN no tiene permiso en esa Subscripción. No se debe petar con 500.\n")
        f.write("- **DefaultAzureCredential / ClientSecretCredential**: Instanciar SIEMPRE usando `getAzureCredential(tenantId)` para garantizar que el token esté scoped al directorio del cliente.\n")

    print("2. Modificando services/metricsService.ts...")
    metrics_route_path = os.path.join(base_dir, "src/services/metricsService.ts")
    with open(metrics_route_path, "r", encoding='utf-8') as f:
        content = f.read()
    
    if "data.maximum !== undefined" in content:
        # Re-write the getVmUtilization function entirely to match the new P95 requirement
        old_func = """    try {
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
    }"""
        
        new_func = """    try {
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
    }"""
        content = content.replace(old_func, new_func)
        with open(metrics_route_path, "w", encoding='utf-8') as f:
            f.write(content)


    print("3. Modificando lib/rightsizingEngine.ts...")
    rightsizing_path = os.path.join(base_dir, "src/lib/rightsizingEngine.ts")
    with open(rightsizing_path, "r", encoding='utf-8') as f:
        content = f.read()

    # We need to change the function signature and the logic
    content = content.replace("export function analyzeVmEfficiency(vm: any, metrics: { maxCpu: number, avgCpu: number }) {", "export function analyzeVmEfficiency(vm: any, metrics: { maxCpu: number, p95Cpu: number, avgCpu: number, p95Mem: number }) {")
    
    old_logic = """    if (metrics.maxCpu > 0 && metrics.maxCpu < 20) {
        isUnderutilized = true;
        
        if (vm.sku && skuMapping[vm.sku]) {
            recommendedSku = skuMapping[vm.sku];
        } else {
            recommendedSku = "Analizar reducción (1 tier menos)";
        }
    }

    return {
        isUnderutilized,
        recommendedSku,
        maxCpu: metrics.maxCpu,
        avgCpu: metrics.avgCpu
    };"""

    new_logic = """    let status = "Optimized";
    // Idle threshold: P95 CPU < 10%
    if (metrics.p95Cpu > 0 && metrics.p95Cpu < 10) {
        isUnderutilized = true;
        status = "Idle";
        recommendedSku = "Apagar/Deallocate";
    } 
    // Oversized threshold: P95 CPU < 40%
    else if (metrics.p95Cpu > 0 && metrics.p95Cpu < 40) {
        isUnderutilized = true;
        status = "Oversized";
        if (vm.sku && skuMapping[vm.sku]) {
            recommendedSku = skuMapping[vm.sku];
        } else {
            recommendedSku = "Analizar reducción (1 tier menos)";
        }
    }

    return {
        isUnderutilized,
        status,
        recommendedSku,
        maxCpu: metrics.maxCpu,
        p95Cpu: metrics.p95Cpu,
        avgCpu: metrics.avgCpu
    };"""
    content = content.replace(old_logic, new_logic)
    with open(rightsizing_path, "w", encoding='utf-8') as f:
        f.write(content)

    print("4. Modificando api/intelligence/network/route.ts...")
    network_api_path = os.path.join(base_dir, "src/app/api/intelligence/network/route.ts")
    with open(network_api_path, "r", encoding='utf-8') as f:
        content = f.read()
    
    if "ERR_NETWORK_ACCESS_DENIED" not in content:
        # Wrap everything in try/catch and use explicit tenantId
        old_block = """    try {
        const tenantId = request.headers.get("x-tenant-id");
        const subscriptionId = request.nextUrl.searchParams.get("subscriptionId");"""
        
        new_block = """    try {
        const tenantId = request.headers.get("x-tenant-id");
        const subscriptionId = request.nextUrl.searchParams.get("subscriptionId");"""
        # Actually this part is already in a try catch but we need to modify the catch
        
        old_catch = """    } catch (error: any) {
        console.error("Network API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }"""
        
        new_catch = """    } catch (error: any) {
        console.error("Network API Error:", error);
        let errorCode = "ERR_INTERNAL_SERVER";
        let status = 500;
        
        const msg = (error.message || "").toLowerCase();
        if (error.code === "AuthorizationFailed" || error.code === "ScopeNotFound" || msg.includes("authorization") || msg.includes("linkedinvalidpropertyid")) {
            errorCode = "ERR_NETWORK_ACCESS_DENIED";
            status = 403;
        }
        return NextResponse.json({ error: errorCode, message: error.message }, { status });
    }"""
        content = content.replace(old_catch, new_catch)
        with open(network_api_path, "w", encoding='utf-8') as f:
            f.write(content)

    print("Script completado.")

if __name__ == "__main__":
    deploy()
