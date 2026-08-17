# SOP: Cockpit FinOps y Eficiencia Serverless en Azure Function Apps

## Objetivo
Procedimiento operativo determinista para auditar, optimizar y controlar los costos de **Azure Function Apps (`Microsoft.Web/sites` con `kind: functionapp`)**, resolviendo la relación entre planes de hosting (Consumption vs. Elastic Premium vs. Dedicated), métricas de ejecución (GB-s) y costos ocultos asociados (Storage y Application Insights).

---

## 1. Arquitectura de Costos en Azure Functions

El costo de una Function App se compone de tres vectores principales:
1. **Cómputo Serverless**:
   - **Consumption (Y1)**: Facturación basada estrictamente en invocaciones ($0.20 USD por millón) y consumo de memoria/tiempo en **GB-Segundos** ($0.000016 USD por GB-s), con un subsidio gratuito mensual de 1 millón de ejecuciones y 400,000 GB-s por suscripción.
   - **Elastic Premium (EP1, EP2, EP3)**: Nodos siempre activos (pre-warmed) con tarifa fija por núcleo y RAM (~$150 USD/mes por EP1), independientemente de que reciban tráfico.
   - **Dedicated (App Service Plan)**: Costo fijo del ASP compartido con Web Apps.
   - **Flex Consumption (FC1)**: Nuevo modelo serverless con memoria configurable por función y VNet privada nativa.
2. **Costo de Storage (`AzureWebJobsStorage`)**:
   - Transacciones de lectura/escritura en Blob, Table y Queue storage para checkpoints, triggers y logs internos.
3. **Costo de Telemetría (Application Insights / Log Analytics)**:
   - Ingesta de datos de telemetría ($2.30 USD por GB). Frecuentemente **supera al costo de cómputo en 100x a 2000x** cuando no se activa muestreo (Sampling).

---

## 2. Reglas de Remediación Resolutivas

### 1. Migración a Plan Consumption (Baja Carga Serverless)
- **Gatillo**: Function App en SKU Elastic Premium (EP1/EP2) con invocaciones mensuales $< 100,000$ y sin requerimiento de VNet.
- **Ahorro Estimado**: ~$145 USD/mes por función.
- **Comando Azure CLI**:
  ```bash
  az functionapp plan create --name <plan-consumption-name> --resource-group <resourceGroup> --consumption-only --location <location>
  az functionapp update --name <functionAppName> --resource-group <resourceGroup> --plan <plan-consumption-name>
  ```

### 2. Control de Fuga en Logs & Telemetría (Sampling al 20%)
- **Gatillo**: Ingesta de logs en Application Insights $> 5 \text{ GB/mes}$ o costo de logs $> 3\times$ el costo de cómputo.
- **Ahorro Estimado**: 80% del costo de telemetría (~$28 a $40 USD/mes).
- **Configuración en `host.json`**:
  ```json
  {
    "version": "2.0",
    "logging": {
      "applicationInsights": {
        "samplingSettings": {
          "isEnabled": true,
          "maxTelemetryItemsPerSecond": 5,
          "evaluationInterval": "00:01:00"
        }
      }
    }
  }
  ```

### 3. Detección de Function App Ociosa / Zombie
- **Gatillo**: 0 invocaciones registradas en los últimos 30 días en un plan dedicado (`Dedicated / App Service Plan`).
- **Ahorro Estimado**: 100% del costo del plan ($79.51 USD/mes en Standard S1).
- **Comando Azure CLI**:
  ```bash
  az functionapp stop --name <functionAppName> --resource-group <resourceGroup>
  # O desaprovisionar:
  az functionapp delete --name <functionAppName> --resource-group <resourceGroup>
  ```

### 4. Reducción de Polling en Triggers (Storage Cost)
- **Gatillo**: Millones de transacciones de lectura en Storage Account vinculada por triggers de colas ejecutándose a intervalos por defecto de 100ms.
- **Configuración en `host.json`**:
  ```json
  {
    "extensions": {
      "queues": {
        "maxPollingInterval": "00:00:02",
        "visibilityTimeout": "00:00:30",
        "batchSize": 16
      }
    }
  }
  ```

---

## ⚠️ Restricciones y Trampas Conocidas (Gotchas)

### ❌ Cold Starts en Consumption
- El plan Consumption escala a cero. Funciones en Node.js o Python tardan entre 400ms y 1.5s en primer arranque. Para APIs de baja latencia con tráfico constante, evaluar **Flex Consumption** antes de recurrir a Elastic Premium.

### ❌ Integración de VNet en Consumption Clásico
- El plan Consumption (Y1) estándar no permite inyección de red virtual privada saliente. Si se requiere VNet, la alternativa de menor costo es **Flex Consumption** en lugar de Elastic Premium EP1.
