# Directiva: Integración de Azure Advisor

## Objetivo
Implementar el tablero de Azure Advisor replicando las 5 categorías oficiales de Microsoft (Costo, Seguridad, Confiabilidad, Rendimiento y Excelencia Operativa) y permitiendo exportar las métricas de recomendaciones y auditoría general a un CSV consolidado, con soporte integral multi-idioma (es, en, pt-BR).

## Lógica y Pasos
1. **Backend**: El endpoint `/api/advisor/route.ts` itera sobre todas las suscripciones permitidas (validando explícitamente el token y el `tenantId`).
2. **Frontend**: `<AdvisorPanel />` consume los datos para mostrarlos en 5 tarjetas y pestañas.
3. **Exportación**: El cliente genera y descarga el CSV consolidado con encabezados localizados según el idioma activo.

## Trampas Conocidas / Restricciones
- **Multitenancy**: Siempre utilizar `selectedTenant.id` provisto por `useTenant()`.
- **Suscripciones Vacías**: Si `GET /subscriptions` devuelve cero elementos, retornar `403 MISSING_RBAC_ROLE` en lugar de fallar silenciosamente.
- **Filtrado y Scores**: Las recomendaciones se etiquetan con `subscriptionId`. Se hace fetch a la REST API de Microsoft.Advisor/advisorScore (versión `2023-01-01`) para obtener las puntuaciones por categoría y general. La puntuación general del Score no se calcula en el frontend sino que se muestra directamente el valor devuelto por el API bajo el nombre de score `"Advisor"`. Cada tarjeta de categoría muestra su respectiva puntuación individual con insignias de colores (Verde >= 80%, Amarillo >= 50%, Rojo < 50%, Gris N/A).
- **Internacionalización Integral (i18n)**: La API REST de Azure Advisor a menudo devuelve los textos en inglés independientemente del header `Accept-Language`. Todas las recomendaciones y acciones deben pasar por `translateAdvisorText(text, locale, kind)` en `src/lib/advisorI18n.ts`, cubriendo los 5 pilares (Costo, Seguridad, Confiabilidad, Rendimiento y Excelencia Operativa).
- **Extracción de Nombres de Recursos**: Nunca mostrar URIs completas de ARM (ej. `/subscriptions/.../virtualMachines/vm-01`) en la columna Recurso; usar `extractResourceDisplayName()` para mostrar el nombre limpio del recurso y el Resource Group como subtítulo.
- **Ocultamiento de IDs Técnicos**: Las claves de `extendedProperties` que contengan GUIDs o IDs (`recommendationTypeId`, `recommendationId`, `ruleId`, etc.) deben estar en `HIDE_EXT_KEYS` para no crear columnas con GUIDs.
- **Traducción de Columnas Dinámicas**: Los encabezados de columnas generadas dinámicamente desde `extendedProperties` deben traducirse mediante `translateColumnHeader(headerKey, locale)`.