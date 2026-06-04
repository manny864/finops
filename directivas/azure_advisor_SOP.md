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
\n- **Filtrado y Scores**: Las recomendaciones ahora se etiquetan con `subscriptionId`. Se hace fetch a la REST API de Microsoft.Advisor/advisorScores para promediar la puntuación general en el frontend.\n