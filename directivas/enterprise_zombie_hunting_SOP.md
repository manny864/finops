# SOP: Motor Enterprise de Detección de Recursos Zombis (Flexera Policies)

## Objetivo
Elevar a nivel empresarial el motor de detección de recursos huérfanos/zombis basándose en las directivas de desperdicio de Flexera. Esto requiere garantizar el soporte de consultas concurrentes para 8 tipos de recursos específicos y estandarizar sus salidas bajo la interfaz `{ resourceId, name, resourceType, monthlyCost }`.

## Lógica y Pasos

### 1. KQL Catalog (`src/modules/core/kqlCatalog.ts`)
- Asegurar y registrar las siguientes consultas exactas:
  - `unattachedDisks`: Discos huérfanos.
  - `unattachedPublicIps`: Alias idéntico a `unusedIps`.
  - `unattachedNics`: Alias idéntico a `orphanedNics`.
  - `emptyAppServicePlans`: Server Farms con `numberOfSites == 0` (o JOIN a sitios).
  - `unusedVNetGateways`: VNet Gateways sin conexiones.
  - `unusedLoadBalancers`: Load Balancers con pools de backend vacíos.
  - `oldSnapshots`: Snapshots con antigüedad superior a 30 días.
  - `longStoppedVMs`: VMs en estado `Deallocated` (para mostrar el costo de almacenamiento atado).

### 2. Zombie Cleanup API (`src/app/api/cleanup/zombies/route.ts` y `/api/audit/full/route.ts`)
- Crear/actualizar los endpoints correspondientes para ejecutar concurrentemente (`Promise.all`) las consultas del catálogo KQL.
- Estandarizar los resultados mapeados a la interfaz:
  - `resourceId`: `id` del recurso en Azure.
  - `name`: `name` del recurso.
  - `resourceType`: tipo de recurso en Azure (ej. `Microsoft.Compute/disks`).
  - `monthlyCost`: costo mensual estimado del desperdicio (usando la API de precios de Retail o fallbacks realistas).
- Mantener compatibilidad con los campos de datos esperados en la interfaz de usuario (`id`, `resourceName`, `type`, `armType`, `potentialSavings`, etc.).

### 3. UI Continuity (`src/components/ZombieResourcesTable.tsx`)
- Configurar la correspondencia en `resourceConfig` para los nuevos aliases (`unattachedPublicIps`, `unattachedNics`, `longStoppedVMs`).
- Mapear las cadenas de tipo amigables de Flexera (ej. `ServerFarms`, `VirtualNetworkGateways`, `Snapshots`, `DeallocatedVMs`, `PublicIPAddresses`, `NetworkInterfaces`) a sus respectivas categorías, permitiendo que la tabla renderice correctamente las etiquetas e iconos.

## Restricciones y Trampas Conocidas
- **Formato del JSON devuelto:** La API de limpieza `/api/cleanup/zombies` debe retornar un JSON estructurado y autenticado bajo Zero-Trust.
- **Evitar fallas de renderizado:** Asegurar que todos los campos utilizados en `columns` de `@tanstack/react-table` se resuelvan sin importar si se usan nombres de propiedades estándar o heredados.
