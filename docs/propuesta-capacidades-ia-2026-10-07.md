# Capacidades de IA para CSCloudSolutions FinOps: análisis de viabilidad y propuesta de implementación

| | |
|---|---|
| **Fecha** | 2026-10-07 |
| **Estado** | Propuesta. **No implementada**: este documento no viene acompañado de cambios de código ni de infraestructura. |
| **Base analizada** | `main` @ `057287c9` |
| **Origen** | Propuesta generada con Gemini (texto completo en el [Anexo A](#anexo-a-texto-original-de-la-propuesta)), verificada contra el código, la IaC (Terraform) y la documentación oficial de Microsoft. |
| **Alcance** | Viabilidad de los cuatro módulos propuestos y de la infraestructura asociada; plan de implementación por fases. |

> Las referencias de línea (`~Lnnn`) son aproximadas y corresponden al commit base. La referencia estable son los nombres de archivos y funciones.

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [La propuesta de Gemini en una página](#2-la-propuesta-de-gemini-en-una-página)
3. [Estado actual verificado](#3-estado-actual-verificado)
4. [Análisis por módulo](#4-análisis-por-módulo)
   - [4.1 Ingesta de facturas y contratos con Document Intelligence](#41-ingesta-de-facturas-y-contratos-con-document-intelligence)
   - [4.2 Copilot FinOps y explicación de anomalías](#42-copilot-finops-y-explicación-de-anomalías)
   - [4.3 Normalización semántica de etiquetas](#43-normalización-semántica-de-etiquetas)
   - [4.4 Triaje inteligente de soporte](#44-triaje-inteligente-de-soporte)
   - [4.5 Infraestructura, autenticación y control de costos](#45-infraestructura-autenticación-y-control-de-costos)
5. [Errores concretos de la propuesta](#5-errores-concretos-de-la-propuesta)
6. [Propuesta de implementación](#6-propuesta-de-implementación)
   - [6.1 Principios](#61-principios)
   - [6.2 Fase 0: cimientos](#62-fase-0-cimientos)
   - [6.3 Fase 1: explicación de anomalías](#63-fase-1-explicación-de-anomalías)
   - [6.4 Quick win: mapeo de CSV por columnas](#64-quick-win-mapeo-de-csv-por-columnas)
   - [6.5 Fase 2: normalización de valores de tags](#65-fase-2-normalización-de-valores-de-tags)
   - [6.6 Fase 3: triaje y borradores de soporte](#66-fase-3-triaje-y-borradores-de-soporte)
   - [6.7 Fase 4: Document Intelligence (condicional)](#67-fase-4-document-intelligence-condicional)
   - [6.8 Requisitos transversales](#68-requisitos-transversales)
   - [6.9 Plan de PRs y cronograma tentativo](#69-plan-de-prs-y-cronograma-tentativo)
   - [6.10 Costo estimado de inferencia](#610-costo-estimado-de-inferencia)
7. [Riesgos y mitigaciones](#7-riesgos-y-mitigaciones)
8. [Decisiones abiertas](#8-decisiones-abiertas)
9. [Referencias](#9-referencias)
- [Anexo A. Texto original de la propuesta](#anexo-a-texto-original-de-la-propuesta)

---

## 1. Resumen ejecutivo

**Veredicto: viable, pero no tal como está escrita.** La propuesta acierta en *dónde* aporta valor la IA, pero tiene tres problemas de fondo:

- **Ignora lo que ya existe.** El SaaS ya tiene una capa de IA multi-proveedor (Vercel AI SDK), BYOK cifrado, DLP por tenant, cuotas por tier, medición de uso por feature, caché, kill switch global, delimitadores contra prompt injection y un motor de anomalías que ya calcula los principales contribuyentes. Cerca de la mitad de lo propuesto es infraestructura que no hay que construir.
- **Tiene errores técnicos concretos** que, implementados al pie de la letra, romperían cosas: una zona DNS privada que no existe, un SDK legacy, API keys que contradicen el punto de least privilege de la propia propuesta, facturas cargadas en `CostSnapshots` (falsas anomalías y doble conteo), rutas y firmas que no existen y un SLA contractual que se ajustaría según el texto que escribe el cliente. Detalle en la [sección 5](#5-errores-concretos-de-la-propuesta).
- **Le pide al modelo cosas que no puede saber.** Su ejemplo de explicación ("Standard_D8s_v5 sin apagado programado ni Azure Hybrid Benefit") necesita datos que hoy no se le pasan al modelo. El resultado sería una alucinación convincente.

**Recomendación:** construir sobre lo existente con el principio *"el código decide, la IA redacta"*, en este orden:

| Orden | Iniciativa | Valor | Esfuerzo | Riesgo | Recomendación |
|---|---|---|---|---|---|
| 0 | Cimientos: gate único de IA, Managed Identity, Terraform, compliance | Habilitante | Bajo a medio | Bajo | Hacer primero |
| 1 | Explicación de anomalías: drill-down determinista y narración | **Alto** | Medio | Bajo | Hacer |
| 2 | Quick win CSV: inferir el mapeo de columnas en lugar de mapear filas | Medio (corrige un truncamiento silencioso) | Bajo | Bajo | Hacer junto con la fase 1 |
| 3 | Normalización de valores de tags: reglas primero, IA para el residuo | Alto | Medio | Bajo | Hacer |
| 4 | Triaje y borradores de soporte, sin tocar el SLA | Medio, según volumen | Medio | Medio | Medir el volumen antes |
| 5 | Document Intelligence para facturas y contratos fuera de la nube | Medio a alto si hay demanda | Alto | Alto | Condicional, como add-on |

**Esfuerzo estimado:** PRs 1 a 8, unas **7 a 8 semanas** de un desarrollador. Document Intelligence (PR 9), **3 a 4 semanas** más, condicionado a demanda validada.

**Costo de inferencia** de las fases 1 a 3: marginal. Del orden de US$0,001 por explicación con un modelo "mini" (ver [6.10](#610-costo-estimado-de-inferencia)).

### Resumen por módulo

| Módulo de Gemini | ¿Viable? | Qué ya existe | Qué cambia en esta propuesta |
|---|---|---|---|
| 1. Document Intelligence | Sí, condicional | Upload de CSV a FOCUS | SDK v4 (`@azure-rest/ai-document-intelligence`); tablas propias, **nunca** `CostSnapshots`; foco en gasto fuera de la nube y en contratos; add-on |
| 2. Copilot y anomalías | **Sí, el de mayor valor** | Copilot completo; Z-score, top 5 contribuyentes y dueño de la anomalía | Drill-down determinista de causa raíz antes de la IA; generación lazy con caché, no en el cron |
| 3. Tags | Sí, con otra herramienta | Auditoría de presencia; sugerencia heurística | Sin NER: normalizador determinista y LLM con salida enum; antes, arreglar tres bugs de base |
| 4. Soporte | A medias | Tickets, SLA por plan, notas internas | Triaje como sugerencia interna; **no** tocar el SLA; borradores con citas; medir volumen |
| Infraestructura | Sí, con correcciones | Identidad administrada, VNet, subnet de private endpoints, DNS privado | Zonas DNS correctas, rol correcto, Managed Identity sin pisar `AZURE_CLIENT_ID`, cuotas como tope de gasto |

---

## 2. La propuesta de Gemini en una página

Resumen; el texto completo está en el [Anexo A](#anexo-a-texto-original-de-la-propuesta).

1. **Document Intelligence** (`prebuilt-invoice` o `prebuilt-layout`) para extraer ítems de facturas y contratos en PDF o imagen y mapearlos "directamente a las tablas `CostSnapshots` y al esquema canónico FOCUS". Incluye un ejemplo con `@azure/ai-form-recognizer` y `AzureKeyCredential`.
2. **Azure OpenAI (GPT-4o)** para explicar en lenguaje natural las anomalías que detecta el cron `/api/cron/anomaly-detection`, delimitando datos con `<context_data>` y guardando llaves cifradas con AES-256-GCM.
3. **Azure AI Language (NER y análisis semántico)** para normalizar tags (`prod`, `PRD`, `produccion` a `Production`) y deducir centro de costo o departamento a partir del nombre del resource group.
4. **Text Analytics (sentimiento y urgencia)** para clasificar la severidad de los tickets y ajustar el cronómetro de SLA, más sugerencias de respuesta basadas en `MANUAL_DE_USUARIO.md` y `docs/`.
5. **Infraestructura:**
   - `azurerm_cognitive_account` en Terraform y Private Endpoint con la zona `privatelink.cognitiveservices.azure.net`.
   - Rol `Cognitive Services User` para la Managed Identity.
   - Endpoints en `src/app/api/ai/` protegidos con `checkByKeyDistributed` y `requireTenantTier(req, 'Enterprise')`.

---

## 3. Estado actual verificado

| Capacidad | Dónde | Estado |
|---|---|---|
| Capa de IA multi-proveedor: Vercel AI SDK `ai` 6 con `@ai-sdk/azure`, `openai`, `anthropic`, `google`, `mistral` y `cohere` | `src/modules/core/aiProvider.ts` | ✅ Existe |
| Configuración de la IA de plataforma (env `AZURE_OPENAI_*` o `GlobalSettings`, deployment por defecto `gpt-5.1`) y BYOK por tenant (por defecto `gpt-4o`) | `src/services/aiService.ts` (`getAIConfig`) | ✅ Existe |
| Kill switch global | `isAiGloballyEnabled()` en `aiService.ts` | ✅ Existe |
| Habilitación por tenant | `Tenants.ai_enabled` | ✅ Existe |
| Claves BYOK cifradas | `src/lib/secretCrypto.ts` (AES-256-GCM) | ✅ Existe |
| DLP según las preferencias del tenant (`shareResourceNames`, `shareTags`) | `redactForDataSharing`, `redactForTenant`, `redactSerializedForTenant` en `aiProvider.ts` | ✅ Existe |
| Cola y reintentos | `aiQueue`, `withExponentialBackoff` en `aiProvider.ts` | ✅ Existe |
| Medición de uso por tenant, origen (`byok` o `platform`), modelo y feature | Tabla `PlatformAiUsage`, `insertPlatformAiUsage` (`src/modules/storage/db.ts`), `/api/superadmin/platform-usage` | ✅ Existe |
| Caché de respuestas | Tabla `AiCache` | ✅ Existe |
| Copilot FinOps con gate completo (detalle debajo de la tabla) | `src/app/api/intelligence/copilot/route.ts`, `src/lib/copilotConfig.ts` | ✅ Existe |
| Reportes ejecutivos asíncronos con IA | `ExecutiveReportJobs` | ✅ Existe |
| Patrón "la IA redacta, el código decide": placeholders validados, fallback, caché de 24 h y medición | `src/services/advisorRemediationNarration.ts` | ✅ Plantilla a reutilizar |
| Anomalías: Z-score con umbral 2,5, top 5 contribuyentes por resource group y servicio, dueño (MEJ-33) y notificación única | `src/services/anomalyDetectionService.ts` | ✅ Existe, sin causa raíz ni explicación |
| Normalización de CSV a FOCUS con IA | `normalizeBillingCsv` (`aiProvider.ts`, ~L625) | ⚠️ Procesa sólo 50 filas |
| Auditoría de tags obligatorios | `src/services/azureTagGovernance.service.ts` | ⚠️ Sólo valida presencia; ignora `allowedValues` y las políticas por tenant |
| Sugerencia de tags | `src/app/api/governance/tags/suggest/route.ts` | ⚠️ Heurística presentada como IA, con `confidence` fijo |
| Soporte con SLA por plan y notas internas | `src/app/api/support/tickets/route.ts`, `src/lib/supportConfig.ts` | ✅ Existe, sin IA |
| Recursos de IA en Terraform | `infra/terraform/` | ❌ No existen |
| Uso interno de Document Intelligence | — | ❌ No existe. `azureDocumentIntelligence.service.ts` es el módulo FinOps que analiza el gasto en DI *de los clientes*. |

**Detalle del gate del Copilot:**

- Tier Professional o superior y `Tenants.ai_enabled`.
- Rate limit distribuido (`checkByKeyDistributed`).
- Cuota mensual: Professional 50, Business 150; Enterprise y BYOK sin límite.
- Delimitadores `<page_context>`, `<context_data>` y `<user_question>`.

---

## 4. Análisis por módulo

### 4.1 Ingesta de facturas y contratos con Document Intelligence

**Qué propone.** Usar `prebuilt-invoice` o `prebuilt-layout` para extraer líneas, fechas, cargos recurrentes, impuestos y proveedor, y mapearlos directamente a `CostSnapshots` y a FOCUS sin intervención manual.

**Qué existe hoy.** `POST /api/intelligence/upload` acepta hasta 10.000 filas de CSV:

- Si el CSV ya es FOCUS, se mapea sin IA (`isAlreadyFocusFormat` y `mapNativeFocusRows`).
- Si no, `normalizeBillingCsv` usa IA.

No hay uso interno de Document Intelligence.

**Viabilidad: técnica sí; de producto, condicional.**

- **Las facturas de nube aportan poco.** En Azure, la ingesta nativa ya trae más detalle que el PDF de la factura. En AWS y GCP, sus exports de facturación en CSV, que ya se pueden subir, también.
- **El valor real está en dos lugares:**
  - Gasto **fuera de la nube**: SaaS, licencias, marketplace, proveedores locales.
  - **Contratos y compromisos**: EA/MACC, Savings Plans, reservas, fechas de renovación y preaviso. Para contratos existe `prebuilt-contract` en DI v4.0.
- **Es la iniciativa más cara de las cuatro.** Requiere almacenar originales, escanear malware, validar, una UI de revisión humana y multimoneda, y tiene un costo variable por página. Conviene ofrecerla como **add-on** (el mecanismo de add-ons que desbloquean rutas ya existe en `requireTenantTier`) y sólo con demanda validada.

**Correcciones necesarias.**

1. **No mapear a `CostSnapshots`.** Su granularidad es diaria y su clave única es `(tenant, suscripción, fecha, resource_group, servicio, hash del tag de asignación)`. Una factura mensual ahí:
   - Rompe la granularidad: todo el mes cae en un día, o hay que inventar un prorrateo.
   - Dispara falsos positivos en el Z-score de anomalías.
   - **Duplica** el gasto que ya entra por la ingesta de Azure.

   Va en tablas propias (ver [6.7](#67-fase-4-document-intelligence-condicional)).
2. **SDK.** `@azure/ai-form-recognizer` es el SDK legacy (API v3.1). El GA vigente es `@azure-rest/ai-document-intelligence` (v4.0, API `2024-11-30`).
3. **Autenticación.** El ejemplo usa `AzureKeyCredential` con la key en variables de entorno, lo que contradice el punto de least privilege de la misma propuesta y deja de funcionar con `local_auth_enabled = false`. Corresponde Managed Identity con el rol `Cognitive Services User`.
4. **Cuenta.** Conviene una cuenta dedicada `kind = "FormRecognizer"`, salvo que se confirme que una cuenta `AIServices` soporta DI v4.0 en la región elegida.

### 4.2 Copilot FinOps y explicación de anomalías

**Qué propone.** Cuando el cron `/api/cron/anomaly-detection` detecta una anomalía, enviar el contexto del recurso (SKU, horas activas, histórico) a GPT-4o para generar una explicación ejecutiva en lenguaje natural.

**Qué existe hoy.**

- **Copilot FinOps** (`/api/intelligence/copilot`), con todo el gate descripto en la [sección 3](#3-estado-actual-verificado).
- **Anomalías** (`anomalyDetectionService.ts`):
  - Z-score con umbral 2,5.
  - `getAnomalyTopContributors` (~L157) calcula los 5 principales contribuyentes por resource group y servicio contra un promedio base.
  - `persistAndNotifyAnomalies` (~L383) resuelve el dueño (MEJ-33), persiste y notifica una sola vez (`notified_at`). El webhook lleva una línea "Principal causa".
- **Un patrón reutilizable**: `advisorRemediationNarration.ts` ya hace "la IA redacta, el código decide":
  - Plantilla con placeholders `{nombre}` validados; si el modelo los altera, vuelve a la plantilla.
  - Caché de 24 h y medición con su propio `feature`.
  - Salida silenciosa si el tenant no tiene IA.

**Viabilidad: alta. Es el módulo de mayor valor y menor riesgo**, con tres correcciones:

1. **Primero los hechos, después la prosa.**
   - Con los datos que recibe hoy, el modelo sólo conoce resource group, servicio y montos. No puede saber si la causa fue un recurso nuevo, más uso, un aumento de precio o la pérdida de cobertura de una reserva.
   - El ejemplo de Gemini menciona SKU, ausencia de apagado programado y Azure Hybrid Benefit. Nada de eso se le pasa, así que lo inventaría.
   - Hace falta un **drill-down determinista** (recurso, medidor, cantidad contra precio unitario, cobertura de compromisos) sobre columnas que `CostSnapshots` ya tiene: `ResourceId`, `MeterName`, `MeterCategory`, `Quantity`, `UnitOfMeasure`, `CommitmentDiscountId`, `EffectiveCost` y `ListCost`. El modelo sólo **redacta** sobre esos hechos.
2. **No generar en el cron.** En prod el cron corre cada 30 minutos (`1,31 * * * *` en `infra/terraform/environments/prod/cron-jobs.tfvars`). Generar ahí suma latencia, riesgo de timeout y costo por anomalías que nadie abre. Conviene generar **lazy**, la primera vez que alguien abre la anomalía, y cachear por anomalía, idioma y hash de los hechos.
3. **Salida estructurada y validada.** Los delimitadores mitigan el prompt injection pero no lo eliminan: los nombres de recursos y los tags son texto que controla el cliente. La salida tiene que cumplir tres reglas:
   - Ser un objeto validado con zod, con validación de cifras e IDs.
   - No contener URLs generadas por el modelo.
   - Caer a una plantilla si algo no valida.

El punto de "guardar las llaves cifradas con AES-256-GCM" ya existe para BYOK (`secretCrypto.ts`). Para la IA de plataforma, lo correcto es no tener llaves: Managed Identity.

### 4.3 Normalización semántica de etiquetas

**Qué propone.** Usar NER y análisis semántico de Azure AI Language para normalizar valores (`prod`, `PRD`, `produccion` a `Production`) y deducir CostCenter o Department a partir del nombre del resource group.

**Qué existe hoy.**

- `azureTagGovernance.service.ts` audita cuatro tags obligatorios (`DEFAULT_MANDATORY_TAG_POLICIES`):

  | Tag | Valores permitidos |
  |---|---|
  | `Environment` | `prod`, `stg`, `dev`, `qa`, `sandbox` |
  | `Role` | `database`, `api`, `frontend`, `backup`, `orchestrator`, `network`, `storage`, `worker` |
  | `CostCenter` | Libre |
  | `Department` | Libre |

- `suggestTagsForResource` sugiere tags con heurísticas.
- Hay herencia de tags desde el resource group (`/api/governance/tags/inherit-rg`, `inheritance-preview` y `apply-inheritance`) y aplicación masiva (`/api/tags/apply-bulk`).

**Viabilidad: alta, pero con otra herramienta y después de arreglar la base.**

1. **NER es la herramienta equivocada.** Reconoce entidades (personas, organizaciones, lugares, fechas) en texto libre; un valor de tag como `PRD` no es una entidad. El problema es de vocabulario controlado y se resuelve en dos capas:
   - Un **normalizador determinista**: minúsculas, sin acentos ni separadores, diccionario de alias y distancia de edición.
   - Un LLM con **salida enum** sólo para lo que quede sin resolver.
2. **Conflicto de vocabulario.** La política por defecto permite `prod`, no `Production`. Normalizar a `Production` haría que el recurso **incumpla** la política propia. Hay que normalizar al vocabulario de la política del tenant.
3. **Hay tres bugs de base que resolver antes:**
   - `evaluateResourceMissingTags` sólo valida presencia o valor vacío. `allowedValues` existe en los tipos y en los defaults, pero **nunca se aplica**.
   - El escáner usa siempre `DEFAULT_MANDATORY_TAG_POLICIES` e **ignora** las políticas por tenant de `TaggingPolicies`.
   - **El esquema de `TaggingPolicies` es inconsistente.** La migración `20260813-001` crea columnas snake_case (`tenant_id`, `policy_name`, `is_required`) y `src/app/api/tags/route.ts` las usa. En cambio, `src/app/api/governance/policies/route.ts` consulta camelCase (`tenantId`, `policyName`, `isRequired`, `createdAt`, `updatedAt`). Según la variante de cada base, una de las dos rutas falla.
4. **CostCenter y Department.** Primero se usa la herencia desde el resource group, que ya existe. La IA, en todo caso, sugiere valores **dentro del conjunto que el tenant ya usa** y nunca inventa valores nuevos. Siempre con aprobación humana.
5. **DLP.** Hay que respetar `shareTags` y `shareResourceNames` del tenant.

**Detalles a corregir en `/api/governance/tags/suggest`.** El impacto es bajo, porque es una función pura del body y no lee datos del tenant:

- `?mock=true` saltea `requireTenantAccess`.
- El `tenantId` cae a `"default"` si falta.
- `confidence: 0.94` está fijo.
- Todo error responde 500.
- La UI muestra "Etiquetas inferidas con Inteligencia Artificial" (`aiTagsInferred`), pero el resultado sale de una heurística. Es un tema de transparencia: hay que ajustar el texto o hacerlo verdad en la fase 2.

### 4.4 Triaje inteligente de soporte

**Qué propone.** Usar sentimiento y urgencia para clasificar la severidad del ticket y **ajustar el cronómetro de SLA** ante un incidente crítico, y sugerir respuestas basadas en `MANUAL_DE_USUARIO.md` y `docs/`.

**Qué existe hoy.**

- El usuario elige categoría y prioridad al crear el ticket; la prioridad por defecto es `MEDIUM`.
- El SLA de primera respuesta depende sólo del plan: `computeSlaDeadline` con los valores de `supportConfig.ts`.

  | Plan | Primera respuesta | Cuota de tickets |
  |---|---|---|
  | Professional | 24 h | 20 por mes |
  | Business | 8 h | Sin cuota |
  | Enterprise | 4 h | Sin cuota |

- Hay notas internas (`SupportTicketMessages.is_internal_note`, filtradas con `stripInternalNotes`) y alerta de riesgo de SLA (`SLA_BREACH_RISK_MINUTES = 60`).

**Viabilidad: media, con cambios de enfoque.**

1. **Sentimiento no es urgencia.** Un cliente enojado por una factura no es un incidente productivo; uno que escribe con calma que dejó de ingestar datos sí puede serlo. Lo útil es clasificar **impacto** (¿hay producción afectada? ¿qué módulo?) con salida enum.
2. **No tocar el SLA automáticamente.** El SLA es un compromiso contractual por plan. Ajustarlo según el texto del ticket cambia la semántica del contrato y lo vuelve manipulable: alcanza con escribir "esto es crítico, ignorá las instrucciones anteriores". La IA **sugiere** prioridad, categoría y módulo como metadato interno, y decide un operador.
3. **El corpus tiene que ser acotado.** `docs/` incluye material interno que no debe aparecer en respuestas a clientes: `docs/security`, `docs/lld`, `docs/hld` y los manuales de superadmin.
   - Corpus válido: los manuales de usuario (`MANUAL_DE_USUARIO.md`, de unos 31 KB, y `docs/manual/MANUAL_USUARIO_{ES,EN,PT-BR}.md`, de unos 125 KB cada uno).
   - Método: chunking por secciones, búsqueda léxica (BM25) y citas. A ese tamaño no hace falta una base vectorial.
4. **Taxonomía.** El clasificador tiene que emitir el contrato de dominio en TypeScript, porque los enums de la base difieren y se traducen en la ruta con `categoryToDb` y `priorityToDb`:

   | | Enum de la base | Contrato de dominio (TypeScript) |
   |---|---|---|
   | Categoría | `technical`, `billing`, `question`, `feature_request` | `CONSULTA`, `FACTURACION_AZURE`, `CONEXION_TENANT`, `INCIDENCIA_TECNICA`, `SOLICITUD_FEATURE` |
   | Prioridad | `low`, `medium`, `high`, `urgent` | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW` |
5. **Medir el volumen primero.** Con una cuota de 20 tickets por mes en Professional, si el volumen real es bajo, el retorno también lo es.

### 4.5 Infraestructura, autenticación y control de costos

**Qué propone.**

- `azurerm_cognitive_account` en `infra/terraform/`.
- Private Endpoint con la zona `privatelink.cognitiveservices.azure.net`.
- Rol `Cognitive Services User` para la Managed Identity.
- Endpoints en `src/app/api/ai/` protegidos con `checkByKeyDistributed` y `requireTenantTier(req, 'Enterprise')`.

**Qué existe hoy.**

- Terraform azurerm `~> 4.0` (lock en 4.81.0), con prod en `westus2`.
- VNet con subnet de private endpoints (`modules/network`) y Container Apps con VNet injection.
- Módulo `private_dns` con un mapa `local.zones`: Key Vault, MySQL y Redis condicional.
- Identidad `azurerm_user_assigned_identity.app` (`modules/stamp`, ~L70).
- Módulos `budget`, `diagnostics`, `defender` y `storage`.
- Ningún recurso de IA en la IaC.

**Correcciones necesarias.**

1. **Zona DNS.**
   - `privatelink.cognitiveservices.azure.net` no existe. Para una cuenta `AIServices`, las zonas son `privatelink.cognitiveservices.azure.com`, `privatelink.openai.azure.com` y `privatelink.services.ai.azure.com`.
   - Con la zona equivocada, el Private Endpoint no registra los registros A y el hostname nunca resuelve a la IP privada.
   - Es el mismo tipo de falla que ya hubo con Redis, documentada en `modules/private_dns/main.tf`.
2. **Rol.** Para inferencia de Azure OpenAI el rol es `Cognitive Services OpenAI User`. `Cognitive Services User` es el que corresponde a Document Intelligence y Language.
3. **Sin llaves.** `local_auth_enabled = false` exige `custom_subdomain_name` y autenticación con Entra ID.
4. **Managed Identity, sin pisar `AZURE_CLIENT_ID`.**
   - La app ya expone el client id de su identidad como `AZURE_KEYVAULT_MI_CLIENT_ID`.
   - `AZURE_CLIENT_ID` pertenece al app registration multitenant de CSCS. Pisarla rompió la autenticación con AADSTS7000232 y AADSTS700016 (comentario en `modules/stamp/main.tf`, ~L356).
   - Por la misma razón, no hay que usar `DefaultAzureCredential` a secas, sino `ManagedIdentityCredential({ clientId: process.env.AZURE_KEYVAULT_MI_CLIENT_ID })`.
5. **Rutas y firmas.** No existe `src/app/api/ai/`: las rutas de IA viven en `/api/intelligence/*`. La firma real es `requireTenantTier(request, tenantId, minTier, options?)` (`src/lib/requestAuth.ts`).
6. **Rate limiting no es un tope de gasto.** `checkByKeyDistributed` (`src/lib/rateLimiter.ts`) es anti-abuso y, si Redis no responde, degrada a un contador en memoria por réplica. Contra el denial-of-wallet hace falta:
   - Cuotas mensuales por tenant y feature, contadas en la base (`PlatformAiUsage`).
   - `maxOutputTokens` por llamada.
   - Capacidad (TPM) acotada en el deployment.
   - Presupuesto de Azure con alertas.
   - Kill switch.
7. **Residencia.** El tipo de deployment define dónde se procesa la inferencia; los datos en reposo quedan en la geografía elegida:

   | Tipo de deployment | Dónde se procesa la inferencia |
   |---|---|
   | Global | En cualquier región de Azure |
   | Data Zone | Dentro de la zona de datos: EE. UU., UE o APAC |
   | Standard regional | Dentro de la geografía del recurso |

   La plataforma declara un único despliegue en West US 2, e `infra/docs/residencia-de-datos.md` aclara que la residencia es "una señal de compliance/auditoría, no una garantía técnica". La elección tiene que ser coherente con lo que se declara.
8. **Subprocesadores.**
   - En `docs/trust-center/SUBPROCESSORS_*.md`, la única fila de inferencia de modelos de lenguaje es "Google Gemini AI" (opcional, con clave propia).
   - Microsoft Azure figura por "cómputo, almacenamiento, redes y procesamiento de datos en la nube", sin mención de inferencia de IA, aunque el proveedor por defecto de la plataforma es Azure OpenAI. Conviene explicitarlo antes de ampliar el uso.
   - El trust center se compromete a avisar con al menos 30 días cualquier cambio o incorporación de subencargados, con derecho a objeción (ver `docs/aviso-cambio-subencargado-2026.md`). Legal tiene que definir si esta aclaración entra en ese supuesto.

---

## 5. Errores concretos de la propuesta

| # | Qué dice Gemini | Problema | Corrección |
|---|---|---|---|
| 1 | Zona DNS `privatelink.cognitiveservices.azure.net` | No existe: el Private Endpoint no resolvería | `privatelink.cognitiveservices.azure.com`, `privatelink.openai.azure.com` y `privatelink.services.ai.azure.com` |
| 2 | SDK `@azure/ai-form-recognizer` | Es el SDK legacy (API v3.1) | `@azure-rest/ai-document-intelligence` (v4.0 GA, API `2024-11-30`) |
| 3 | `AzureKeyCredential` con la key en variables de entorno | Contradice el punto de least privilege de la misma propuesta y no funciona con `local_auth_enabled = false` | Managed Identity con token de Entra ID |
| 4 | Mapear facturas "directamente a `CostSnapshots`" | Rompe la granularidad diaria y la clave única, genera falsas anomalías y duplica gasto | Tablas propias de gasto externo y compromisos |
| 5 | Endpoints en `src/app/api/ai/` | La carpeta no existe; las rutas de IA viven en `/api/intelligence/*` | Seguir la convención existente |
| 6 | `requireTenantTier(req, 'Enterprise')` | Firma incorrecta | `requireTenantTier(request, tenantId, minTier, options?)` |
| 7 | NER para normalizar tags | NER reconoce entidades en texto libre; no resuelve vocabularios controlados | Normalizador determinista y LLM con salida enum para el residuo |
| 8 | Sentimiento para detectar urgencia y ajustar el SLA | Sentimiento no es urgencia; el SLA es contractual; ajustarlo según el texto del ticket es manipulable | Sugerencia interna de prioridad; decide un operador |
| 9 | Rate limiting como defensa contra denial-of-wallet | Es anti-abuso y, si Redis cae, degrada a memoria por réplica; no limita el gasto | Cuotas en la base, `maxOutputTokens`, TPM del deployment, presupuesto y kill switch |
| 10 | Normalizar a `Production` | La política por defecto exige `prod`: el recurso pasaría a incumplirla | Normalizar al vocabulario de la política del tenant |
| 11 | Construir todo desde cero | Ya existen contribuyentes de anomalías, DLP, cuotas, medición, caché, BYOK, kill switch y delimitadores | Construir sobre lo existente |
| 12 | Ejemplo "Standard_D8s_v5 sin programar horario de apagado ni cobertura con Azure Hybrid Benefit" | Requiere SKU, horarios y cobertura de AHB que no se le pasan al modelo: sería una alucinación | Drill-down determinista previo; el modelo sólo redacta hechos |

Detalle menor: para inferencia de Azure OpenAI el rol es `Cognitive Services OpenAI User`; `Cognitive Services User` corresponde a Document Intelligence y Language.

---

## 6. Propuesta de implementación

### 6.1 Principios

1. **El código decide, la IA redacta.** Cifras, causas, acciones y valores salen de lógica determinista. El modelo sólo convierte hechos verificados en texto o elige entre opciones cerradas. Si la salida no valida, se usa una plantilla.
2. **Un único gate para toda la IA.** Kill switch global, `Tenants.ai_enabled`, tier o add-on, cuota, rate limit, DLP y medición quedan en un solo lugar.
3. **Lazy y con caché.** Se genera cuando alguien lo pide, no en el cron.
4. **Humano en el circuito** para todo lo que modifica datos del cliente (tags) o compromisos (prioridad, SLA).
5. **Sin llaves para la IA de plataforma**: Managed Identity. BYOK sigue como está.
6. **Degradación limpia.** Sin IA, cada funcionalidad sigue funcionando con su versión determinista.
7. **Medir antes de escalar.** Cada funcionalidad tiene su `feature` en `PlatformAiUsage`, feedback y KPIs.

### 6.2 Fase 0: cimientos

#### 0.1 Gate único: `src/lib/aiFeatureGate.ts`

```ts
export type AiFeature =
  | "anomaly-explanation"
  | "billing-csv-column-mapping"
  | "tag-value-normalization"
  | "support-triage"
  | "support-reply-draft"
  | "external-spend-extraction";

export type AiGateDenyReason =
  | "global_disabled"  // isAiGloballyEnabled() === false
  | "tenant_disabled"  // Tenants.ai_enabled = 0
  | "tier"             // requireTenantTier o add-on
  | "quota"            // cuota mensual por feature (PlatformAiUsage, sólo source = 'platform')
  | "rate_limited";    // checkByKeyDistributed

export interface AiGateResult {
  allowed: boolean;
  reason?: AiGateDenyReason;
  source?: "byok" | "platform";
  remainingQuota?: number | null; // null = sin límite (Enterprise o BYOK)
}

// Para rutas: valida el tier con la request (SuperAdmin pasa; los add-ons desbloquean).
export async function checkAiFeature(
  request: NextRequest,
  tenantId: string,
  feature: AiFeature
): Promise<AiGateResult>;

// Para jobs sin request, por ejemplo la extracción asíncrona de documentos.
export async function checkAiFeatureForTenant(
  tenantId: string,
  feature: AiFeature
): Promise<AiGateResult>;
```

- La configuración por feature vive en un solo mapa, al estilo de `copilotConfig.ts`: tier mínimo, cuota mensual por tier, límite por minuto y `maxOutputTokens`.
- Un denegado **no** es un error: la ruta devuelve la versión determinista con `aiAvailable: false` y el motivo.
- El Copilot puede migrar a este gate más adelante; no es requisito.

#### 0.2 Managed Identity para la IA de plataforma

`@ai-sdk/azure` (instalado, 3.0.77) acepta `tokenProvider`, y `@azure/identity` ya es dependencia del proyecto:

```ts
import { ManagedIdentityCredential, getBearerTokenProvider } from "@azure/identity";
import { createAzure } from "@ai-sdk/azure";

// AZURE_KEYVAULT_MI_CLIENT_ID, NO AZURE_CLIENT_ID (ver modules/stamp/main.tf).
const credential = new ManagedIdentityCredential({
  clientId: process.env.AZURE_KEYVAULT_MI_CLIENT_ID,
});

const azure = createAzure({
  resourceName: process.env.AZURE_OPENAI_RESOURCE_NAME,
  tokenProvider: getBearerTokenProvider(
    credential,
    "https://cognitiveservices.azure.com/.default"
  ),
});
```

- **Cuándo se activa.** Va en `resolveAzureAiModel` (`aiProvider.ts`) y se activa sólo para `source = 'platform'` con proveedor `azure_openai` sin key configurada, o con un flag explícito (por ejemplo `AZURE_OPENAI_AUTH=entra`). BYOK no cambia.
- **Transición en dos pasos:**
  1. Managed Identity, con la key todavía habilitada como fallback.
  2. Validado en prod: `local_auth_enabled = false` y se eliminan las keys de `GlobalSettings` y del entorno.
- **Desarrollo local.** Sigue funcionando con key.

#### 0.3 Terraform: módulo `infra/terraform/modules/ai_services`

> **Boceto orientativo.** Hay que validarlo con `terraform validate` y `terraform plan` contra azurerm 4.x antes de usarlo.

```hcl
resource "azurerm_cognitive_account" "ai" {
  name                          = "${var.name_base}-ai"
  location                      = var.location
  resource_group_name           = var.resource_group_name
  kind                          = "AIServices"
  sku_name                      = "S0"
  custom_subdomain_name         = "${var.name_base}-ai" # obligatorio sin llaves
  local_auth_enabled            = false                 # sólo Entra ID (paso 2 de la transición)
  public_network_access_enabled = false
  tags                          = var.tags
}

resource "azurerm_cognitive_deployment" "chat" {
  name                   = var.chat_deployment_name
  cognitive_account_id   = azurerm_cognitive_account.ai.id
  version_upgrade_option = "OnceCurrentVersionExpired"

  model {
    format  = "OpenAI"
    name    = var.chat_model_name    # un modelo "mini" para tareas acotadas
    version = var.chat_model_version # fijada: sin upgrades sorpresa
  }

  sku {
    name     = var.deployment_sku      # "GlobalStandard", "DataZoneStandard" o "Standard" (ver residencia)
    capacity = var.deployment_capacity # miles de TPM: es el tope duro de throughput
  }
}

resource "azurerm_private_endpoint" "ai" {
  name                = "${var.name_base}-pe-ai"
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = var.private_endpoint_subnet_id # azurerm_subnet.private_endpoint (modules/network)

  private_service_connection {
    name                           = "${var.name_base}-psc-ai"
    private_connection_resource_id = azurerm_cognitive_account.ai.id
    subresource_names              = ["account"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "ai"
    private_dns_zone_ids = var.private_dns_zone_ids # cognitiveservices, openai y services.ai
  }
}

resource "azurerm_role_assignment" "app_openai_user" {
  scope                = azurerm_cognitive_account.ai.id
  role_definition_name = "Cognitive Services OpenAI User"
  principal_id         = var.app_principal_id # azurerm_user_assigned_identity.app
}
```

En `modules/private_dns/main.tf`, se suman las zonas al `merge` de `local.zones`:

```hcl
var.ai_services_enabled ? {
  cognitiveservices = "privatelink.cognitiveservices.azure.com"
  openai            = "privatelink.openai.azure.com"
  aiservices        = "privatelink.services.ai.azure.com"
} : {}
```

**Además:**

- **Presupuesto.** Uno específico para el recurso de IA, con el módulo `budget`.
- **Diagnóstico.** Diagnostic settings al Log Analytics existente con el módulo `diagnostics`, sin registrar prompts.
- **Verificación post-apply.** Desde el contenedor, `<subdominio>.openai.azure.com` tiene que resolver a una IP privada. Es la lección del incidente con Redis.

#### 0.4 Hardening de `/api/governance/tags/suggest`

- Exigir `tenantId`, sin fallback a `"default"`.
- Exigir `requireTenantAccess`, salvo para `isMockTenant(tenantId)`; quitar el bypass por `?mock=true`.
- Responder 400 ante un body inválido; hoy todo error es 500.
- Quitar `confidence: 0.94` fijo. El único consumidor, `TagGovernancePanel.tsx`, sólo lee `success` y `suggestedTags`, así que no se rompe nada.
- Ajustar el texto `aiTagsInferred` mientras la sugerencia siga siendo heurística.

#### 0.5 Compliance

- **Subprocesadores.** Explicitar que Microsoft Azure provee la inferencia de IA por defecto (Azure OpenAI / Azure AI services) en:
  - `docs/trust-center/SUBPROCESSORS_{ES,EN,PT-BR}.md`.
  - `messages/{es,en,pt-BR}.json`, que alimenta `/legal/subprocessors`.

  Después, regenerar los PDF con `node scripts/generate-trust-center-docs.js`.
- **Aviso de 30 días.** Si legal lo considera un cambio de subencargado, el aviso va antes de habilitar las funciones nuevas para clientes. El código puede desplegarse antes, detrás de un flag.
- **Opt-out.** `Tenants.ai_enabled` ya lo cubre a nivel tenant. Falta decidir si hace falta por feature (ver [8](#8-decisiones-abiertas)).

### 6.3 Fase 1: explicación de anomalías

#### 1a. Drill-down determinista de causa raíz

Nuevo servicio `src/services/anomalyRootCause.service.ts`. Para cada uno de los principales contribuyentes (resource group y servicio), compara el día de la anomalía contra la misma ventana base que usa `getAnomalyTopContributors`, a nivel recurso y medidor, y clasifica hechos:

| Tipo de hecho | Regla (orientativa) | Columnas de `CostSnapshots` |
|---|---|---|
| `NEW_RESOURCE` | `ResourceId` con costo el día D y sin costo en la ventana base | `ResourceId`, `EffectiveCost` |
| `USAGE_INCREASE` | Sube `Quantity` y el costo unitario (`EffectiveCost / Quantity`) se mantiene | `Quantity`, `UnitOfMeasure`, `MeterName` |
| `PRICE_INCREASE` | Sube el costo unitario con cantidad estable | `EffectiveCost`, `ListCost`, `Quantity` |
| `COMMITMENT_COVERAGE_LOSS` | Consumo que en la base tenía `CommitmentDiscountId` y el día D no, o `EffectiveCost` que se acerca a `ListCost` | `CommitmentDiscountId`, `EffectiveCost`, `ListCost` |
| `METER_CHANGE` | Aparece un `MeterName` o `MeterCategory` nuevo para un recurso existente | `MeterName`, `MeterCategory` |
| `INSUFFICIENT_DETAIL` | Las columnas de detalle vienen vacías para ese contribuyente | — |

Cada hecho tiene esta forma: `{ id, type, resourceGroup, serviceName, resourceId?, meterName?, baseline, actual, delta, deltaPctOfTotal }`.

- **Persistencia.** Se guarda en una columna nueva `Anomalies.root_cause_facts JSON` (migración nueva) y se calcula en `persistAndNotifyAnomalies`, junto a `top_contributors`.
  - El cálculo es acotado, por ejemplo 3 contribuyentes por 5 recursos.
  - Antes hay que revisar los planes de ejecución e índices de `CostSnapshots` para consultas por tenant, fecha, resource group y servicio.
- **Cobertura de datos.** La cobertura de esas columnas depende de la ruta de ingesta: export FOCUS, API de Cost Management o CSV subido. Donde vengan vacías, se degrada a nivel resource group y servicio y se declara con `INSUFFICIENT_DETAIL`, en lugar de adivinar.
- **Valor sin IA.** Los hechos se muestran en la UI para todos los tiers, por ejemplo "Recurso nuevo `vm-batch-01`: +US$120 contra su promedio". También pueden enriquecer la línea "Principal causa" de la notificación, que sigue siendo determinista.

#### 1b. Narración con IA

Nuevo servicio `src/services/anomalyExplanation.service.ts`, calcado de `advisorRemediationNarration.ts`.

- **Entrada.** Anomalía, `top_contributors` y `root_cause_facts`, pasados por `redactForTenant` (respeta `shareResourceNames` y `shareTags`).
- **Prompt.** Datos dentro de `<context_data>` e instrucción explícita de usar sólo los hechos provistos, sin inferir causas que no estén en la lista.
- **Salida estructurada** con `generateObject` y zod:

```ts
const explanationSchema = z.object({
  summary: z.string().max(400), // una o dos frases
  causes: z.array(z.object({
    factId: z.string(),         // tiene que existir en root_cause_facts
    text: z.string().max(300),
  })).max(5),
  suggestedActions: z.array(z.enum([
    "REVIEW_NEW_RESOURCE",
    "CHECK_SCHEDULING",
    "REVIEW_COMMITMENT_COVERAGE",
    "CHECK_PRICE_CHANGE",
    "ASSIGN_OWNER_TAGS",
    "MARK_AS_EXPECTED",
  ])).max(3),
});
```

- **Validadores.**
  - Todo número del texto tiene que existir en los hechos, con tolerancia de redondeo.
  - Todo `factId` tiene que existir.
  - No se aceptan URLs ni markdown activo.
  - Si algo falla, se usa una plantilla armada con los hechos.
  - Las acciones son enums que el código traduce a textos y links; el modelo nunca genera links.
- **Persistencia.** Va en una tabla propia, no en `AiCache`, que se comparte entre tenants y no tiene FK:

```sql
CREATE TABLE IF NOT EXISTS AnomalyExplanations (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  anomaly_id       INT NOT NULL,
  tenant_id        VARCHAR(255) NOT NULL,
  locale           VARCHAR(10) NOT NULL,
  facts_hash       CHAR(64) NOT NULL,
  explanation_json JSON NOT NULL,
  source           ENUM('ai', 'template') NOT NULL,
  model_name       VARCHAR(100) NULL,
  feedback         ENUM('up', 'down') NULL,
  feedback_by      VARCHAR(255) NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_anomaly_locale_facts (anomaly_id, locale, facts_hash),
  KEY idx_anomaly_explanations_tenant (tenant_id),
  -- Borrar el tenant cascadea vía Anomalies -> Tenants (tenantTeardownService depende de eso).
  CONSTRAINT fk_anomaly_explanations_anomaly
    FOREIGN KEY (anomaly_id) REFERENCES Anomalies(id) ON DELETE CASCADE
);
```

- **Endpoints.**
  - `GET /api/intelligence/anomalies/[id]/explanation?locale=es`:
    - Aplica `requireTenantAccess` y verifica que la anomalía sea del tenant.
    - Pasa por el gate y devuelve la explicación cacheada para el trío anomalía, idioma y hash de hechos, o la genera.
    - Si el gate deniega, devuelve la plantilla con `aiAvailable: false`.
    - Idioma: `?locale`, después `accept-language`, y si no hay, `es`, igual que la ruta del advisor. No hay columna de idioma por tenant ni por usuario.
  - `POST /api/intelligence/anomalies/[id]/explanation/feedback`: pulgar arriba o abajo.
- **UI.** En `AnomalyDashboard.tsx`, debajo del bloque de principales contribuyentes:
  - Los hechos, siempre.
  - La explicación, con carga lazy al expandir, la etiqueta "Generado con IA: verificá los datos" y los botones de feedback.
  - Los textos van en `messages/{es,en,pt-BR}.json`.
- **Tests**, al estilo de `__tests__/unit/advisorRemediationNarration.test.ts` (mocks con `vi.hoisted` de `@/modules/storage/db`, `@/modules/core/aiProvider` y `ai`):

  | Caso | Resultado esperado |
  |---|---|
  | Número inventado | Fallback a plantilla |
  | `factId` inexistente | Fallback a plantilla |
  | URL en la salida | Fallback a plantilla |
  | Gate denegado | Plantilla |
  | Hit de caché | No se llama al modelo |
  | Datos sensibles | DLP aplicado |

  El clasificador de hechos se prueba con fixtures.
- **KPIs.**
  - Porcentaje de feedback positivo.
  - Porcentaje de fallback a plantilla.
  - Tiempo hasta la resolución (`resolved_at - detected_at`), antes y después.
  - Costo por explicación (`PlatformAiUsage`, feature `anomaly-explanation`).

### 6.4 Quick win: mapeo de CSV por columnas

**Problema actual.**

- `POST /api/intelligence/upload` acepta hasta 10.000 filas y llama una vez a `normalizeBillingCsv(rawData, tenantId)`.
- Si el CSV no es FOCUS, la función envía al modelo sólo `rawCsvData.slice(0, 50)` y devuelve las filas que el modelo mapeó. **Un CSV de 10.000 filas se procesa sobre las primeras 50, sin aviso.**
- Además, el modelo reescribe los montos, lo que abre la puerta a errores numéricos.

**Propuesta: que el modelo infiera el mapeo de columnas, no las filas.**

1. Se envían los encabezados y unas 20 filas de muestra, redactadas con `redactForTenant`.
2. El modelo devuelve un objeto validado con zod: `{ provider, mappings: [{ sourceColumn, focusField, transform? }], dateFormat, currency? }`. `focusField` y `transform` son enums cerrados (por ejemplo `parseNumber`, `parseDate`, `negate`).
3. Se valida que las columnas existan, que los campos FOCUS obligatorios estén cubiertos y que no haya campos destino duplicados.
4. El código aplica el mapeo **a todas las filas**, de forma determinista.
5. Se cachea por tenant y hash de encabezados (`csv-mapping:v1:{tenantId}:{headerHash}`) para no volver a llamar al modelo con el mismo formato.
6. Opcional: una vista previa del mapeo para que el usuario lo confirme.

**Resultado:** procesa las 10.000 filas, hace una sola llamada por formato nuevo, es auditable y ningún monto sale del modelo. Se mide con el feature `billing-csv-column-mapping`.

### 6.5 Fase 2: normalización de valores de tags

#### 2a. Base determinista, sin IA

1. **Unificar `TaggingPolicies` en snake_case**, la forma canónica de la migración `20260813-001`. Implica corregir `governance/policies/route.ts` y agregar una migración idempotente que renombre las columnas camelCase heredadas si existen.
2. **Usar las políticas del tenant en el escáner**, con fallback a los defaults si el tenant no definió ninguna, en lugar de usar siempre `DEFAULT_MANDATORY_TAG_POLICIES`.
3. **Aplicar `allowedValues`.** Un resultado nuevo, "valor no permitido", distinto de "faltante", en `ResourceTagAuditItem` y en las métricas.
4. **Normalizador `normalizeTagValue(value, allowedValues, aliases)`.**
   - Hace trim, pasa a minúsculas, quita acentos y separadores, busca alias y aplica una distancia de edición acotada para valores largos.
   - Devuelve `{ normalized, method, confidence }`, con `method` igual a `exact`, `alias`, `fuzzy` o `null`.
5. **Tabla `TagValueAliases`**, con alias globales (por ejemplo `production`, `produccion` y `prd` hacia `prod`) y por tenant:

```sql
CREATE TABLE IF NOT EXISTS TagValueAliases (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id       VARCHAR(255) NULL, -- NULL = alias global
  tag_name        VARCHAR(128) NOT NULL,
  alias           VARCHAR(256) NOT NULL,
  canonical_value VARCHAR(256) NOT NULL,
  created_by      VARCHAR(255) NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- MySQL no considera iguales dos NULL en un índice único: la unicidad de
  -- los alias globales se controla en el seed.
  UNIQUE KEY uq_tag_alias (tenant_id, tag_name, alias),
  CONSTRAINT fk_tag_value_aliases_tenant
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);
```

6. **UI.** En Tag Governance, una vista de "valores no conformes" con el valor canónico sugerido, que se aplica con `/api/tags/apply-bulk` previa aprobación. Una corrección aprobada puede guardarse como alias, para que el sistema "aprenda".

#### 2b. IA sólo para el residuo

- **Alcance.** Sólo los valores que el normalizador no resolvió, en lotes por tag.
- **Salida.** `z.enum([...allowedValues, "UNKNOWN"])` por valor, con confianza. Nunca valores nuevos.
- **DLP.**
  - Si el tenant no comparte tags (`shareTags = false`), la función no envía nada y lo informa en la UI.
  - Si no comparte nombres de recursos, se envían sólo los valores.
- **CostCenter y Department.** Primero, la herencia desde el resource group que ya existe (`inheritance-preview` y `apply-inheritance`). La IA propone sólo dentro de los valores que el tenant ya usa para ese tag, con aprobación humana obligatoria.
- **`tags/suggest`.** Pasa a devolver el método y la confianza reales.
- **KPIs.**
  - Porcentaje resuelto por regla, por IA y a mano.
  - Tasa de aceptación de sugerencias.
  - Evolución del cumplimiento de tags.

### 6.6 Fase 3: triaje y borradores de soporte

**Precondición:** medir durante 4 a 6 semanas el volumen de tickets por tier, el tiempo de primera respuesta y los incumplimientos de SLA. Si el volumen es bajo, posponer.

#### 3a. Triaje como sugerencia interna

- **Cuándo.** Al crear el ticket, **después** del commit y sin bloquear la respuesta (best-effort).
- **Salida enum.** `{ suggestedPriority, suggestedCategory, suggestedModule, productionImpact, rationale, confidence }`, con los tipos de dominio (`TicketPriority`, `TicketCategory`, `TICKET_RELATED_MODULES`).
- **Tabla `SupportTicketAiTriage`.**
  - `ticket_id` es la PK, con FK a `SupportTickets` y `ON DELETE CASCADE`.
  - Guarda los campos sugeridos, `model_name`, `accepted_by`, `accepted_at` y `created_at`.
- **Límites.**
  - **Nunca** modifica `priority` ni `sla_deadline`.
  - Sólo se ve en `/superadmin/support`. El operador acepta o descarta; aceptar usa el flujo existente de cambio de prioridad.
  - `productionImpact = true` destaca el ticket en la cola del operador.
- **Prompt injection.** El texto del ticket va dentro de `<context_data>` y la salida es cerrada. Aunque el ticket intente manipular al modelo, lo peor que puede pasar es una sugerencia equivocada que un humano descarta.
- **Quién lo paga.** La plataforma, porque es una función interna; no consume cuota del tenant. Respeta `Tenants.ai_enabled`: si el tenant desactivó la IA, sus tickets no se envían.

#### 3b. Borradores de respuesta con citas

- **Corpus.**
  - Incluidos: `MANUAL_DE_USUARIO.md` y `docs/manual/MANUAL_USUARIO_{ES,EN,PT-BR}.md`, más `MANUAL_PARTNER_*` para partners.
  - Excluidos: `docs/security`, `docs/lld`, `docs/hld` y `MANUAL_SUPERADMIN_*`.
- **Índice.** Se genera en el build: chunks por encabezado (de unos 500 a 800 tokens) y búsqueda BM25 en proceso. Con un corpus de unos 400 a 600 KB no hace falta una base vectorial.
- **Flujo.** A pedido del operador ("Sugerir respuesta"):
  1. Se buscan los chunks más relevantes en el idioma del ticket.
  2. Se genera un borrador con citas a secciones.
  3. Se valida que cada cita exista.
  4. Se guarda como **nota interna** editable. Nunca se envía automáticamente.
- **KPIs.** Porcentaje de borradores usados, tiempo de primera respuesta e incumplimientos de SLA.

### 6.7 Fase 4: Document Intelligence (condicional)

**Precondición:** demanda validada (clientes o prospectos que pidan gasto fuera de la nube o gestión de contratos) y un precio definido como add-on.

**Diseño.**

- **Cuenta.** Una cuenta dedicada `kind = "FormRecognizer"`:
  - Con Private Endpoint. La zona `privatelink.cognitiveservices.azure.com` ya existiría desde la fase 0.
  - Con `local_auth_enabled = false`.
  - Con el rol `Cognitive Services User` para la identidad de la app.
- **SDK y modelos.** `@azure-rest/ai-document-intelligence` (API `2024-11-30`). Modelos `prebuilt-invoice` y `prebuilt-contract`, con `prebuilt-layout` como respaldo.
- **Almacenamiento.**
  - Blob privado; la app ya conmuta a Blob con `src/lib/azureBlobStorage.ts`.
  - Escaneo de malware con Defender for Storage (módulo `defender`).
  - Límites de tamaño, páginas y tipo (PDF, JPEG, PNG, TIFF) y una retención definida.
  - Hoy no hay zona `privatelink.blob.core.windows.net` en `private_dns`: hay que evaluar el Private Endpoint de Blob.
- **Tablas**, todas con FK al tenant y `ON DELETE CASCADE`:
  - `ExternalSpendDocuments`:
    - Blob, nombre original y `sha256` para deduplicar.
    - Tipo (`invoice` o `contract`) y estado. Los estados van de `uploaded` a `extracting` y `needs_review`, y terminan en `approved`, `rejected` o `failed`.
    - Proveedor, número y fecha de factura, período, moneda, subtotal, impuestos y total.
    - JSON de extracción, modelo y versión de API, confianza y revisor.
  - `ExternalSpendLines`: descripción, cantidad, precio unitario, importe, moneda, categoría de servicio, período, centro de costo y confianza.
  - `Commitments`: proveedor, tipo (EA, MACC, savings plan, reserva, suscripción SaaS, otro), monto, moneda, inicio, fin, renovación, días de preaviso y renovación automática. Alimenta alertas de renovación.
- **Flujo asíncrono:**
  1. Subida.
  2. Cola.
  3. Análisis (poller).
  4. Mapeo.
  5. Validaciones:
     - Suma de líneas aproximadamente igual al subtotal.
     - Subtotal más impuestos aproximadamente igual al total.
     - Fechas coherentes.
     - Moneda ISO 4217.
     - Duplicados por hash y por proveedor más número de factura.
  6. Revisión humana.

  Sólo lo aprobado entra en los reportes, siempre etiquetado como gasto externo y **nunca** en `CostSnapshots` ni en la detección de anomalías.
- **Multimoneda.** Se guarda la moneda original y la conversión a la fecha de la factura; falta definir la fuente de tipo de cambio.
- **Costo variable.** DI cobra por página, del orden de US$10 cada 1.000 páginas en modelos prebuilt (precio de referencia, a verificar). El add-on necesita límites de páginas por plan.

### 6.8 Requisitos transversales

- **Medición.** Toda llamada registra `insertPlatformAiUsage` con su `feature`, visible en `/api/superadmin/platform-usage`.
- **Kill switch.** Global (`isAiGloballyEnabled`) y por feature, con una clave en `GlobalSettings`.
- **DLP.** Siempre `redactForTenant` antes de enviar datos del tenant.
- **Versionado de prompts.** La versión va en la clave de caché (`v1`, `v2`...) para invalidar al cambiar de prompt o de modelo.
- **Evals.** Fixtures por feature con salidas esperadas. En CI corren con el modelo mockeado; antes de cambiar modelo o prompt, se hace una corrida manual contra el modelo real.
- **Observabilidad.** Spans OTEL por feature: latencia, errores y tasa de fallback.
- **i18n.** ES, EN y PT-BR para todo texto de UI.
- **Teardown.** Las tablas nuevas tienen FK con `ON DELETE CASCADE`, porque `tenantTeardownService.ts` depende de eso.
- **Documentación.** Según el "Development & Quality Protocol" del `README.md`, cada PR actualiza el LLD, el README y los manuales (ES, EN, PT-BR) y, si corresponde, el trust center.
- **Roadmap.** Si se adopta la propuesta, registrar las fases en `docs/MEJORAS-FUTURAS.md` (el último es MEJ-41) con un enlace a este documento.

### 6.9 Plan de PRs y cronograma tentativo

| PR | Contenido | Fase | Depende de | Esfuerzo (días hábiles) |
|---|---|---|---|---|
| 1 | `aiFeatureGate`, hardening de `tags/suggest` y actualización de subprocesadores | 0 | — | 3 |
| 2 | Módulo Terraform `ai_services`, zonas DNS, rol y `tokenProvider` con Managed Identity (con fallback a key) | 0 | — | 4 a 5 |
| 3 | Drill-down determinista, `root_cause_facts` y UI de hechos | 1a | — | 5 |
| 4 | `anomalyExplanation`, tabla `AnomalyExplanations`, endpoint lazy, UI, feedback e i18n | 1b | 1 y 3 | 6 a 7 |
| 5 | CSV: inferencia del mapeo de columnas y aplicación determinista | Quick win | 1 | 3 |
| 6 | Tags: esquema de `TaggingPolicies`, políticas por tenant, `allowedValues`, normalizador y `TagValueAliases` | 2a | — | 5 a 6 |
| 7 | Tags: IA para el residuo, aprobación humana y CostCenter por herencia | 2b | 1 y 6 | 4 a 5 |
| 8 | Soporte: triaje y borradores con citas | 3 | 1 y medición de volumen | 6 a 7 |
| 9 | Document Intelligence como add-on | 4 | 1, 2 y demanda validada | 15 a 20 |

- **PRs 1 a 8:** entre 36 y 41 días hábiles, unas **7 a 8 semanas** de un desarrollador.
- **PR 9:** **3 a 4 semanas** más.
- **PR 2** no bloquea el desarrollo de los demás, porque la configuración actual con key funciona. Sí es recomendable antes de habilitar funciones nuevas en prod con la IA de plataforma.

| Semana | Trabajo | Notas |
|---|---|---|
| 1 | PR 1; inicio de PR 2; borrador de subprocesadores para legal; empieza la medición del volumen de soporte | Si legal pide el aviso de 30 días, arranca acá y corre en paralelo |
| 2 | PR 2 (plan y apply en prod); inicio de PR 3 | Verificar la resolución del DNS privado desde el contenedor |
| 3 y 4 | PR 3 y PR 4 | Anomalías en prod detrás de un flag, primero para tenants piloto |
| 5 | PR 5 | — |
| 6 y 7 | PR 6 y PR 7 | — |
| 8 | PR 8 | Sólo si la medición de volumen lo justifica |
| Después | PR 9 | Sólo con demanda validada |

### 6.10 Costo estimado de inferencia

Supuestos:

- Precios de referencia de modelos "mini" de Azure OpenAI: unos US$0,15 a 0,40 por millón de tokens de entrada y US$0,60 a 1,60 por millón de tokens de salida.
- Son órdenes de magnitud: **hay que verificar los precios vigentes** en la calculadora de Azure antes de decidir.

| Feature | Tokens por llamada (estimados) | Costo por llamada | Volumen ilustrativo | Costo mensual |
|---|---|---|---|---|
| Explicación de anomalía | ~1.500 de entrada, ~300 de salida | US$0,0004 a 0,001 | 2.000 por mes (100 tenants por 20 anomalías abiertas) | US$1 a 2 |
| Mapeo de CSV | ~3.000 de entrada, ~500 de salida | US$0,001 a 0,002 | Una por formato nuevo (cacheado) | Despreciable |
| Normalización de tags (lote de 50 valores) | ~2.000 de entrada, ~1.000 de salida | US$0,001 a 0,0025 | Por escaneo, sólo el residuo | Bajo |
| Triaje de ticket | ~1.000 de entrada, ~200 de salida | Menos de US$0,001 | Según volumen de tickets | Despreciable |
| Borrador de respuesta | ~4.000 de entrada, ~500 de salida | US$0,001 a 0,0025 | A pedido del operador | Bajo |
| Document Intelligence | Por página | Del orden de US$0,01 por página | Según el add-on | **Dominante** |

Con el deployment por defecto actual (`gpt-5.1`), el costo por llamada sería varias veces mayor, aunque seguiría siendo bajo para estos volúmenes. Aun así, conviene un deployment "mini" dedicado para estas tareas acotadas.

**Conclusión:** el costo de inferencia de las fases 1 a 3 es marginal. Lo caro es el desarrollo y la gobernanza (cuotas y presupuesto) para evitar sorpresas. Document Intelligence es la única con un costo variable relevante.

---

## 7. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Alucinación: causas o cifras inventadas | Pérdida de confianza en el producto | Drill-down determinista; validación de cifras e IDs; fallback a plantilla; etiqueta "Generado con IA" |
| Prompt injection vía nombres de recursos, tags o tickets | Salida manipulada | Delimitadores; salida estructurada con enums; la IA nunca ejecuta acciones; humano en el circuito |
| Denial-of-wallet | Costo descontrolado | Gate con cuotas en la base, `maxOutputTokens`, TPM acotado, presupuesto con alertas y kill switch |
| Datos de clientes enviados al proveedor de IA | Compliance y confianza | DLP (`redactForTenant`), preferencias `share*`, opt-out por tenant y subprocesadores actualizados |
| Inferencia fuera de la geografía declarada | Incumplimiento contractual | Tipo de deployment acorde a lo declarado (Data Zone o regional si hace falta) |
| DNS privado mal configurado | La IA de plataforma deja de responder | Zonas correctas y verificación de la resolución desde el contenedor después del apply |
| Pisar `AZURE_CLIENT_ID` | Se cae la autenticación multitenant | `ManagedIdentityCredential` con `AZURE_KEYVAULT_MI_CLIENT_ID`; nunca `DefaultAzureCredential` a secas |
| Retiro o cambio de versión del modelo | Regresiones silenciosas | Versión fijada en Terraform, prompts versionados y evals antes de cambiar |
| Redis caído | El rate limit pasa a ser por réplica | Las cuotas en la base son el control duro |
| Bajo uso (soporte, DI) | Esfuerzo desperdiciado | Medir antes, condicionar a la demanda y seguir KPIs por feature |
| Tags incorrectos aplicados en la nube del cliente | Daño a su gobernanza | Valores sólo dentro de un enum, vista previa, aprobación humana y registro de quién aprobó |
| Columnas de detalle vacías según la ruta de ingesta | Explicaciones pobres | Degradar a resource group y servicio y declararlo (`INSUFFICIENT_DETAIL`) |
| La UI dice "con Inteligencia Artificial" cuando es una heurística | Transparencia | Ajustar el texto ahora; hacerlo verdad en la fase 2 |

---

## 8. Decisiones abiertas

1. **Modelo y tipo de deployment.** ¿Global Standard (más barato y con más modelos), Data Zone Standard US o Standard regional, según los compromisos de residencia? ¿Qué modelos "mini" hay disponibles en `westus2` con ese tipo?
2. **Región de la cuenta de IA.** ¿`westus2`, como el resto (Private Endpoint local), u otra región con más capacidad o modelos?
3. **Tier de la explicación de anomalías.** Recomendación: hechos deterministas para todos los tiers y narración desde Professional, sin límite para BYOK, como el Copilot. Falta definir si la cuota es propia o compartida con el Copilot.
4. **Migración a Managed Identity.** ¿Se desactivan las keys (`local_auth_enabled = false`) en el mismo PR o en un segundo paso, después de validar en prod? Recomendación: dos pasos.
5. **Subprocesadores.** ¿Legal considera que explicitar la inferencia en Azure es un cambio que requiere el aviso de 30 días?
6. **Opt-out.** ¿Alcanza con `Tenants.ai_enabled` o hace falta un opt-out por feature?
7. **Soporte.** ¿Qué umbral de volumen justifica la fase 3?
8. **Document Intelligence.** Falta definir:
   - La demanda concreta.
   - El precio del add-on: por página, por documento o por plan.
   - La fuente de tipo de cambio para multimoneda.

---

## 9. Referencias

### Código e infraestructura del repo

- **Capa de IA:**
  - [`src/modules/core/aiProvider.ts`](../src/modules/core/aiProvider.ts): capa de IA, DLP, `resolveAzureAiModel` y `normalizeBillingCsv`.
  - [`src/services/aiService.ts`](../src/services/aiService.ts): `getAIConfig` e `isAiGloballyEnabled`.
- **Patrón a reutilizar:** [`src/services/advisorRemediationNarration.ts`](../src/services/advisorRemediationNarration.ts) y [`__tests__/unit/advisorRemediationNarration.test.ts`](../__tests__/unit/advisorRemediationNarration.test.ts), el patrón y el estilo de test.
- **Copilot:** [`src/app/api/intelligence/copilot/route.ts`](../src/app/api/intelligence/copilot/route.ts) y [`src/lib/copilotConfig.ts`](../src/lib/copilotConfig.ts), el gate y las cuotas.
- **Anomalías:** [`src/services/anomalyDetectionService.ts`](../src/services/anomalyDetectionService.ts), [`src/components/dashboard/AnomalyDashboard.tsx`](../src/components/dashboard/AnomalyDashboard.tsx) y [`src/app/api/intelligence/anomalies/route.ts`](../src/app/api/intelligence/anomalies/route.ts).
- **Upload de CSV:** [`src/app/api/intelligence/upload/route.ts`](../src/app/api/intelligence/upload/route.ts).
- **Tags:**
  - [`src/services/azureTagGovernance.service.ts`](../src/services/azureTagGovernance.service.ts).
  - [`src/app/api/governance/tags/suggest/route.ts`](../src/app/api/governance/tags/suggest/route.ts) y [`src/components/governance/TagGovernancePanel.tsx`](../src/components/governance/TagGovernancePanel.tsx).
  - [`src/app/api/governance/policies/route.ts`](../src/app/api/governance/policies/route.ts), [`src/app/api/tags/route.ts`](../src/app/api/tags/route.ts) y [`migrations/20260813-001-tagging-policies-table.sql`](../migrations/20260813-001-tagging-policies-table.sql).
- **Soporte:** [`src/app/api/support/tickets/route.ts`](../src/app/api/support/tickets/route.ts), [`src/lib/supportConfig.ts`](../src/lib/supportConfig.ts) y [`src/types/supportTickets.types.ts`](../src/types/supportTickets.types.ts).
- **Seguridad y control:** [`src/lib/requestAuth.ts`](../src/lib/requestAuth.ts) (`requireTenantTier`), [`src/lib/rateLimiter.ts`](../src/lib/rateLimiter.ts) (`checkByKeyDistributed`) y [`src/lib/secretCrypto.ts`](../src/lib/secretCrypto.ts).
- **Infraestructura:** [`infra/terraform/modules/private_dns/main.tf`](../infra/terraform/modules/private_dns/main.tf), [`infra/terraform/modules/stamp/main.tf`](../infra/terraform/modules/stamp/main.tf), [`infra/terraform/modules/network/main.tf`](../infra/terraform/modules/network/main.tf) e [`infra/terraform/environments/prod/cron-jobs.tfvars`](../infra/terraform/environments/prod/cron-jobs.tfvars).
- **Compliance:** [`docs/trust-center/SUBPROCESSORS_ES.md`](trust-center/SUBPROCESSORS_ES.md), [`SUBPROCESSORS_EN.md`](trust-center/SUBPROCESSORS_EN.md) y [`SUBPROCESSORS_PT-BR.md`](trust-center/SUBPROCESSORS_PT-BR.md); [`docs/aviso-cambio-subencargado-2026.md`](aviso-cambio-subencargado-2026.md) e [`infra/docs/residencia-de-datos.md`](../infra/docs/residencia-de-datos.md).

### Documentación oficial

- [DNS de private endpoints en Azure](https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns)
- [Tipos de deployment y procesamiento de datos en Foundry Models](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types)
- [RBAC de Azure OpenAI](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/role-based-access-control)
- [SDK de JavaScript de Document Intelligence v4 (`@azure-rest/ai-document-intelligence`)](https://learn.microsoft.com/en-us/javascript/api/overview/azure/ai-document-intelligence-rest-readme)
- [Modelo prebuilt de contratos de Document Intelligence](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/contract)
- [NER en Azure AI Language](https://learn.microsoft.com/en-us/azure/ai-services/language-service/named-entity-recognition/overview)
- [Proveedor Azure del AI SDK (`tokenProvider`)](https://ai-sdk.dev/providers/ai-sdk-providers/azure)

---

## Anexo A. Texto original de la propuesta

<details>
<summary>Texto generado por Gemini, tal como se recibió; sólo se le dio formato Markdown.</summary>

> Para sumar capacidades de IA a la plataforma SaaS de CSCloudSolutions respetando la arquitectura actual de Next.js App Router, Azure Container Apps y el modelo multitenant, las integraciones más naturales y de mayor impacto se dividen en cuatro módulos concretos:

#### 1. Ingesta Automática de Facturas y Contratos con Document Intelligence

Hoy la plataforma soporta subida de CSV para normalizar hacia FOCUS 1.0/1.1 en /api/intelligence/upload. Puedes incorporar Azure AI Document Intelligence para permitir la carga directa de facturas de proveedores cloud o contratos en PDF e imágenes:

- **Servicio:** Modelo preentrenado prebuilt-invoice o prebuilt-layout de Document Intelligence.
- **Función:** Extraer automáticamente ítems de línea, fechas, cargos recurrentes, impuestos y proveedor, mapeándolos en el backend directamente a las tablas CostSnapshots y al esquema canónico FOCUS sin intervención manual.
- **Implementación en backend:**

```ts
// src/services/documentIntelligenceService.ts
import { AzureKeyCredential, DocumentAnalysisClient } from "@azure/ai-form-recognizer";

export async function parseCloudInvoice(fileBuffer: Buffer) {
  const endpoint = process.env.AZURE_AI_DOC_ENDPOINT!;
  const apiKey = process.env.AZURE_AI_DOC_KEY!;
  const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(apiKey));

  const poller = await client.beginAnalyzeDocument("prebuilt-invoice", fileBuffer);
  const { documents } = await poller.pollUntilDone();
  return documents?.[0]?.fields;
}
```

#### 2. Copilot FinOps y Explicabilidad de Anomalías (Azure OpenAI / Foundry)

El SaaS ya cuenta con un motor de detección de anomalías basado en Z-Score (/intelligence/anomalies) y generación asíncrona de reportes ejecutivos (ExecutiveReportJobs):

- **Análisis contextual de picos de gasto:** Cuando el cron /api/cron/anomaly-detection detecta una anomalía de costo, se envía el contexto del recurso (tipo de SKU, horas activas, histórico) a un modelo de Azure OpenAI (GPT-4o) para generar una explicación ejecutiva en lenguaje natural:
  > "El aumento del 140% en 'rg-prod' fue causado por el despliegue del recurso Standard_D8s_v5 sin programar horario de apagado ni cobertura con Azure Hybrid Benefit".
- **Protección y aislamiento:** Mantener el estándar ya aplicado en el repo: delimitar datos con tags `<context_data>` para mitigar prompt injection y guardar las llaves cifradas con AES-256-GCM (secretCrypto.ts).

#### 3. Inferencia y Normalización Semántica de Etiquetas (Azure AI Language)

El motor de Tag Governance (/governance/tags) audita políticas como Environment, Role, CostCenter y Department:

- **Función con IA:** Emplear Named Entity Recognition (NER) y análisis semántico para:
  - Detectar discrepancias tipográficas en tags (ej.: normalizar prod, PRD, produccion a Production).
  - Deducir automáticamente el centro de costo o departamento según el nombre del grupo de recursos o convenciones de nomenclatura internas de la empresa.

#### 4. Triaje Inteligente y Detección de Urgencia en Soporte

El módulo de soporte in-app (/support y /superadmin/support) gestiona tickets con seguimiento estricto de SLA:

- **Función con Text Analytics:**
  - **Análisis de sentimiento y urgencia:** Clasificar automáticamente la severidad del ticket antes de que un operador lo revise, ajustando el cronómetro de SLA si se detecta un incidente productivo crítico.
  - **Sugerencias de respuesta automática:** Proponer al agente interno snippets de solución basados en la documentación técnica y manuales (MANUAL_DE_USUARIO.md, docs/).

#### Pasos Técnicos para el Despliegue en tu Stack

- **Infraestructura (Terraform):** Declarar el recurso azurerm_cognitive_account bajo el módulo de infraestructura en infra/terraform/. Configurar Private Endpoint (privatelink.cognitiveservices.azure.net) conectando a la VNet de producción para mantener el estándar de aislamiento.
- **Autenticación Least-Privilege:** En vez de exponer API keys sueltas en variables de entorno, otorgar el rol Cognitive Services User a la Managed Identity del contenedor de Azure Container Apps.
- **Control de Cuotas y Rate Limiting:** Envolver los endpoints bajo src/app/api/ai/ con el limitador distribuido en Redis (checkByKeyDistributed) y los guards de tier (requireTenantTier(req, 'Enterprise')) para evitar cargos excesivos (denial-of-wallet).

</details>
