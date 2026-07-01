# FinOps Maturity Scoring Engine SOP

## Objetivo
Generar un cálculo de madurez alineado al framework de la FinOps Foundation (Crawl, Walk, Run).

## Restricciones/Casos Borde
- Validar siempre `tenantId` en los endpoints.
- Renderizar una interfaz que priorice de un vistazo la salud (Overall Health) usando componentes circulares grandes.
- Mantener consistencia visual y de theming (dark mode).

## Motor de scoring (`src/app/api/intelligence/maturity/route.ts`)
El GET calcula 5 pilares (Visibility, Usage, Rate, Forecasting, Governance) a partir de señales
reales de Azure, agregadas sobre **todas** las suscripciones del tenant (cap `MAX_SUBS_TO_SCAN=10`):
- Suscripciones (`GET /subscriptions`), recomendaciones de Advisor (categoría Cost/Security) y
  presupuestos (Consumption budgets).
- **Regla clave:** distinguir "fuente inaccesible" (sin permiso / throw) de "fuente sin hallazgos".
  Una fuente que lanza NO debe puntuar como perfecta. Cuando Advisor/budgets no son accesibles se
  aplica un baseline neutral (45–50), NO 100. Esto evita que todos los tenants colapsen al mismo
  score constante (bug histórico: 68 fijo cuando Advisor/budgets no eran legibles).
- El scoring usa **densidad** de recomendaciones por suscripción (`costRecs / scannedSubs`) para no
  penalizar injustamente a tenants con muchas suscripciones.
- La respuesta incluye `data.signals` (subscriptionCount, advisorAccessible, budgetsAccessible,
  costRecs, securityRecs, budgetCount, …) para trazabilidad de por qué salió cada score.
- Cache key versionada (`intelligence:maturity:v2:{tenantId}`); bumpear la versión al cambiar la
  fórmula para invalidar scores viejos.