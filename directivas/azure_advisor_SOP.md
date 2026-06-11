# Directiva: Integración de Azure Advisor

## Objetivo
Implementar el tablero de Azure Advisor replicando las 5 categorías oficiales de Microsoft y permitiendo exportar las métricas de recomendaciones y auditoría general a un CSV consolidado.

## Lógica y Pasos
1. **Backend**: El endpoint `/api/advisor/route.ts` iterará sobre todas las suscripciones permitidas (validando explícitamente el token y el `tenantId`).
2. **Frontend**: `<AdvisorPanel />` consumirá los datos para mostrarlos en 5 tarjetas (Costo, Seguridad, Confiabilidad, Excelencia Operativa y Rendimiento).
3. **Exportación**: El cliente interceptará `/api/audit/full` junto con los resultados actuales para empaquetarlos en un `Blob` de tipo `text/csv`.

## Trampas Conocidas / Restricciones
- **Multitenancy Bug**: Siempre utilizar `selectedTenant.id` provisto por `useTenant()`.
- **Suscripciones Vacías**: Si `GET /subscriptions` devuelve cero elementos, retornar `403 MISSING_RBAC_ROLE` en lugar de fallar silenciosamente.
\n- **Filtrado y Scores**: Las recomendaciones ahora se etiquetan con `subscriptionId`. Se hace fetch a la REST API de Microsoft.Advisor/advisorScore (singular, usando la versión de API `2023-01-01`) para obtener las puntuaciones por categoría y general. La puntuación general del Score no se calcula en el frontend sino que se muestra directamente el valor devuelto por el API bajo el nombre de score `"Advisor"`. Cada tarjeta de categoría muestra su respectiva puntuación individual (por ejemplo, Costo, Seguridad, Confiabilidad, Rendimiento, Excelencia Operativa), utilizando insignias de colores basadas en su valor individual (Verde >= 80%, Amarillo >= 50%, Rojo < 50%, Gris N/A).\n