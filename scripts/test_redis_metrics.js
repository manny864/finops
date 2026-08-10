const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Cargar variables de entorno
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../.env.development') });

const { ClientSecretCredential } = require('@azure/identity');

async function run() {
    try {
        console.log("Iniciando prueba de métricas de Redis...");
        
        const tenantId = process.env.AZURE_TENANT_ID;
        console.log("Tenant ID del entorno:", tenantId);
        
        if (!tenantId) {
            console.log("No se configuró AZURE_TENANT_ID en el entorno.");
            return;
        }

        const clientId = process.env.AZURE_CLIENT_ID;
        const clientSecret = process.env.AZURE_CLIENT_SECRET;
        
        console.log("Cliente ID:", clientId);
        
        const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);

        // Obtener token
        console.log("Obteniendo token de Azure...");
        const tokenResponse = await credential.getToken("https://management.azure.com/.default");
        console.log("Token obtenido correctamente.");
        
        // Intentar buscar un recurso Redis en el tenant usando Resource Graph
        const { ResourceGraphClient } = require('@azure/arm-resourcegraph');
        const argClient = new ResourceGraphClient(credential);
        
        const query = "Resources | where type =~ 'microsoft.cache/redis' or type =~ 'microsoft.cache/redisenterprise' | project id, name, type";
        console.log("Consultando Resource Graph para buscar instancias de Redis...");
        const resARG = await argClient.resources({ query });
        const resources = resARG.data || [];
        console.log(`Encontradas ${resources.length} instancias de Redis.`);
        
        if (resources.length === 0) {
            console.log("No se encontraron instancias de Redis en el entorno.");
            return;
        }
        
        const resource = resources[0];
        console.log("Probando con recurso:", resource.name, "ID:", resource.id);
        
        // 1. Probar con la lista de métricas original (incluyendo TotalCommandsProcessed)
        const originalMetrics = [
            "PercentProcessorTime",
            "ServerLoad",
            "UsedMemory",
            "CacheHits",
            "CacheMisses",
            "ConnectedClients",
            "OperationsPerSecond",
            "EvictedKeys",
            "ExpiredKeys",
            "Errors",
            "TotalCommandsProcessed",
            "CacheRead",
            "CacheWrite"
        ];
        
        console.log("\n--- PRUEBA 1: Con TotalCommandsProcessed ---");
        const url1 = `https://management.azure.com${resource.id}/providers/Microsoft.Insights/metrics?api-version=2018-01-01&metricnames=${originalMetrics.join(",")}&timespan=PT24H&interval=PT1H&aggregation=Average`;
        try {
            const res1 = await fetch(url1, { headers: { Authorization: `Bearer ${tokenResponse.token}` } });
            console.log("Status:", res1.status, res1.statusText);
            const json1 = await res1.json();
            if (!res1.ok) {
                console.log("Error de Azure Monitor:", JSON.stringify(json1.error));
            } else {
                console.log("Exitoso. Cantidad de métricas devueltas:", json1.value ? json1.value.length : 0);
            }
        } catch (e) {
            console.log("Excepción en Prueba 1:", e.message);
        }
        
        // 2. Probar sin TotalCommandsProcessed
        const correctedMetrics = [
            "PercentProcessorTime",
            "ServerLoad",
            "UsedMemory",
            "CacheHits",
            "CacheMisses",
            "ConnectedClients",
            "OperationsPerSecond",
            "EvictedKeys",
            "ExpiredKeys",
            "Errors",
            "CacheRead",
            "CacheWrite"
        ];
        
        console.log("\n--- PRUEBA 2: Sin TotalCommandsProcessed ---");
        const url2 = `https://management.azure.com${resource.id}/providers/Microsoft.Insights/metrics?api-version=2018-01-01&metricnames=${correctedMetrics.join(",")}&timespan=PT24H&interval=PT1H&aggregation=Average`;
        try {
            const res2 = await fetch(url2, { headers: { Authorization: `Bearer ${tokenResponse.token}` } });
            console.log("Status:", res2.status, res2.statusText);
            const json2 = await res2.json();
            if (!res2.ok) {
                console.log("Error de Azure Monitor:", JSON.stringify(json2.error));
            } else {
                console.log("Exitoso. Cantidad de métricas devueltas:", json2.value ? json2.value.length : 0);
                const hasData = json2.value.some(m => m.timeseries?.[0]?.data?.length > 0);
                console.log("¿Tiene series temporales con datos?:", hasData);
                if (hasData) {
                    const firstTs = json2.value.find(m => m.timeseries?.[0]?.data?.length > 0);
                    console.log("Ejemplo de datos (primeras 3 filas):", firstTs.timeseries[0].data.slice(0, 3));
                }
            }
        } catch (e) {
            console.log("Excepción en Prueba 2:", e.message);
        }
        
    } catch (err) {
        console.error("Error general en el script:", err);
    }
}

run();
