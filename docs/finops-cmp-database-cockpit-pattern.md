# Patrón FinOps/CMP para cockpits de bases de datos

Este documento define el estilo aplicado en `redis-metrics`, `mysql-metrics`, `postgres-metrics`, `sql-metrics`, `cosmos-metrics` y `mongo-metrics` para convertir tableros técnicos en cockpits de decisión FinOps/CMP.

## Objetivo del patrón

Cada módulo de base de datos debe responder estas 5 preguntas:

1. **¿Cuánto cuesta hoy y cuánto va a costar al cierre?**
2. **¿Ese costo está alineado con uso real?**
3. **¿Qué riesgo operativo hay si optimizamos?**
4. **¿Qué acciones priorizamos primero?**
5. **¿Cuál es el impacto económico esperado por acción?**

## Contrato de datos estándar

Además de `instances[]` y `history[]`, el endpoint debe devolver:

- `financialSummary`: `mtdCost`, `forecastEom`, `deltaMoM`, `potentialSavings`
- `efficiency`: `costPerUsedGb`, `costPerKOps`, `underutilizedCount`
- `risk`: `healthScore`, `criticalAlerts`
- `recommendations[]`: `title`, `instanceId`, `monthlySavings`, `risk`, `confidence`, `actionType`

Esto permite mantener valor FinOps aunque una parte de telemetría operativa falle.

## Reglas de implementación

1. **Costo por recurso real primero**  
   Usar Cost Management por `ResourceId` (`getResourceCostsById`) para evitar atribuciones débiles por `ResourceType`.

2. **Fallback financiero obligatorio**  
   Si Cost Management devuelve 0, usar `CostSnapshots` MTD por `service_name` del motor y distribuir entre instancias detectadas.

3. **Telemetría opcional, finanzas no**  
   Si Azure Monitor no devuelve serie temporal, mantener `monthlyCostUsd` y recomendaciones con `confidence=low`.

4. **Recomendaciones accionables siempre**  
   Además de reglas por umbral (CPU/IO/storage/conexiones), incluir recomendación base cuando hay costo y no se disparó ninguna regla.

5. **Descubrimiento robusto de subscriptions**  
   No depender solo de `/subscriptions`; combinar con fuentes persistidas del tenant (delegaciones/snapshots).

## Ejecución operativa (Azure + local)

- **Azure (prod):** cron jobs `prewarm-cosmos-finops`, `prewarm-mongo-finops`, `prewarm-sql-finops`, `prewarm-mysql-finops` y `prewarm-postgres-finops` cada 20 minutos (`infra/terraform/environments/prod/terraform.tfvars`).
- **Azure (dev ejemplo):** entrada equivalente en `dev/terraform.tfvars.example`.
- **Local:** scripts `npm run cron:prewarm:cosmos-finops`, `npm run cron:prewarm:mongo-finops`, `npm run cron:prewarm:sql-finops`, `npm run cron:prewarm:mysql-finops` y `npm run cron:prewarm:postgres-finops` que invocan sus endpoints `/api/cron/prewarm-*-finops` con `CRON_SECRET`.

## Cómo replicarlo a otro motor (ej. PostgreSQL, MongoDB, SQL MI)

1. Crear/ajustar endpoint `<engine>-metrics` con el contrato estándar.
2. Reutilizar:
   - `listResourcesByTypes`
   - `getResourceCostsById`
   - cache de diagnósticos (`getDiagnosticsCacheKey`, `readDiagnosticsCache`, `writeDiagnosticsCache`)
3. Definir métricas operativas del motor (Azure Monitor).
4. Implementar `buildFinOpsSummaries` + `deriveRecommendations` del motor.
5. Agregar fallback de costo desde `CostSnapshots`.
6. Crear cron `prewarm-<engine>-finops` y registrar schedule en Terraform.
7. Actualizar UI del tablero al mismo patrón (KPIs financieros, eficiencia, riesgo, recomendaciones).

## Nota de precisión

Para decisiones de costo, conservar precisión decimal (DB: `DECIMAL`, backend: agregación controlada y redondeo final de presentación).
