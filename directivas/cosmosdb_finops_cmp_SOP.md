# SOP: Optimización FinOps de Azure Cosmos DB (NoSQL & MongoDB vCore)

## 1. Objetivo
Proveer análisis determinista de sobreprovisionamiento de RU/s, fragmentación de índices, políticas de consistencia multi-región y rightsizing de clústeres MongoDB vCore en Azure Cosmos DB.

## 2. Modelos de Arquitectura
1. **Azure Cosmos DB NoSQL (RU-based):**
   - Modelos: Manual Throughput, Autoscale (10% - 100%) y Serverless (on-demand).
   - Métricas: Throughput Normalizado (`NormalizedRU`), Tasa de Throttling HTTP 429 (`ThrottledRequests`), Ratio de Índices (`IndexRatio`).
   - Gotchas: La directiva de indexación indexa todo por defecto (`/*`). Configurar `excludedPaths` reduce el costo de escritura en un 20-50%.

2. **Azure Cosmos DB for MongoDB vCore (vCore-based):**
   - Modelos: M25, M30, M40, M50, M60, M80, M100, M200.
   - Recursos: `Microsoft.DocumentDB/mongoClusters`.
   - **Gotcha Azure CLI (CRÍTICO):** El comando `az cosmosdb mongocluster update` NO acepta el parámetro `--tier`. El parámetro correcto para configurar la capacidad de cómputo es `--sku` (ej: `--sku "M30"`).

## 3. Snippets Deterministas de Remediación

### A. Rightsizing de MongoDB vCore (Azure CLI)
```bash
az cosmosdb mongocluster update \
  --cluster-name <NOMBRE_CLUSTER> \
  --resource-group <GRUPO_RECURSOS> \
  --sku "M30"
```

### B. Rightsizing de MongoDB vCore (Bicep / ARM)
```bicep
resource mongoCluster 'Microsoft.DocumentDB/mongoClusters@2024-07-01' = {
  name: '<NOMBRE_CLUSTER>'
  location: '<REGION>'
  properties: {
    nodeGroupSpecs: [
      {
        kind: 'Shard'
        sku: 'M30'
        diskSizeGB: 128
        nodeCount: 1
      }
    ]
  }
}
```

### C. Ajuste de Indexing Policy en NoSQL (Azure CLI)
```bash
az cosmosdb sql container update \
  --account-name <NOMBRE_CUENTA> \
  --resource-group <GRUPO_RECURSOS> \
  --database-name <DB_NAME> \
  --name <CONTAINER_NAME> \
  --idx @indexingPolicy.json
```
