# Plan: despliegue en Europa y alineación GDPR para clientes de la UE

> **Estado: preparado el 2026-10-07, NO ejecutado.** Es un documento para retomar
> después. Nada de lo que describe está aplicado en el repo ni en Azure.
>
> **Lo verificado y lo que no.** Las afirmaciones sobre el repo (archivos,
> módulos, conteos) se revisaron contra el código el 2026-10-07. Las
> afirmaciones sobre **contratos de Azure y de terceros** (disponibilidad por
> región, residencia de Front Door, deployments de IA, DPF, etc.) **no se
> verificaron**: están listadas en la [sección 7](#7-contratos-por-verificar-antes-de-implementar)
> y, según `CLAUDE.md`, hay que leerlas en `learn.microsoft.com` antes de
> escribir código o Terraform. Las afirmaciones legales las tiene que validar un
> abogado: este documento no es asesoría legal.

## 1. El requisito

**Decisión de Manuel, 2026-10-07:** todo cliente con base en Europa usa un SaaS
desplegado en Europa, y todo el tratamiento tiene que estar alineado con el
GDPR.

Esto es **más estricto que la ley**. El GDPR no exige que los datos se queden en
la UE: exige una base legal para transferirlos (Cap. V; ver
`infra/docs/residencia-de-datos.md`). Acá el requisito es contractual y
comercial, así que no alcanza con SCCs y el DPF: hay que **sacar de EE. UU. todo
dato de un tenant europeo**, y eso incluye a los subencargados, no sólo a
nuestra infraestructura.

Definición operativa de "dato de un tenant europeo": todo lo que el producto
guarda, procesa o transmite por ese tenant. Incluye logs, backups, telemetría,
correos, tickets de soporte, prompts a modelos de IA, datos de facturación y
credenciales.

## 2. Qué existe hoy (para reutilizar, no reinventar)

| Pieza | Dónde | Estado |
|---|---|---|
| Módulo `stamp`: celda regional completa (red, DNS privado, monitoring, Key Vault, MySQL, Redis, Storage, Container Apps, jobs, migraciones, presupuesto) | `infra/terraform/modules/stamp/` | Funciona; hoy sólo existe `us` en `westus2` |
| Mapa `stamps` indexado por `data_residency` | `environments/prod/main.tf:152`, `terraform.tfvars.example:18` | Bloque `eu` **comentado** (`:114`, `westeurope`, `10.51.0.0/16`) |
| Cada stamp trae **su propia base**: la app recibe `DB_HOST = module.mysql.fqdn` | `modules/stamp/main.tf:342` | Verificado |
| Front Door con geo-routing por país | `modules/frontdoor/`, variable `stamp_geo_routing` | **Ruteo por país del visitante, no por tenant** (ver 4.3) |
| `Tenants.data_residency` (`EU/US/LATAM/APAC/GLOBAL`), auditoría `DataResidencyChanges`, bloqueo | migraciones, `src/app/[locale]/admin/data-residency/` | Funcional, fuera del Sidebar desde 2026-07-05 |
| `regionPool.ts` | `src/modules/storage/regionPool.ts` | Todas las regiones apuntan al mismo pool; **nadie llama a `resolveTenantPool`** |
| DPA (Art. 28), subencargados, aviso de 30 días, `LegalAcceptances`, banner de cookies | `docs/trust-center/`, `docs/aviso-cambio-subencargado-2026.md`, `src/components/CookieConsent.tsx` | Existen; declaran un solo despliegue en EE. UU. |

## 3. Hallazgo que cambia el tamaño del trabajo

`infra/docs/residencia-de-datos.md` dice que el cambio grande es migrar "docenas
de rutas" a `resolveTenantPool(tenantId)`. Hoy **369 archivos** de `src/`
importan el pool directo.

**Con el diseño que ya tiene el módulo `stamp`, ese refactor no hace falta.**
Cada stamp despliega su propia app con su propia base (`DB_HOST` del stamp). La
app de Europa habla con la base de Europa por construcción; el pool único es
correcto *dentro de cada stamp*. `resolveTenantPool` sólo haría falta si una
misma app sirviera a varias bases, y no es el caso.

Lo que sí falta es lo que ese diseño necesita para ser seguro:

1. **Un guard**: la app conoce su región y rechaza (404) cualquier tenant cuyo
   `data_residency` no coincida. Hoy el stamp usa `data_region` sólo para un
   atributo OTEL (`modules/stamp/main.tf:373`): **no existe `DATA_REGION` en
   `src/`**, hay que inyectarlo desde Terraform.
2. **Ruteo por tenant en el borde** (4.3).
3. **Onboarding en el stamp correcto**: un tenant europeo tiene que nacer en la
   base de Europa, no migrarse después.

## 4. Arquitectura objetivo

### 4.1 Inventario de flujos: qué hay que mover o reemplazar

| Componente | Hoy | Para tenant europeo | Acción |
|---|---|---|---|
| App, jobs, migraciones | West US 2 | Stamp `eu` | Descomentar y aplicar el stamp |
| MySQL + backups (PITR 14 d, vault opcional, RG de backup `...-westus2-backup-rg`) | West US 2 | Stamp `eu` | Los backups **también** en la UE; `mysql_backup` y el vault de backup son por región |
| Redis, Key Vault, Blob (adjuntos de soporte, exports) | West US 2 | Stamp `eu` | Vienen con el stamp |
| Logs y telemetría (Log Analytics, OTEL, diagnostics) | Workspace del stamp `us` + `global_diagnostics` | Workspace del stamp `eu` | `global_diagnostics` y `defender` son globales: revisar qué datos del tenant llegan ahí |
| ACR (imágenes) | `westus2`, global | Puede quedar | Sólo imágenes, sin datos de clientes. Replicar geográficamente es opcional |
| Front Door | Global, geo-routing por país | Ruteo por tenant | Ver 4.3. Revisar qué se loguea y dónde (7) |
| Cloudflare (CDN/WAF, origen en EE. UU.) | Delante de todo | ¿Sigue en el camino? | Termina TLS: ve el tráfico del tenant. Decidir: sacarlo, o regionalizarlo (7) |
| WorkOS (SSO SAML, EE. UU.) | Login de usuarios | ¿Residencia UE? | Verificar; alternativa: Entra ID directo (la app ya usa MSAL) |
| Paddle (pagos, EE. UU./Reino Unido) | Facturación | Análisis jurídico | Es merchant of record: puede ser responsable propio, no sólo encargado. Los webhooks entran por la app (4.2) |
| IA: Azure OpenAI, Gemini (BYOK opcional) | EE. UU. | Deployment regional/Data Zone UE; Gemini apagado o BYOK con aviso | `docs/propuesta-capacidades-ia-2026-10-07.md` §4.5 punto 7 ya trata la residencia de la inferencia |
| Correo y notificaciones (Microsoft Graph) | EE. UU. | Verificar de dónde salen y qué contienen | Pendiente de revisar en el código |
| Soporte (`SupportTickets*`, adjuntos) | Misma base y Blob | Stamp `eu` | Viene con el stamp |
| CI/CD (GitHub Actions) | Runners en EE. UU. | Sin datos de clientes | **Verificar** que ningún dump ni log con datos de tenant pase por un runner. Las migraciones ya corren como job dentro del stamp |
| Estado de Terraform y secretos de CI | EE. UU. | Sin datos de clientes | Sólo metadatos de infraestructura |
| Acceso del equipo (Argentina) | Remoto | Sigue | Es una transferencia: Argentina tiene decisión de adecuación (Art. 45); documentarla en el registro de transferencias y verificar su vigencia |

### 4.2 Plano de control vs plano de datos

La base actual tiene **144 tablas**: 108 con columna `tenant_id` y 36 sin ella
(conteo hecho leyendo las migraciones con una regex: es una heurística, hay que
revisarla tabla por tabla antes de decidir). `residencia-de-datos.md` todavía
dice 48.

Las 36 sin `tenant_id`, agrupadas por destino probable:

| Grupo | Tablas | Destino |
|---|---|---|
| Catálogos públicos, sin datos personales | `OpenData*` (6), `FxRates`, `PricingUnits`, `BillingPricingUnitsCatalog`, `AllocationRules`, `PerspectiveRules`, `AiCache` | Replicar en cada stamp |
| Estado de la plataforma | `SaaSCronJobs`, `SystemCronRuns`, `SaaSComponentHealth`, `PlatformIncidents`, `PlatformStatusSnapshots`, `SystemAlerts`, `SystemAnnouncements`, `UserAnnouncementDismissals`, `GlobalSettings`, `PlatformGlobalAiConfig`, `LoadTestRuns`, `SaaSLoadTestHistory` | Por stamp (cada uno tiene sus jobs) |
| Snapshots de servicios de IA de Azure | `AzureContentSafetySnapshots`, `AzureDatabricksSnapshots`, `AzureDocumentIntelligenceSnapshots`, `AzureFoundrySnapshots`, `AzureMLSnapshots`, `AzureSearchSnapshots`, `AzureSpeechLanguageSnapshots`, `AzureVisionVideoSnapshots` | **Revisar**: probablemente son de tenant y usan otra columna de scope; si lo son, van al stamp del tenant |
| Comercial y comisiones | `Affiliates`, `SalesReps`, `PayoutRuns`, `SupportTicketMessages` | Decidir: afiliados y comerciales son datos personales de personas que quizá no sean europeas. `SupportTicketMessages` probablemente sí es de tenant: revisar |

Problemas de diseño que aparecen con más de un stamp y hay que resolver:

- **Superadmin cross-tenant.** Las pantallas que agregan todos los tenants
  (comisiones, gestión de tenants, métricas) hoy consultan una sola base.
  Con dos, o consultan cada stamp o se alimentan sólo de agregados sin datos
  personales.
- **Paddle.** El webhook llega a un endpoint. Con dos stamps hay que decidir si
  entra por el stamp del tenant (el tenant va en el payload) o por un punto
  global mínimo que reenvía.
- **Descubrimiento de tenant al loguearse.** Resolver "¿de qué tenant es este
  usuario?" antes de conocer la región exigiría un directorio global con
  emails: justo lo que se quiere evitar. Ver 4.3.
- **Crons.** `var.cron_jobs` se instancia dentro del módulo `stamp`, así que
  cada stamp tendría sus 14 procesos. Confirmar que ninguno cruza tenants de
  regiones distintas, y que las alertas de jobs (`alertas_jobs_minuto_compartido`)
  no se pisan entre stamps.

### 4.3 Ruteo: por tenant, no por país del visitante

El Front Door actual manda a un stamp según el **país desde donde viene el
request** (`GeoMatch`). Para este requisito eso es incorrecto en los dos
sentidos: un empleado de un tenant europeo de viaje en EE. UU. caería en el
stamp de EE. UU., y un visitante alemán de un tenant estadounidense, en el de
Europa. La región la define **el tenant**.

Opciones, de menor a mayor complejidad:

| Opción | Cómo | Pros / contras |
|---|---|---|
| **A. Hostname regional** (recomendada) | `eu.<dominio>` apunta al stamp `eu`; el tenant europeo entra siempre por ahí | Sin directorio global, sin lookup previo al login, el guard de 3.1 lo respalda. Contra: el cliente tiene que usar la URL correcta; hay que redirigir al que entre por la equivocada |
| B. Directorio global mínimo | Tabla `tenant → región` (y dominio de email → tenant) en un punto global | Una sola URL. Contra: el directorio guarda emails o dominios y vuelve a ser un tratamiento global |
| C. Regla de Front Door por tenant | Header o cookie con el tenant | Complejo, dependiente de un estado previo |

Con la opción A, el flujo del login sigue siendo el de hoy dentro de cada stamp.
Con la A, **`stamp_geo_routing` deja de usarse** y no hay que tocar
Front Door más que para dar de alta el hostname.

### 4.4 Cambios de aplicación

1. **Guard de región** (obligatorio): leer `DATA_REGION`; si el tenant del
   request tiene otro `data_residency`, responder 404. Test que fije la
   invariante.
2. **Terraform**: pasar `DATA_REGION = var.data_region` al app y a los jobs.
3. **Onboarding**: el alta de tenant (y el registro de afiliados) tiene que
   ocurrir en el stamp que corresponde. Si la persona entra por el hostname
   equivocado, redirigir **antes** de guardar nada.
4. **`/admin/data-residency`**: reactivar en el Sidebar sólo cuando el stamp
   exista. Cambiar la región de un tenant deja de ser un `UPDATE`: pasa a ser
   una migración de datos entre stamps (dump/restore por tenant). Hasta tener
   ese procedimiento, la región se fija al alta y la UI es de sólo lectura.
5. **`regionPool.ts`**: borrarlo, o dejarlo como está. Con app-por-stamp no
   cumple función y su comentario ("Future state") induce a error.
6. **Pantallas y APIs para el interesado** (Art. 15–22): exportación y borrado
   por usuario y por tenant. Hoy el DPA promete atender los pedidos por correo
   (`privacy@...`) pero **no encontré endpoints** que lo hagan.

## 5. Trabajo GDPR (documentación y proceso)

Es independiente de dónde estén los servidores y tiene que estar listo igual.

| Artículo | Qué falta | Notas |
|---|---|---|
| Art. 30 | Registro de actividades de tratamiento | No encontré uno en `docs/` |
| Art. 35 | DPIA | El producto hace monitoreo sistemático; la actividad por usuario de M365/Copilot (`M365UsersBoard`, `M365CopilotConfig`, `M365IndexLogs`) es monitoreo de empleados: en algunos países exige consulta al comité de empresa |
| Art. 28 | Actualizar DPA y lista de subencargados | Hoy dicen "una sola ubicación, EE. UU." (`SUBPROCESSORS_*.md`). El aviso a clientes es de 30 días: `docs/aviso-cambio-subencargado-2026.md` es el molde |
| Art. 27 | Representante en la UE | Probablemente hace falta (operador en Argentina, sin establecimiento en la UE). Que lo confirme el abogado |
| Art. 37 | Delegado de protección de datos | Hoy figura `privacy@...` como "DPO": decidir si hace falta uno formal |
| Art. 12–22 | Procedimiento y plazo de un mes | Ver 4.4 punto 6 |
| Art. 33–34 | Protocolo de brecha, 72 h | Conectar con `engineering-skills:incident-response` o el runbook propio |
| Art. 5(1)(c)(e), 25 | Minimización y retención | `docs/legal-compliance.md` dice "Audit Logs (7-year retention)": justificar esa retención o acortarla donde los logs tengan datos personales. Definir retención del resto (tickets, snapshots, PITR de 14 días) |
| Art. 17 / DPA §8 | "Borrado criptográfico" | El DPA lo promete; **no verifiqué que esté implementado** |
| Art. 44–49 | Transferencias residuales | Acceso del equipo desde Argentina; Paddle en Reino Unido; cualquier subencargado que no pueda migrar |
| ePrivacy | Cookies | Hay `CookieConsent`; revisar categorías y que nada cargue antes del consentimiento (`src/proxy.ts` menciona Google Fonts: son una transferencia a un tercero desde el navegador) |

**Cosas públicas a corregir antes de venderle a un cliente europeo**
(sobre-prometen hoy):

- `docs/legal-compliance.md` y la pantalla `/admin/compliance` muestran
  "GDPR ✓" en el roadmap. Sin Art. 30, DPIA ni flujo de derechos, ese check no
  se sostiene ante una auditoría.
- `infra/docs/residencia-de-datos.md` cuenta 48 tablas (son 144) y asume el
  refactor del pool (innecesario, ver 3).
- `docs/data-residency.md` y `SUBPROCESSORS_*.md` hablan de Brasil y de una sola
  ubicación: tienen que decir la verdad *antes* y *después* del stamp europeo.

## 6. Plan por fases

Cada fase tiene un criterio de "hecho" que se comprueba contra la fuente, no
contra un log. Regla del repo: un recurso de Azure mal nombrado devuelve vacío,
no error.

| Fase | Contenido | Hecho cuando |
|---|---|---|
| **0. Decisiones y legal** | Cerrar las decisiones de la sección 8; abogado revisa 1 y 5; contratar representante en la UE si corresponde | Decisiones anotadas en este archivo; DPAs de subencargados europeos o regionales conseguidos |
| **1. Infra del stamp `eu`** | Verificar capacidad y contratos (7); descomentar `eu`; `DATA_REGION`; hostname; migraciones; presupuesto | `az resource list` sobre el RG del stamp devuelve **todos** los recursos con `location` en la UE; `terraform plan` limpio; la app responde con una base vacía |
| **2. Aplicación** | Guard + test; onboarding por región; DSAR (export/borrado); decisión del `regionPool.ts` | Test del guard rojo sin el guard y verde con él; un tenant de prueba nace en `eu` y desde `us` da 404 |
| **3. Subencargados** | WorkOS, Cloudflare, IA, correo, Paddle según lo decidido | Tabla 4.1 sin ninguna fila "EE. UU." para tenants `eu`, salvo las que tengan excepción documentada |
| **4. Documentación pública** | DPA, subencargados, `data-residency.md`, política de privacidad; RoPA y DPIA; aviso de 30 días | Documentos publicados en los tres idiomas (`en`, `es`, `pt-BR`) y PDFs regenerados |
| **5. Tenants existentes** | Si hay tenants europeos hoy: dump/restore al stamp `eu` en ventana acordada | Conteos por tabla iguales origen/destino; el tenant en `us` borrado y el borrado verificado |

Antecedentes que pesan en la fase 1 (memoria del proyecto):

- **El apply de prod va sólo por CI** (`terraform_apply_solo_por_ci`). Un plan
  local, y el de CI cuando cambia `module.acr`, quieren reemplazar el role
  assignment del Key Vault y dejan a CI sin acceso. Un stamp nuevo agrega un
  `AcrPull` para su identidad en el ACR: **revisar el plan con lupa**.
- **Mirar el apply real, no el resumen del workflow**: un lock de estado ya hizo
  que un resumen pareciera un apply exitoso.
- **El push a `main` despliega a producción** (`push_solo_a_pedido`): el stamp
  nuevo, en sí, no toca el tráfico de `us`, pero el commit sí dispara el deploy.
- **Costo de referencia:** el stamp `us` del ejemplo usa `monthly_budget_amount
  = 250` (USD/mes). Un segundo stamp duplica el orden de magnitud, sin contar IA.

## 7. Contratos por verificar antes de implementar

Ninguno está verificado. Leerlos en `learn.microsoft.com`, no de memoria:

- Disponibilidad **en la región elegida** de: MySQL Flexible Server (esta
  suscripción ya tuvo `ProvisionNotSupportedForRegion` en East US 2, East US y
  Central US, ver `terraform.tfvars.example:20`), Container Apps con VNet
  injection, Azure Cache for Redis, Front Door, Data Protection Backup Vault.
- Qué datos guarda o registra **Front Door** y dónde (logs de acceso, WAF).
- Qué parte del procesamiento de **Azure Monitor / Log Analytics / Defender for
  Cloud** sale de la región del workspace.
- **Azure OpenAI**: tipos de deployment (Global / Data Zone / Standard), qué
  modelos están en Data Zone UE y dónde se procesa la inferencia.
- Redundancia y región de los **backups** (PITR, vault, `geoRedundantBackup`).
- **EU Data Boundary** de Microsoft: qué cubre y qué no.
- Terceros: residencia y DPA de **WorkOS**, **Cloudflare** (servicios
  regionales), **Paddle**, **Google Gemini**, y el servicio de correo.
- Estado vigente del **EU–US Data Privacy Framework** y de la decisión de
  adecuación del Reino Unido (si queda algún flujo hacia allí).

Y después de aplicar: **medir con `az`**, no con el log del workflow
(`medir_azure_antes_de_proponer`, `verificar_migraciones_prod`).

## 8. Decisiones abiertas

1. **Región de Europa**: `westeurope`, `northeurope`, `swedencentral`,
   `germanywestcentral`… Depende de capacidad de MySQL (7) y de si hay clientes
   alemanes que exijan Alemania.
2. **Ruteo**: opción A (hostname regional), B o C. Recomendación: A.
3. **¿Hay tenants europeos hoy?** Primera consulta: contar
   `Tenants WHERE data_residency = 'EU'` en prod y ver cuántos son realmente
   europeos. Cambia la fase 5.
4. **WorkOS**: ¿pedirle residencia UE o reemplazarlo por Entra ID?
5. **Cloudflare**: ¿se saca del camino para tenants `eu`?
6. **IA para tenants `eu`**: ¿sólo Azure OpenAI en Data Zone UE? ¿Gemini
   desactivado?
7. **Paddle**: ¿se acepta como responsable propio, o se busca otro medio de
   cobro para clientes europeos?
8. **Comerciales y afiliados**: ¿viven en un plano global o por stamp?
9. **DPO formal y representante del Art. 27.**
10. **Cambio de región de un tenant ya creado**: ¿se soporta (migración entre
    stamps) o se prohíbe?

## 9. Cómo retomar

1. Leer este archivo y `infra/docs/residencia-de-datos.md` (con las
   correcciones de la sección 5).
2. Cerrar las decisiones de la sección 8, empezando por la 3 (cuántos tenants
   europeos hay).
3. Verificar los contratos de la sección 7 y anotar el resultado acá.
4. Recién entonces: fase 1, con `terraform plan` en CI.
