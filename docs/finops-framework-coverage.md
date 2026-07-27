# Cobertura del FinOps Framework por proveedor

> **Nota:** el soporte AWS descrito en este documento fue removido; la plataforma es Azure-only. Se conserva como referencia histórica.

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
| Allocation | ✅ | ✅ | Resuelto por la migración `20260728-001`, que agrega `allocation_tag_hash` a la clave única de `CostSnapshots`. Antes las filas del mismo día/región/servicio con distinto centro de costo se pisaban por `ON DUPLICATE KEY UPDATE` y todo caía en "Sin asignar". **Requiere CUR**: el camino de Cost Explorer no trae etiquetas de recurso. |
| Reporting & Analytics | ✅ | 🟡 | Habilitadas para AWS: Costo por Categoría, Grupos de Costo, Ahorro Capturado, **WhiteBoard** y **TOP Gastos**. En AWS, `resource_group` guarda la **región**, así que los grupos agrupan por región, no por agrupador lógico, y los rankings van por costo (no hay inventario de recursos que contar). |
| Anomaly Management | ✅ | ✅ | La detección por Z-Score corre sobre `CostSnapshots`, que las dos nubes llenan. Lo único atado a Azure era el backfill del historial vía Cost Management, innecesario en AWS porque el sync ya escribe la serie completa. |
| Data Analysis & Showback | ✅ | ✅ | El showback por equipo/producto quedó habilitado junto con Allocation (migración `20260728-001`). |

## 2. Quantify Business Value

| Capability | Azure | AWS | Evidencia / bloqueo |
|---|:--:|:--:|---|
| Planning & Estimating | ✅ | ✅ | Simulador habilitado para las dos nubes. El ahorro por licencias ya no asume el 18 % de AHB en AWS: el porcentaje lo declara el usuario (default 0). |
| Forecasting | ✅ | ✅ | AWS usa `ce:GetCostForecast` cuando el tenant consulta una cuenta puntual (`subscriptionId=account_id`) y mantiene fallback al motor interno (`src/lib/forecasting.ts`) para `All` o cuando CE no responde. |
| Budgeting | ✅ | ✅ | `awsBudgetService.ts` sobre `@aws-sdk/client-budgets`. Sólo lectura y sólo presupuestos de tipo `COST`: los de uso y cobertura de RI/Savings Plans se miden en horas o porcentaje. Crear presupuestos en AWS exigiría permisos de escritura que el rol de onboarding no pide, así que en AWS el alta es sólo en la plataforma. |
| Unit Economics | ✅ | ✅ | Parametrizada: en AWS el costo diario sale de `CostSnapshots`. El DAU y el costo por usuario viven en la base del SaaS y ya eran agnósticos (`buildUnitEconomics`). |
| Benchmarking | 🟡 | ❌ | Solo comparación intra-tenant. |

## 3. Optimize Usage & Cost

| Capability | Azure | AWS | Evidencia / bloqueo |
|---|:--:|:--:|---|
| Architecting for Cloud | 🟡 | ❌ | Cubierta parcialmente por HA y Advisor, ambos Azure. |
| Workload Optimization | ✅ | 🟡 | **Parcial en AWS.** `/api/intelligence/rightsizing` ya opera en AWS sobre inventario real (`getAwsZombies`) y detecta ahorro en recursos ociosos (EBS sin adjuntar, EIP ociosa, snapshots vencidos, instancias detenidas). El **rightsizing por performance** (downsizing por CPU/MEM histórica) sigue pendiente: requiere CloudWatch/Compute Optimizer para paridad completa con Azure. |
| Rate Optimization | ✅ | ✅ | **AWS resuelto** con `awsRateService`: `GetReservationPurchaseRecommendation` y `GetSavingsPlansPurchaseRecommendation` de Cost Explorer, calculadas sobre el uso real de 30 días **descontando la cobertura vigente**. No se recalcula desde el inventario: eso llevaría a recomendar sobre-compra. TTL de 12 h porque cada request cuesta USD 0.01. |
| Licensing & SaaS | ✅ | n/a | AHB y M365 son específicos de Microsoft. En AWS el equivalente (BYOL sobre Dedicated Hosts) requiere datos que hoy no se ingestan. |
| Cloud Sustainability | ✅ | ✅ | **AWS resuelto** con los factores de emisión de 29 regiones AWS sobre el inventario EC2. No se usa el Customer Carbon Footprint Tool: sólo trae datos ya facturados, con hasta 3 meses de retraso y sin API pública. S3 queda fuera del alcance (exigiría `s3:ListAllMyBuckets`) y se informa 0, no una estimación inventada. |

## 4. Manage the FinOps Practice

| Capability | Azure | AWS | Evidencia / bloqueo |
|---|:--:|:--:|---|
| FinOps Practice Operations | ✅ | ✅ | RBAC por tenant, auditoría, alertas y administración son agnósticos. |
| Education & Enablement | ✅ | ✅ | Academy está habilitada para las dos nubes en los tres idiomas. |
| Cloud Policy & Governance | ✅ | 🟡 | **Parcial en AWS.** La auditoría de etiquetas ya funciona con la Resource Groups Tagging API (score de cumplimiento, CSV, filtros). Se ofrece **sólo lectura**: remediar exigiría `tag:TagResources`. Siguen siendo Azure-only Policies, Score, HA, Power Management y Reporting, que dependen de Resource Graph o de `@azure/arm-*`. |
| Invoicing & Chargeback | ✅ | ✅ | Parametrizada sobre `CostSnapshots.Tags`. En el payload compartido `resourceGroup` transporta la región y `chargeType` el servicio, porque AWS no tiene grupos de recursos ni el ChargeType de Azure. |
| Onboarding Workloads | ✅ | ✅ | Onboarding AWS por rol asumido con `ExternalId`, de mínimo privilegio. |
| Intersecting Disciplines | ✅ | ✅ | ITSM, webhooks y exportación FOCUS son agnósticos. |

---

## Gaps priorizados

### ~~Gap 1~~ — Allocation en AWS · **RESUELTO**

Era el de mayor impacto: bloqueaba Allocation, Chargeback, Unit Economics y
Showback por equipo.

Se resolvió con la **opción 2**: la migración
`migrations/20260728-001-costsnapshots-allocation-tags.sql` agrega
`allocation_tag_hash` a la clave única de `CostSnapshots`. Fue segura para los
datos de Azure porque su insert no llena `Tags`, así que el hash queda `''` y la
clave nueva resulta equivalente a la vieja para todo lo ya persistido.

⚠️ **Limitación que persiste**: el camino de Cost Explorer (sin CUR) **no trae
etiquetas de recurso**. Por eso el sync CE ahora bloquea tenants productivos
(`subscription_status=ACTIVE`) sin `cur_bucket` + `cur_prefix` + `cur_region`.
Un tenant que sólo conecte CE sigue sin allocation real.

### Gap 2 — Gobernanza en AWS — **parcialmente resuelto**

La pata de **etiquetado** ya está: `awsResourceInventoryService` usa la Resource
Groups Tagging API, la única API de AWS que lista recursos de todos los
servicios en una sola llamada, y con eso funcionan el inventario transversal y
la auditoría de cumplimiento de etiquetas.

Dos límites que hay que tener presentes al leer los números:

- La Tagging API **sólo devuelve recursos con al menos una etiqueta**, así que
  el denominador del score son los recursos etiquetados, no la cuenta entera.
- **No hay contenedor equivalente al grupo de recursos**, así que no existe
  auditoría de ese nivel ni herencia de etiquetas: los bloques correspondientes
  se ocultan en vez de informar un 100% engañoso.

Lo que sigue abierto (Policies, Score, HA, Reporting) necesita AWS Config con
consultas agregadas, más Trusted Advisor para las recomendaciones —que **exige
plan de soporte Business o Enterprise**, y por eso no se puede asumir. Es
trabajo de módulo nuevo, no de habilitar páginas.

### Gap 3 — Rate Optimization y Forecasting en AWS — **resuelto**

Ambas se resolvieron con la API de Cost Explorer. Forecast usa
`ce:GetCostForecast` para cuentas puntuales y fallback local para el agregado.
Lo que queda abierto en esta rama es el **rightsizing por performance**
(CloudWatch/Compute Optimizer). El módulo de ahorro por ociosidad ya quedó
integrado en `/api/intelligence/rightsizing` para AWS.

### Gap 4 — Precisión (Regla Cero) — **resuelto en Cost Explorer**

`src/lib/aws/costExplorer.ts` ya no usa `parseFloat()` para montos/cantidades
de CE y parsea con `decimal.js`. Mantener la misma disciplina en cualquier
nuevo colector AWS.

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
