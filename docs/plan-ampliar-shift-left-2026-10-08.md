# Plan: ampliar Shift-Left FinOps (PR Cost Estimator, MEJ-20)

> **Estado: ejecutado el 2026-10-08** (fases 0 a 6), con lo que quedó afuera en la
> sección 9. Tres commits sobre `main`: `1f8ea61` (el estimador cubre 18 tipos de
> recurso, elige bien el medidor y lee Bicep), `cc56e98` (descuento del cliente,
> Budget Gate por presupuesto y aviso al superarlo) y `2b523ab` (un script único de
> CI para GitHub, Azure DevOps y GitLab, y la pantalla que lo explica). Detalle
> técnico en `docs/lld/00-lld-completo.md` §45 y arquitectónico en
> `docs/hld/00-hld-completo.md` §20. Las secciones 1 a 8 son el plan tal como se
> escribió: **la 1 describe lo que había antes de ejecutarlo**.
>
> **Lo verificado y lo que no.** Todo lo que se dice del repo se leyó el
> 2026-10-08 (archivos citados). Los contratos de Azure —nombres de
> `serviceName`, `skuName`, `meterName` de la Retail Prices API, y el formato de
> `az deployment group what-if`— **no estaban verificados** al escribir el plan;
> al ejecutarlo se leyeron en `learn.microsoft.com` y se probaron con consultas
> reales (sección 9, con lo que sigue sin verificar). Un `serviceName` o un
> `skuName` equivocado devuelve `Items: []` con HTTP 200, o sea un costo 0
> silencioso, no un error (ya está documentado en el propio servicio).

## 1. Qué hacía antes de ejecutar este plan

`terraform show -json` → `POST /api/v1/shift-left/estimate` → delta de costo
mensual con precios de lista → comentario en el PR y Budget Gate por repositorio.

| Pieza | Dónde |
|---|---|
| Estimador | `src/services/iacCostEstimator.service.ts` |
| API pública (scope `write:shift-left`, plan hasta 6 MB) | `src/app/api/v1/shift-left/estimate/route.ts` |
| Historial y KPIs (Business+) | `src/app/api/governance/shift-left/route.ts`, `src/components/dashboard/ShiftLeftGovernanceBoard.tsx` |
| Umbral por repositorio (Admin/Owner) | `src/app/api/governance/shift-left/gates/route.ts`, tabla `IacBudgetGates` |
| GitHub Action (composite) | `integrations/github-action/` |
| Precios | `getMonthlyCostEstimate` en `src/services/pricingService.ts` (cacheado, normaliza a 730 h/mes) |

Cobertura de recursos: **cuatro tipos de Terraform** (`azurerm_linux_virtual_machine`,
`azurerm_windows_virtual_machine`, `azurerm_managed_disk`, `azurerm_public_ip`) más
una lista de tipos sin costo (resource groups, subredes, NICs…). Todo lo demás
cae en `tipo-no-soportado` y se cuenta como "sin tarifar".

## 2. Brechas encontradas

Ordenadas por cuánto frenan que el cliente le saque valor.

| # | Brecha | Evidencia | Efecto |
|---|---|---|---|
| 1 | ✅ *Cerrada.* **El scope `write:shift-left` no se podía otorgar desde la pantalla de API Keys.** | `PublicApiScope` (`src/types/publicApiKey.types.ts`) y la lista de `ApiKeysPanel.tsx:60-65` tienen seis scopes y ninguno es ése. El alta (`api/admin/public-api-keys/route.ts:57`) acepta cualquier arreglo sin validarlo | El manual (11.10) y el texto de la pantalla vacía dicen que se otorga "al generar la key", pero la interfaz no lo ofrece. Hoy sólo se puede por llamada directa a la API. Sin esto nadie puede empezar |
| 2 | **La Action no se puede usar tal como está.** | El ejemplo hace `uses: ./integrations/github-action`: la carpeta vive en este repo y no hay un repo ni un Marketplace de donde referenciarla | El cliente tiene que copiar la carpeta a su repositorio y mantenerla a mano |
| 3 | **Cobertura de cuatro tipos.** | `CATALOGO` en el estimador | Un PR que crea una base de datos, un AKS o un App Service muestra delta 0 para eso. El comentario avisa "no se pudieron tarifar", pero un número bajo se lee como "esto es barato" |
| 4 | **Precios de lista.** | El README de la Action y el manual | No refleja reservas, savings plans, Hybrid Benefit ni descuentos de contrato |
| 5 | **Sólo Terraform.** | El estimador lee `resource_changes[]` | Quien use Bicep/ARM, o pipelines que no sean GitHub, no puede usarlo |
| 6 | **El gate compara con un umbral fijo por repo**, no con el presupuesto disponible. | `IacBudgetGates` (tenant, repo, USD) | No dice "este PR consume el 40% del presupuesto que queda del centro de costos" |
| 7 | **Valores desconocidos al planear.** | El estimador lee `change.after`; Terraform marca en `after_unknown` lo que se resuelve en el apply | Un SKU calculado o venido de otro recurso llega vacío y el recurso queda `sin-sku`. Verificar con planes reales |
| 8 | **El plan viaja entero.** | La Action manda `plan` completo; el servidor guarda sólo `lineas` (`route.ts:158`) | Un plan puede contener valores sensibles y datos del tenant, y no hace falta mandarlos: el estimador usa sólo tipo, dirección, acciones, `location` y el SKU. Relaciona con el principio de minimización de `docs/plan-despliegue-europa-gdpr-2026-10-07.md` |
| 9 | ✅ *Cerrada: Enterprise.* **Desfase de tier.** | `routeTiers.ts:122` marca `/admin/api-keys` como Enterprise; la API de claves, el manual y el módulo dicen Business | Verificar cuál es el real: si es Enterprise, un cliente Business no podría crear la clave que el módulo exige |
| 10 | **Lo que se cobra por uso no se puede estimar.** | Storage por GB usados, egress, transacciones, tokens | Hoy se mezcla con "no soportado". Hace falta distinguirlo |

## 3. Principios

1. **Informar de menos y decirlo** (es la regla actual: el delta es un piso).
   Cada tipo nuevo se suma sólo cuando se pudo comprobar su precio.
2. **No crear un catálogo de precios nuevo.** `MEJ-32` documenta la duplicación
   de catálogos como el bug recurrente del repo; todo pasa por `pricingService`.
3. **Cada mapeo nace de un plan real y de una consulta real** a la Retail API,
   como se hizo el 2026-09-22 con Terraform 1.15.8 y azurerm 4.x. Nada "por
   analogía" con otro servicio.
4. **Un cero silencioso es un bug.** Un precio 0 con SKU y región válidos ya se
   marca `sin-precio`; los tipos nuevos heredan esa defensa.

## 4. Fases

### Fase 0 — Desbloqueo (pequeña, hacerla primero)

**Estado: hecha** (sección 9).

- ~~Sumar `write:shift-left` a `PublicApiScope` y al panel, y validar los scopes
  del alta contra una lista cerrada.~~ Hecho (`PUBLIC_API_SCOPES`, con un test que
  falla si una ruta exige un scope que no se puede otorgar).
- ~~Resolver la brecha 9 (tier).~~ Hecho: Enterprise.
- Decidir cómo se distribuye la Action (brecha 2): repo público propio
  (`uses: org/finops-pr-cost-estimator@v1`) o instrucciones de copia. La primera
  es la que escala.
- Test: que una clave sin el scope reciba 403 y una con el scope pase.

### Fase 1 — Más recursos, en el orden que marque el gasto real

**Estado: hecha en parte:** 18 tipos, `por-uso` y `valor-al-aplicar`; faltan las bases de datos administradas y el orden por gasto real (sección 9).

**Criterio de orden:** no adivinar. Ranquear los tipos por el gasto agregado de
los tenants de la plataforma (las propias tablas de costo) y por lo fácil que
sea mapearlos. Candidatos, sin orden definido todavía:

| Familia | Tipos de Terraform candidatos | Cómo se tarifa |
|---|---|---|
| Cómputo | `azurerm_virtual_machine_scale_set` / `azurerm_linux_virtual_machine_scale_set` / `azurerm_windows_virtual_machine_scale_set`, `azurerm_kubernetes_cluster` y `azurerm_kubernetes_cluster_node_pool` | Mismo precio de VM × cantidad de instancias o nodos |
| Bases de datos | `azurerm_mssql_database`, `azurerm_mssql_elasticpool`, `azurerm_mysql_flexible_server`, `azurerm_postgresql_flexible_server`, `azurerm_redis_cache`, `azurerm_cosmosdb_account` | SKU + almacenamiento aprovisionado (+ RU/s aprovisionadas en Cosmos) |
| Aplicaciones | `azurerm_service_plan` | SKU del plan |
| Redes | `azurerm_application_gateway`, `azurerm_lb` (Standard), `azurerm_nat_gateway`, `azurerm_firewall`, `azurerm_bastion_host`, `azurerm_virtual_network_gateway`, `azurerm_private_endpoint` | Cargo fijo por hora; el procesamiento por GB es de uso |

Por cada tipo: plan de ejemplo real como fixture en `__tests__/`, consulta a la
Retail API con el `serviceName`/`skuName` correcto (anotar el comando y el
resultado), y un caso de `update` y de `replace`, no sólo de `create`.

**Clasificar mejor lo que no se estima.** Agregar el motivo `por-uso` (Storage,
egress, transacciones) para que no se confunda con "tipo no soportado": al
usuario le cambia la lectura. En el comentario del PR, agrupar la lista de lo no
tarifado por motivo.

**Resolver la brecha 7** con planes reales que usen `for_each`, módulos y SKUs
calculados: si hay valores en `after_unknown`, mostrarlos como "SKU se define al
aplicar" en lugar de `sin-sku`.

### Fase 2 — Precio del cliente en lugar de precio de lista

**Estado: hecha en parte:** la opción A; la B y la C no (sección 9).

El mayor salto de credibilidad: que el delta se parezca a lo que el cliente paga.
Opciones, de menor a mayor esfuerzo:

| Opción | Cómo | Pros / contras |
|---|---|---|
| **A. Factor de descuento por tenant** | Un porcentaje configurable (la plataforma ya tiene `markup`, `rateService`) aplicado sobre la lista, mostrando los dos números | Simple y explícito. Es un promedio, no el precio real de cada medidor |
| B. Factor derivado de la facturación real | Relación entre costo efectivo y costo de lista del tenant, por servicio | Sin configuración manual. Hay que calcularlo y puede estar contaminado por reservas puntuales |
| C. Precio con reserva | Mostrar también el precio con reserva o savings plan | La Retail API distingue el tipo de precio (verificarlo en Learn); cubre sólo lo que el cliente hubiera comprado |

Recomendación: A primero, con la leyenda "lista" y "con tu descuento" visibles.

### Fase 3 — Contexto de presupuesto

**Estado: hecha** (sección 9).

Mapear cada repositorio a un centro de costos o suscripción (hoy `IacBudgetGates`
sólo tiene tenant + repo + USD). Con eso el comentario puede decir cuánto del
presupuesto restante consume el PR, y el gate puede bloquear por porcentaje del
presupuesto, no sólo por monto absoluto.

### Fase 4 — Menos fricción para sumar repositorios

**Estado: hecha** (sección 9).

- **Azure DevOps Pipelines** (tarea o plantilla YAML). Para un producto de FinOps
  de Azure es probable que sea tan pedido como GitHub. Verificar cuántos clientes
  lo usan antes de priorizarlo.
- **GitLab CI** y un **script genérico** (`curl` + `jq`) para cualquier otro CI.
- **Reducir el plan en el cliente** (brecha 8): que la Action mande sólo
  `address`, `type`, `actions`, `location` y los campos de SKU. Menor tamaño,
  menos datos sensibles en tránsito, y el límite de 6 MB deja de importar.

### Fase 5 — Otros lenguajes de IaC

**Estado: hecha en parte:** OpenTofu y Bicep; Pulumi no (sección 9).

- **OpenTofu**: usa el mismo formato de plan; verificar y documentar.
- **Bicep/ARM**: no tienen `terraform plan`. La alternativa es `az deployment
  group what-if`, que devuelve cambios con propiedades antes y después. Hay que
  verificar su formato de salida en Learn y escribir un lector aparte.
- **Pulumi**: sólo si hay demanda.

### Fase 6 — Experiencia en la plataforma

**Estado: hecha** (sección 9).

Detalle por PR con el desglose por recurso, tendencia por repositorio,
exportación, aviso por Teams cuando se supera un umbral, y mostrar en el
comentario cómo cambió la estimación respecto del push anterior.

## 5. Cómo saber que funciona

| Métrica | Para qué |
|---|---|
| Proporción de recursos tarifados sobre el total de los planes reales | Mide la cobertura, que es la brecha principal |
| Repositorios con al menos una estimación en los últimos 30 días | Mide adopción real |
| **Estimación vs costo real a 30 días del deploy** | La que da credibilidad: comparar el delta estimado del PR con lo que después se factura por esos recursos |
| PRs cuyo delta bajó entre el primer y el último push | Mide si la conversación de costo cambió el diseño |

## 6. Riesgos

- **Precios silenciosamente en cero** por un mapeo equivocado: mitigado con la
  regla 3 y el motivo `sin-precio`.
- **Cuota de la Retail API**: ya hay caché; con más tipos y más repos conviene
  medir las llamadas antes de abrir la cobertura (como pasó con los 429 de
  Resource Graph).
- **Falsa tranquilidad**: aun con más cobertura el número es un piso. Mantener el
  aviso de "sin tarifar" visible, no escondido en un desplegable.
- **Estimar de más con precios de lista** cuando el cliente tiene descuentos
  grandes: por eso la Fase 2 va antes de prometer exactitud.

## 7. Decisiones abiertas

1. ~~¿Distribución de la Action: repo público o copia manual?~~ Resuelta sin repo público: un script que se descarga de la plataforma con su SHA-256 fijado; la Action composite lo envuelve (sección 9).
2. ~~¿Qué tier es el correcto para crear las claves?~~ Resuelta: Enterprise.
3. ~~¿Qué tipos de recurso entran primero?~~ Se tomó la lista de candidatos del plan; el ranking de gasto real no se pudo medir (sección 9).
4. ~~¿Descuento por tenant manual (A) o derivado (B)?~~ Resuelta: A. La B queda como mejora posible.
5. ~~¿Azure DevOps entra antes que Bicep?~~ Entraron los dos, y GitLab, porque comparten el script.
6. ¿Se publica la métrica de exactitud (estimado vs real) a los clientes? Sigue abierta: ni siquiera se mide todavía.

## 8. Cómo retomar lo que queda

Ver la sección 9. En orden: verificar Bicep con un `what-if` real, medir el ranking
de gasto por tipo de recurso con datos de producción, y recién entonces decidir si
las bases de datos administradas entran. Antes de cada tipo nuevo, igual que antes:
plan real, consulta real a la Retail API y su comando anotado.

## 9. Estado de la ejecución (2026-10-08)

| Brecha o fase | Estado | Qué se hizo o por qué no |
|---|---|---|
| 1. Scope en la pantalla de API Keys | ✅ | Antes de este plan |
| 2. La Action no se puede referenciar | ✅ | El cliente copia un archivo desde la pantalla *Conectar tu pipeline*; el script se descarga de la plataforma y el workflow **fija su SHA-256**. La Action composite sigue en `integrations/github-action` y no tiene repo público propio: no hace falta para usar el script |
| 3. Cobertura de cuatro tipos | ✅ en parte | 18 tipos de Terraform (y sus equivalentes ARM). **No** están las bases de datos administradas, `azurerm_private_endpoint` ni `azurerm_mssql_elasticpool` |
| 4. Precios de lista | ✅ en parte | Descuento por tenant (opción A), con los dos números en el comentario. Hybrid Benefit de VMs Windows sí. Reservas y Savings Plans no |
| 5. Sólo Terraform y GitHub | ✅ en parte | Terraform, OpenTofu y Bicep; GitHub, Azure DevOps y GitLab. Pulumi no |
| 6. Gate con umbral fijo | ✅ | Por monto, por % de lo que queda del presupuesto del centro de costos, o los dos. Usa el presupuesto **base**: no suma el arrastre |
| 7. Valores desconocidos al planear | ✅ | Motivo `valor-al-aplicar`, a partir de `after_unknown` |
| 8. El plan viaja entero | ✅ | El script reduce a una lista de atributos permitidos; el plan reducido se estima igual |
| 9. Tier | ✅ | Enterprise (antes de este plan) |
| 10. Lo que se cobra por uso | ✅ | Motivo `por-uso`, aparte de los no soportados, con su contador |
| Fase 0 | ✅ | Ver las brechas 1, 2 y 9 |
| Fase 1 | ✅ en parte | Ver las brechas 3 y 7 y 10. El **orden por gasto real** no se siguió: no se pudo medir |
| Fase 2 | ✅ en parte | La opción A. No hay B (derivado de la facturación) ni C (precio con reserva) |
| Fase 3 | ✅ | Ver la brecha 6 |
| Fase 4 | ✅ | Azure DevOps (plantilla de pasos y política de rama), GitLab CI, script genérico `curl` + `jq` y plan reducido en el cliente |
| Fase 5 | ✅ en parte | OpenTofu con el mismo formato (**no** se corrió un `tofu plan` real) y Bicep por `az deployment group what-if`. Pulumi, sólo si hay demanda |
| Fase 6 | ✅ | Desglose por recurso, evolución por repositorio, exportación a CSV, aviso al superar el umbral (campanita, Slack, Teams y correo) y el cambio respecto del push anterior en el comentario |
| Sección 5, métricas | ❌ | No se instrumentó nada. Las filas de `IacCostEstimations` permiten calcular a mano la cobertura y los repositorios activos, pero no hay panel, y la estimación contra el costo real no se mide |

**Lo que queda, y por qué:**

- **Bases de datos administradas** (SQL Database, MySQL y PostgreSQL flexible, Cosmos
  DB): los `meterName` no son consistentes entre SKUs y SQL Database no trae
  `location` en el recurso de Terraform. Hay que mapear SKU por SKU contra la API real.
- **Ranking de gasto por tipo.** Los datos de producción no son accesibles desde el
  entorno de desarrollo: hay que pedírselo a la plataforma.
- **Bicep sin verificar con una corrida real.** El fixture `arm-whatif-completo.json`
  se armó a mano con la forma documentada. Correr un `what-if` real antes de anunciarlo.
- **Comentarios en GitHub.** Los endpoints son los estándar y no se contrastaron con
  su documentación; los de Azure DevOps y GitLab sí.
- **Bastion** (instancias adicionales) y **AKS Premium** (LTS) no se suman: no se pudo
  verificar en Learn cómo se cobran. El número queda como piso con una nota.
- **Callers del helper viejo.** `getMonthlyCostEstimate` sigue con la selección que
  tarifa mal la fila Spot de una VM, y lo usan zombies, rightsizing y licencias.
  `azureLicenseOptimization.service.ts:176` además le pasa un `armSkuName` como
  `skuName`.
- **La pantalla** se verificó con tests de componentes, `tsc` y ESLint; no se vio en
  un navegador.
- **Despliegue.** Las migraciones `20261008-033` y `20261008-034` van antes que el
  código y hay que verificarlas en producción (job `migrate` y Log Analytics).
