# SOP: Cockpit FinOps de Azure SQL & Managed Instance

## 1. Objetivo
Establecer el procedimiento operativo estándar para la auditoría, optimización de costos y gobernanza de bases de datos relacionales en Azure (Single Database, Elastic Pools y SQL Managed Instance).

## 2. Modelos Arquitectónicos y Esquemas de Compra
1. **Single Database (`Microsoft.Sql/servers/databases`):**
   - **DTU:** Basic (5 DTU), Standard (S0-S12, 10-3000 DTU), Premium (P1-P15).
   - **vCore Provisioned:** General Purpose, Business Critical, Hyperscale (Gen5, 2-128 vCores).
   - **vCore Serverless:** Cómputo escalable por segundo con Auto-Pause tras inactividad (ej. 60 min). Ideal para ambientes Dev/Test con carga intermitente.
   - **Base del Sistema (`master`):** Debe ser marcada con `isSystemDatabase: true` para excluirla de alertas de subutilización o rightsizing.

2. **Elastic Pools (`Microsoft.Sql/servers/elasticpools`):**
   - Agrupación de bases de datos que comparten un pool común de eDTUs o vCores.
   - Recomendado para consolidar múltiples Single DBs con patrones de carga complementarios en un mismo servidor.

3. **SQL Managed Instance (`Microsoft.Sql/managedInstances`):**
   - Compatibilidad 100% con SQL Server on-premises, VNet nativa, Agent y Cross-Database queries.
   - Oportunidades: Azure Hybrid Benefit (AHUB) y Reserved Capacity (1 o 3 años).

## 3. Reglas de Remediación Resolutivas

### Regla 1: Migración a SQL Serverless con Auto-Pause (Dev/Test)
- **Criterio:** Single DB en `vCore-provisioned` con CPU medio < 15% en ambientes no productivos.
- **Azure CLI:**
  ```bash
  az sql db update \
    --resource-group <RG> \
    --server <SERVER> \
    --name <DB> \
    --edition GeneralPurpose \
    --family Gen5 \
    --capacity 2 \
    --compute-model Serverless \
    --auto-pause-delay 60
  ```

### Regla 2: Consolidación en Elastic Pool
- **Criterio:** $\ge 2$ bases independientes subutilizadas compartiendo el mismo servidor lógico.
- **Azure CLI:**
  ```bash
  az sql db update \
    --resource-group <RG> \
    --server <SERVER> \
    --name <DB> \
    --elastic-pool <POOL_NAME>
  ```

### Regla 3: Activación de Azure Hybrid Benefit (AHUB SQL)
- **Criterio:** Instancia vCore o Managed Instance con `licenseType == 'LicenseIncluded'`.
- **Azure CLI:**
  ```bash
  az sql db update \
    --resource-group <RG> \
    --server <SERVER> \
    --name <DB> \
    --license-type BasePrice
  ```

### Regla 4: Reducción de Almacenamiento Asignado (Storage Trim)
- **Criterio:** Almacenamiento asignado supera en >3x al espacio de datos utilizado.
- **Azure CLI:**
  ```bash
  az sql db update \
    --resource-group <RG> \
    --server <SERVER> \
    --name <DB> \
    --max-size <NUEVO_TAMANIO_GB>GB
  ```

### Regla 5: Reserva de Capacidad SQL vCore (1 o 3 años)
- **Criterio:** Elastic Pools o Managed Instances productivas operando 24/7 en PAYG.
