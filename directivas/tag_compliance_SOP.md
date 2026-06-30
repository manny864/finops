# SOP: Motor de Cumplimiento de Etiquetas (Tag Compliance Engine)

## Objetivo
Implementar un "Tag Compliance Engine" inspirado en las políticas de cardinalidad de Flexera para evaluar el cumplimiento de etiquetado en todos los recursos de Azure de un inquilino. Este motor identificará recursos completamente sin etiquetas y recursos con etiquetas obligatorias faltantes ('Environment' y 'CostCenter'), calculará una puntuación de cumplimiento dinámica (%) y permitirá a los usuarios visualizar los recursos infractores en la interfaz.

## Lógica y Pasos

### 1. Catálogo KQL (`src/modules/core/kqlCatalog.ts`)
- Registrar las siguientes consultas KQL:
  - `completelyUntaggedResources`: Busca todos los recursos (`Resources`) donde el atributo `tags` es nulo o el tamaño del diccionario de etiquetas es 0 (`dictionary_size(tags) == 0`).
  - `missingMandatoryTags`: Busca todos los recursos (`Resources`) donde faltan las etiquetas obligatorias 'Environment' o 'CostCenter'. Para hacer esto dinámico y flexible, usamos `isnull(tags['Environment']) or isnull(tags['CostCenter'])`.

### 2. API de Cumplimiento de Etiquetas (`src/app/api/tags/compliance/route.ts`)
- Obtener el `tenantId` y de forma opcional el `subscriptionId` desde los parámetros de búsqueda o cabeceras.
- Ejecutar las consultas KQL concurrentemente en Azure Resource Graph.
- Calcular un `complianceScore` (porcentaje de recursos en cumplimiento vs recursos infractores).
  - La cantidad total de recursos del inquilino se puede obtener mediante una consulta rápida de conteo (`Resources | summarize count()`).
  - `complianceScore = ((Total Resources - Violating Resources) / Total Resources) * 100`. Si no hay recursos, se define como 100%.
- Mapear la lista de recursos infractores (`violatingResources`) incluyendo detalles: `resourceId`, `name`, `type`, `resourceGroup`, `subscriptionId`, `location`, y el motivo del incumplimiento (ej. "Sin etiquetas" o "Falta Environment/CostCenter").
- Retornar `{ success: true, data: { complianceScore, violatingResources } }`.

### 3. UI de Cumplimiento (`src/app/[locale]/governance/tags/page.tsx`)
- Consumir el nuevo endpoint `/api/tags/compliance`.
- Mostrar el `complianceScore` utilizando un indicador de progreso circular responsivo.
- Renderizar una tabla con los recursos que violan la política, detallando Nombre, Tipo, Suscripción, Grupo de Recursos y el Motivo de infracción.

## Restricciones y Trampas Conocidas
- **Evitar datos mock o hardcodeados:** No inyectar listas estáticas de recursos infractores. Si no hay recursos en el tenant, la tabla debe mostrarse vacía y el cumplimiento en 100%.
- **Configuración de Etiquetas Obligatorias:** Definir las etiquetas obligatorias como constantes configurables en el backend (`['Environment', 'CostCenter']`) para que puedan expandirse en el futuro.
