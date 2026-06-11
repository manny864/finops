# SOP: Optimización de Desperdicio PaaS y Long Stopped Instances (Flexera Policies)

## Objetivo
Implementar dos políticas empresariales de Flexera en la plataforma FinOps:
1. **Desperdicio PaaS (Unused App Service Plans):** Registrar y ejecutar la consulta `emptyAppServicePlans` con un Join real en KQL. Calcular costos con el servicio de precios de Azure (Retail API) y un fallback según la categoría (P/S/B/etc.), integrando el resultado en la vista de Zombis (Fugas Financieras).
2. **Long Stopped Instances (Falsos Ahorros):** Detectar VMs persistentemente deallocated con discos de almacenamiento asociados. Calcular el costo oculto de estos discos e incluirlos como una recomendación especial en la vista de Rightsizing, permitiendo al usuario Snapshot/Borrar la máquina.

## Lógica y Pasos

### 1. KQL Catalog (`src/modules/core/kqlCatalog.ts`)
- **Query `emptyAppServicePlans`:** Usar un Join explícito para cruzar `microsoft.web/serverfarms` con `microsoft.web/sites` y filtrar aquellos planes con recuento de sitios igual a 0.
- **Query `longStoppedVMs`:** Consultar `microsoft.compute/virtualmachines` buscando estado `PowerState/deallocated`. Proyectar las propiedades de discos: `osDiskId = tolower(tostring(properties.storageProfile.osDisk.managedDisk.id))` y la colección `dataDisks`.

### 2. Pricing Fallback (`src/app/api/audit/full/route.ts`)
- Mapear costos de `emptyAppServicePlans` consultando `getMonthlyCostEstimate("App Service", sku, location)`.
- Si retorna 0 o falla, aplicar un fallback basado en la primera letra del SKU:
  - `P` (Premium): $150.00 USD
  - `S` (Standard): $75.00 USD
  - `B` (Basic): $55.00 USD
  - Otros: $45.00 USD
  - Shared/Free: $0.00 USD
- Estandarizar el objeto devuelto con las propiedades `{ resourceId, name, resourceType, monthlyCost }` para compatibilidad en el dashboard de fugas financieras.

### 3. Derechos de VM Paradas / Rightsizing (`src/app/api/intelligence/rightsizing/route.ts`)
- Consultar en paralelo tanto las VMs normales como las de `longStoppedVMs`.
- Consultar todos los discos (`microsoft.compute/disks`) de la suscripción para armar un mapa rápido de `diskId -> { diskSizeGB, sku }`.
- Para cada VM deallocated, sumar el tamaño de su OS Disk y Data Disks adjuntos.
- Calcular el costo de almacenamiento usando la Retail API o un valor estándar ($0.15 por GB).
- Retornar estos elementos en la respuesta con:
  - `recommendedSku`: `"Snapshot & Delete"`
  - `isUnderutilized`: `true`
  - `reason`: `"Deallocated VM with attached Storage"`
  - `hiddenCost`: el costo calculado de los discos.
  - `maxCpu`: `0`

### 4. UI Rightsizing (`src/app/[locale]/intelligence/rightsizing/page.tsx`)
- Detectar si `vm.reason === 'Deallocated VM with attached Storage'`.
- En caso afirmativo, mostrar un badge/texto especial para advertir del costo oculto.
- Cambiar el botón de acción a "Snapshot & Delete".
- Al hacer clic, invocar `/api/remediation` enviando el tipo de recurso `microsoft.compute/virtualmachines` para destruir la VM o alertar al usuario.

## Restricciones y Trampas Conocidas
- **Manejo de nulos en discos:** Una VM deallocated puede tener discos no administrados o un perfil de almacenamiento incompleto. Utilizar validaciones seguras (`?.`) y fallbacks.
- **Evitar duplicación de VMs:** Al mezclar los dos flujos en el backend de rightsizing, filtrar VMs duplicadas (si una VM parada también es clasificada por CPU).
