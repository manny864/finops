# Cobertura del FinOps Framework por proveedor

Estado de la plataforma frente a las *capabilities* del FinOps Framework de la
FinOps Foundation, abierto por nube. El objetivo es responder con evidencia una
pregunta concreta: **qué ve hoy un tenant AWS y qué le falta respecto de uno de
Azure.**

Última revisión: 2026-07. Método: resolución transitiva de los `import` de cada
`route.ts` bajo `src/app/api/`, marcando como acoplada a Azure toda ruta que
alcance `@azure/arm-*`, `src/lib/azure.ts` o `src/modules/collectors/azure/`.
Se excluyen dos falsos positivos conocidos: `emailHelper.ts` (usa Microsoft
Graph para **enviar mails**) y `secrets/keyVault.ts` (Key Vault de la
plataforma, no del cliente). Ninguno de los dos es "Azure como nube del
tenant".

Leyenda: ✅ cubierta · 🟡 parcial · ❌ no cubierta · n/a fuera de alcance del producto.

---

## 1. Understand Usage & Cost

| Capability | Azure | AWS | Evidencia / bloqueo |
|---|:--:|:--:|---|
| Data Ingestion | ✅ | ✅ | AWS ingesta por dos caminos: Cost Explorer (`/api/sync/aws/[id]/ce`) y CUR en S3 (`.../cur`). Ambos normalizan a FOCUS 1.0. |
| Allocation | ✅ | ❌ | **Bloqueo estructural.** El agregado diario a `CostSnapshots` descarta los tags: su clave única es `(tenant, subscription, date, resource_group, service_name)` y no hay columna de tag en esa dimensión. Los tags de AWS sí se persisten, pero en `FocusLineItems.Tags` y solo por el camino CUR. Consecuencia: todo cae en "Sin asignar". Ver §Gap 1. |
| Reporting & Analytics | ✅ | 🟡 | Habilitadas para AWS: Costo por Categoría, Grupos de Costo, Ahorro Capturado, **WhiteBoard** y **TOP Gastos**. En AWS, `resource_group` guarda la **región**, así que los grupos agrupan por región, no por agrupador lógico, y los rankings van por costo (no hay inventario de recursos que contar). |
| Anomaly Management | ✅ | ✅ | La detección por Z-Score corre sobre `CostSnapshots`, que las dos nubes llenan. Lo único atado a Azure era el backfill del historial vía Cost Management, innecesario en AWS porque el sync ya escribe la serie completa. |
| Data Analysis & Showback | ✅ | 🟡 | Sirve la ingesta de costo, pero sin allocation el showback por equipo/producto no es posible en AWS. |

## 2. Quantify Business Value

| Capability | Azure | AWS | Evidencia / bloqueo |
|---|:--:|:--:|---|
| Planning & Estimating | ✅ | ✅ | Simulador habilitado para las dos nubes. El ahorro por licencias ya no asume el 18 % de AHB en AWS: el porcentaje lo declara el usuario (default 0). |
| Forecasting | ✅ | 🟡 | La serie histórica se reconstruye desde `CostSnapshots` y se proyecta con `linearForecast` (`src/lib/forecasting.ts`). Falta integrar `ce:GetCostForecast` para contrastar contra la proyección del propio proveedor. |
| Budgeting | ✅ | ❌ | `budgetService.ts` importa `@azure/arm-consumption`. |
| Unit Economics | ✅ | ❌ | `/api/intelligence/unit-economics` importa `@azure/arm-costmanagement`. |
| Benchmarking | 🟡 | ❌ | Solo comparación intra-tenant. |

## 3. Optimize Usage & Cost

| Capability | Azure | AWS | Evidencia / bloqueo |
|---|:--:|:--:|---|
| Architecting for Cloud | 🟡 | ❌ | Cubierta parcialmente por HA y Advisor, ambos Azure. |
| Workload Optimization | ✅ | ❌ | `/api/intelligence/rightsizing` importa `src/lib/azure.ts`. AWS necesitaría Compute Optimizer. |
| Rate Optimization | ✅ | ❌ | `/api/intelligence/commitments` importa `@azure/arm-costmanagement`. El equivalente AWS son Savings Plans y Reserved Instances, vía Cost Explorer. |
| Licensing & SaaS | ✅ | n/a | AHB y M365 son específicos de Microsoft. En AWS el equivalente (BYOL sobre Dedicated Hosts) requiere datos que hoy no se ingestan. |
| Cloud Sustainability | ✅ | ❌ | Depende del Emissions Impact Dashboard de Azure. |

## 4. Manage the FinOps Practice

| Capability | Azure | AWS | Evidencia / bloqueo |
|---|:--:|:--:|---|
| FinOps Practice Operations | ✅ | ✅ | RBAC por tenant, auditoría, alertas y administración son agnósticos. |
| Education & Enablement | ✅ | ✅ | Academy está habilitada para las dos nubes en los tres idiomas. |
| Cloud Policy & Governance | ✅ | ❌ | **Toda la sección Gobernanza es Azure.** Policies, Score, Tags, HA, Power Management y Reporting dependen de Azure Resource Graph o de `@azure/arm-*`. Es la sección que un tenant AWS ve vacía. |
| Invoicing & Chargeback | ✅ | ❌ | `/api/intelligence/chargeback` importa `@azure/arm-costmanagement`; además el chargeback sin allocation no tiene sentido. |
| Onboarding Workloads | ✅ | ✅ | Onboarding AWS por rol asumido con `ExternalId`, de mínimo privilegio. |
| Intersecting Disciplines | ✅ | ✅ | ITSM, webhooks y exportación FOCUS son agnósticos. |

---

## Gaps priorizados

### Gap 1 — Allocation en AWS (bloquea 4 capabilities)

Es el de mayor impacto: sin tags en la dimensión agregada no hay Allocation,
Chargeback, Unit Economics ni Showback por equipo.

Los datos **ya se están ingestando** (`FocusLineItems.Tags`, camino CUR); lo que
falta es exponerlos. Dos caminos posibles:

1. Que las vistas de allocation lean de `FocusLineItems` cuando el tenant es AWS.
   No toca el esquema, pero duplica la lógica de agregación.
2. Agregar una dimensión de tag de asignación a `CostSnapshots`, lo que exige
   migración y revisar la clave única para no colapsar filas por
   `ON DUPLICATE KEY UPDATE`.

Pendiente de decisión. La opción 1 es reversible y no arriesga los datos de
Azure ya persistidos, así que es la recomendada para la primera iteración.

Nota: el camino de Cost Explorer (sin CUR) **no trae tags de recurso**. Un
tenant que solo conecte CE va a seguir sin allocation, sea cual sea la opción
elegida. Conviene reflejarlo en el onboarding.

### Gap 2 — Gobernanza en AWS

Requiere un colector de inventario equivalente a Azure Resource Graph. El
candidato natural es AWS Config con consultas agregadas, más Trusted Advisor
para las recomendaciones. Es trabajo de módulo nuevo, no de habilitar páginas.

### Gap 3 — Rate Optimization y Forecasting en AWS

Ambas son alcanzables con la API de Cost Explorer que ya se usa
(`GetSavingsPlansPurchaseRecommendation`, `GetReservationPurchaseRecommendation`,
`GetCostForecast`) sin necesidad de inventario. Son las de mejor relación
valor/esfuerzo después del Gap 1.

### Gap 4 — Precisión (Regla Cero)

`src/lib/aws/costExplorer.ts` usa `parseFloat()` sobre montos que AWS devuelve
como string justamente para no perder precisión. Debe migrar a `decimal.js`
antes de la primera facturación real contra AWS.

---

## Por qué no alcanza con habilitar páginas

La sección Gobernanza no está vacía para AWS por una lista de permisos
incompleta: está vacía porque **el sync de AWS solo persiste costo agregado por
(cuenta, región, servicio)**. No hay inventario de recursos, ni recomendaciones,
ni tags en la dimensión agregada. Habilitar las páginas sin resolver la ingesta
mostraría pantallas vacías o, peor, cifras en cero que se leen como "no hay
desperdicio".

El criterio aplicado para habilitar una ruta es, por eso, doble: que su API no
dependa de Azure **y** que las tablas que consulta las alimente también el sync
de AWS.
