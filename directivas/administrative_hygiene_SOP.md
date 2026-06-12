# SOP: Higiene Administrativa (Detección de Grupos de Recursos Vacíos)

## Objetivo
Implementar la detección de "Higiene Administrativa" para identificar Grupos de Recursos (Resource Groups) vacíos en Azure que no contienen ningún recurso, clasificándolos como desperdicio administrativo con un costo mensual de $0 y mostrándolos en la interfaz de usuario de recursos zombis bajo una insignia distinta de "Higiene" en lugar de un indicador financiero.

## Lógica y Pasos

### 1. Catálogo KQL (`src/modules/core/kqlCatalog.ts`)
- Utilizar la consulta `emptyRgs` ya registrada o ajustarla:
  - `emptyRgs`: `ResourceContainers | where type =~ 'microsoft.resources/subscriptions/resourcegroups' | extend rgAndSub = strcat(name, '--', subscriptionId) | join kind=leftouter (Resources | extend rgAndSub = strcat(resourceGroup, '--', subscriptionId) | summarize count() by rgAndSub) on rgAndSub | where isnull(count_) | project id, name, location, resourceGroup=name, subscriptionId`

### 2. API de Cleanup (`src/app/api/cleanup/zombies/route.ts`)
- Añadir `emptyRgs` a la lista de objetivos a consultar en paralelo.
- Para cada Grupo de Recursos vacío detectado:
  - Definir `monthlyCost` y `estimatedMonthlyCost` como `0`.
  - Asignar una propiedad de categoría especial `hygiene: true` o `category: 'Hygiene'` para diferenciarlo de las pérdidas monetarias tradicionales.
  - El tipo de recurso es `microsoft.resources/subscriptions/resourcegroups`.
  - Mapear a la interfaz estándar de zombies: `{ resourceId, name, resourceType, monthlyCost: 0, isHygiene: true }`.

### 3. UI de Cleanup (`src/components/ZombieResourcesTable.tsx`)
- Adaptar la tabla de recursos zombis para admitir e identificar registros de higiene (`isHygiene: true` o costo $0).
- Si un recurso tiene la propiedad de higiene activa, renderizar un badge estilizado `"Higiene"` o `"Limpieza"` (por ejemplo, con fondo azul/violeta suave) y mostrar "$0.00" o "N/A" para el ahorro financiero, en lugar de alertar sobre pérdidas monetarias.
- El botón de eliminación debe estar habilitado, permitiendo eliminar el grupo de recursos vacío a través de la API de remediación existente.

## Restricciones y Trampas Conocidas
- **Mapeo de RG en KQL:** En `ResourceContainers`, la propiedad `resourceGroup` puede no estar presente de forma natural (ya que el contenedor *es* el grupo de recursos). Por lo tanto, debemos proyectar `resourceGroup=name` para evitar valores nulos que rompan la tabla o el selector en la UI.
- **Badge de Higiene:** Asegurar que los estilos utilicen clases existentes de CSS o Tailwind que aporten un diseño moderno y premium, evitando colores chillones.
