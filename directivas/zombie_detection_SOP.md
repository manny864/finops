# SOP: Expansión del Motor de Detección de Recursos Zombis (Flexera Policies)

## Objetivo
Implementar tres políticas de detección de recursos huérfanos/zombis basadas en reglas empresariales de Flexera:
1. `oldSnapshots`: Snapshots antiguos de Azure (> 30 días).
2. `unusedLoadBalancers`: Load Balancers sin configuraciones de IP frontend o sin pools de backend configurados.
3. `unusedVNetGateways`: Virtual Network Gateways sin conexiones activas (conexiones vacías o nulas).

Esto requiere registrar las consultas en `kqlCatalog.ts`, ejecutarlas en el servicio de auditoría de Resource Graph y retornarlas de forma estandarizada en la respuesta de la API/Servicio correspondiente en el formato `{ resourceId, name, resourceType, monthlyCost }` para que la UI (`ZombieResourcesTable`) las renderice automáticamente sin romperse.

## Lógica y Pasos

### 1. Actualización de Catálogo de KQL (`src/modules/core/kqlCatalog.ts`)
- Asegurar o añadir las siguientes consultas:
  - `oldSnapshots`: Buscar snapshots de tipo `microsoft.compute/snapshots` con `properties.timeCreated < ago(30d)`.
  - `unusedLoadBalancers`: Buscar load balancers de tipo `microsoft.network/loadbalancers` con `properties.frontendIPConfigurations` vacío o nulo, o `properties.backendAddressPools` vacío o nulo.
  - `unusedVNetGateways`: Buscar virtual network gateways de tipo `microsoft.network/virtualnetworkgateways` que no tengan conexiones en `microsoft.network/connections`.

### 2. Actualización del Servicio de Auditoría / API de Zombis (`src/app/api/audit/full/route.ts` o servicio correspondiente)
- Ejecutar las consultas KQL correspondientes de manera eficiente.
- Mapear las 3 nuevas colecciones (`oldSnapshots`, `unusedLoadBalancers`, `unusedVNetGateways`) retornadas en el objeto de resultados de auditoría.
- Asegurar que los datos retornados cumplan con la interfaz esperada en el frontend (`{ resourceId, name, resourceType, monthlyCost }` o el formato que `ZombieResourcesTable` requiera).
- En particular, mapear:
  - `id` -> `resourceId` o `id` (dependiendo de la normalización).
  - `name` -> `name` o `resourceName`.
  - `type` -> `resourceType` o `type`.
  - Estimar e incluir el costo mensual (`monthlyCost` o `potentialSavings`).

### 3. Integración en la Interfaz (`ZombieResourcesTable.tsx`)
- Configurar el mapeo de estas tres nuevas claves en el objeto `resourceConfig` de la tabla si no están presentes, garantizando que tengan definidos los textos correspondientes para `issue`, `type`, `armType`, `savings`, e `issueType`.

## Restricciones y Trampas Conocidas
- **Evitar Nombres Duplicados o Colisiones:** Verificar si ya existen claves con nombres similares en `kqlCatalog` (como `staleSnapshots`, `loadBalancers`, o `vnetGateways`) y diferenciar las reglas si es necesario.
- **Formato del Payload:** Validar los campos de la interfaz para evitar desajustes que causen fallas de renderizado en React o TypeScript.
- **Idempotencia y Robustez:** Manejar casos donde las propiedades de Azure sean nulas o no estén definidas usando operadores de coalescencia o filtros defensivos en las consultas KQL.
