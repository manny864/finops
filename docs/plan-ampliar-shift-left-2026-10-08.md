# Plan: ampliar Shift-Left FinOps (PR Cost Estimator, MEJ-20)

> **Estado: preparado el 2026-10-08.** Documento para retomar después. Este
> plan no se ejecutó, salvo dos brechas que se cerraron el mismo día por
> separado: la **1** (el scope `write:shift-left` ya se otorga desde la pantalla
> de API Keys) y la **9** (el plan es **Enterprise**, decisión de Manuel; la API
> de claves, Shift-Left, el menú y los manuales quedaron alineados con
> `routeTiers.ts`).
>
> **Lo verificado y lo que no.** Todo lo que se dice del repo se leyó el
> 2026-10-08 (archivos citados). Los contratos de Azure —nombres de
> `serviceName`, `skuName`, `meterName` de la Retail Prices API, y el formato de
> `az deployment group what-if`— **no están verificados**: hay que leerlos en
> `learn.microsoft.com` y probarlos con consultas reales antes de escribir cada
> mapeo. Un `serviceName` o un `skuName` equivocado devuelve `Items: []` con
> HTTP 200, o sea un costo 0 silencioso, no un error (ya está documentado en el
> propio servicio).

## 1. Qué hace hoy

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

- ~~Sumar `write:shift-left` a `PublicApiScope` y al panel, y validar los scopes
  del alta contra una lista cerrada.~~ Hecho (`PUBLIC_API_SCOPES`, con un test que
  falla si una ruta exige un scope que no se puede otorgar).
- ~~Resolver la brecha 9 (tier).~~ Hecho: Enterprise.
- Decidir cómo se distribuye la Action (brecha 2): repo público propio
  (`uses: org/finops-pr-cost-estimator@v1`) o instrucciones de copia. La primera
  es la que escala.
- Test: que una clave sin el scope reciba 403 y una con el scope pase.

### Fase 1 — Más recursos, en el orden que marque el gasto real

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

El mayor salto de credibilidad: que el delta se parezca a lo que el cliente paga.
Opciones, de menor a mayor esfuerzo:

| Opción | Cómo | Pros / contras |
|---|---|---|
| **A. Factor de descuento por tenant** | Un porcentaje configurable (la plataforma ya tiene `markup`, `rateService`) aplicado sobre la lista, mostrando los dos números | Simple y explícito. Es un promedio, no el precio real de cada medidor |
| B. Factor derivado de la facturación real | Relación entre costo efectivo y costo de lista del tenant, por servicio | Sin configuración manual. Hay que calcularlo y puede estar contaminado por reservas puntuales |
| C. Precio con reserva | Mostrar también el precio con reserva o savings plan | La Retail API distingue el tipo de precio (verificarlo en Learn); cubre sólo lo que el cliente hubiera comprado |

Recomendación: A primero, con la leyenda "lista" y "con tu descuento" visibles.

### Fase 3 — Contexto de presupuesto

Mapear cada repositorio a un centro de costos o suscripción (hoy `IacBudgetGates`
sólo tiene tenant + repo + USD). Con eso el comentario puede decir cuánto del
presupuesto restante consume el PR, y el gate puede bloquear por porcentaje del
presupuesto, no sólo por monto absoluto.

### Fase 4 — Menos fricción para sumar repositorios

- **Azure DevOps Pipelines** (tarea o plantilla YAML). Para un producto de FinOps
  de Azure es probable que sea tan pedido como GitHub. Verificar cuántos clientes
  lo usan antes de priorizarlo.
- **GitLab CI** y un **script genérico** (`curl` + `jq`) para cualquier otro CI.
- **Reducir el plan en el cliente** (brecha 8): que la Action mande sólo
  `address`, `type`, `actions`, `location` y los campos de SKU. Menor tamaño,
  menos datos sensibles en tránsito, y el límite de 6 MB deja de importar.

### Fase 5 — Otros lenguajes de IaC

- **OpenTofu**: usa el mismo formato de plan; verificar y documentar.
- **Bicep/ARM**: no tienen `terraform plan`. La alternativa es `az deployment
  group what-if`, que devuelve cambios con propiedades antes y después. Hay que
  verificar su formato de salida en Learn y escribir un lector aparte.
- **Pulumi**: sólo si hay demanda.

### Fase 6 — Experiencia en la plataforma

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

1. ¿Distribución de la Action: repo público o copia manual?
2. ~~¿Qué tier es el correcto para crear las claves?~~ Resuelta: Enterprise.
3. ¿Qué tipos de recurso entran primero? Depende del ranking de gasto real.
4. ¿Descuento por tenant manual (A) o derivado (B)?
5. ¿Azure DevOps entra antes que Bicep?
6. ¿Se publica la métrica de exactitud (estimado vs real) a los clientes?

## 8. Cómo retomar

1. Fase 0 completa: es chica y sin ella nadie puede probar el resto.
2. Pedir a la propia plataforma el ranking de gasto por tipo de recurso entre los
   tenants, para fijar el orden de la Fase 1.
3. Antes de cada tipo nuevo: plan real, consulta real a la Retail API y su
   comando anotado.
