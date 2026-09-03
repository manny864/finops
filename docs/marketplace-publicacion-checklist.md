# Publicación en Azure Marketplace — checklist de salida

Estado al 2026-09-03. **La integración técnica ya está construida**; lo que falta
es el circuito administrativo en Partner Center más dos cosas de infraestructura.

---

## 1. Lo que YA está implementado

No hace falta escribirlo: existe y está en producción.

| Pieza | Dónde | Notas |
|---|---|---|
| Token contra el Fulfillment API | `src/lib/marketplace/azure.ts` → `getAadAccessToken()` | Recurso `20e940b4-…`, con caché |
| Resolve del token de aterrizaje | `resolveSubscription()` | |
| Activación | `activateSubscription()` | |
| Estado de operación asíncrona | `patchOperation()` | |
| **Verificación JWT del webhook** | `verifyWebhookJwt()` | **Crítico**: sin esto cualquiera puede cambiarle el plan a un tenant |
| Landing page | `src/app/[locale]/marketplace/azure/landing/page.tsx` | Lee `?token=`, resuelve y ofrece activar |
| Webhook de ciclo de vida | `src/app/api/webhooks/marketplace/azure/route.ts` | ChangePlan, ChangeQuantity, Suspended, Reinstated, Renew, Unsubscribed |
| Activación + alta de tenant | `.../azure/activate/route.ts` | |
| Bitácora de eventos | Tabla `MarketplaceEvents` | |

> **No crear `marketplaceFulfillment.service.ts`.** Sería un duplicado de
> `src/lib/marketplace/azure.ts`, que además ya resuelve la verificación JWT del
> webhook — pieza que las guías genéricas suelen omitir y que es un agujero de
> seguridad si falta.

---

## 2. URLs reales para cargar en Partner Center

**Ojo: no son las de la guía genérica.** Éstas son las rutas que existen:

| Campo en Partner Center | Valor real |
|---|---|
| **Landing page URL** | `https://finops.cscloudsolutions.com.ar/es/marketplace/azure/landing` |
| **Connection webhook** | `https://finops.cscloudsolutions.com.ar/api/webhooks/marketplace/azure` |
| **Azure AD Tenant ID** | el de la App Registration del publisher |
| **Azure AD Application ID** | client id de esa App Registration |

Cargar `/marketplace/azure` (sin `/landing`) o `/api/webhooks/azure-marketplace`
haría que Microsoft pegue contra rutas que **no existen**, y la oferta no pasa la
certificación.

---

## 3. Lo que falta antes de publicar

### 3.1 Secreto en Key Vault — BLOQUEANTE

`azure.ts` leía `AZURE_MARKETPLACE_AAD_CLIENT_SECRET` mientras Key Vault e
`infraSecrets.ts` inyectan `AZURE_MARKETPLACE_AAD_APP_SECRET`. **Nunca se
encontraban**: el token de Marketplace fallaba siempre con "not configured", así
que resolve y activate estaban muertos. Corregido en el código; falta verificar
que el secreto EXISTA en el vault de producción:

El nombre en el vault lleva el prefijo `infra-` — así lo pide
`infraSecrets.ts` (`KV_SECRET_NAME`), que es quien lo busca:

```bash
az keyvault secret show --vault-name cscs-finops-prod-wus2-kv \
  -n infra-azure-marketplace-aad-app-secret --query id -o tsv
```

Si no está, crearlo con el client secret de la App Registration del publisher.
**Con ese nombre exacto**: si se crea sin el prefijo, `getInfraSecret()` no lo
encuentra, cae al fallback de `.env` — que tampoco lo tiene — y `ensureConfig()`
vuelve a lanzar "not configured". Es el mismo modo de falla que el bug de §3.1,
con otro nombre: un secreto que existe pero que nadie busca donde está.

**No hace falta mapearlo en `key_vault_secret_env`.** Ese mecanismo inyecta
secretos como env vars del Container App; este secreto lo hidrata
`hydrateInfraSecretsFromKeyVault()` desde `src/instrumentation.ts` al arrancar,
usando la managed identity. Mapearlo además sería un segundo camino para el
mismo valor.

### 3.2 Variables de entorno en producción — VERIFICADO: FALTAN

Consultado el Container App de producción el 2026-09-03, la ÚNICA variable de
Marketplace presente es `AZURE_MARKETPLACE_OFFER_ID`:

```bash
az containerapp show -n cscs-finops-prod-westus2-web -g cscs-finops-prod-westus2-rg   --query "properties.template.containers[0].env[?contains(name,'MARKETPLACE')].name" -o tsv
# -> AZURE_MARKETPLACE_OFFER_ID
```

Faltan las tres credenciales de la App Registration:

| Variable | Dónde va | Estado |
|---|---|---|
| `AZURE_MARKETPLACE_AAD_TENANT_ID` | `extra_env_vars` (no es secreto) | **falta** |
| `AZURE_MARKETPLACE_AAD_APP_ID` | `extra_env_vars` (no es secreto) | **falta** |
| `AZURE_MARKETPLACE_AAD_APP_SECRET` | Key Vault → `infraSecrets.ts` lo hidrata | sin verificar (403 sobre el vault) |

Las dos primeras **no están mapeadas en `infraSecrets.ts` ni en el Container
App**, así que no llegan por ningún camino. Con eso `ensureConfig()` lanza y todo
el flujo de Marketplace queda muerto, aun con el nombre del secreto ya corregido.

**Es lo primero a resolver**: sin la App Registration provisionada no tiene
sentido avanzar con Partner Center, porque el ciclo de prueba va a fallar en el
paso del resolve.

### 3.3 Circuito en Partner Center

1. Registro en el Microsoft AI Cloud Partner Program, verificado.
2. Alta del programa Commercial Marketplace, con perfil de impuestos y payout.
3. App Registration **multi-tenant** en Entra ID + client secret.
4. New Offer → SaaS. Transaccionable si se cobra por Microsoft.
5. Planes alineados a los tiers reales: Professional (USD 299/mes) y
   Business (USD 999/mes). Enterprise va por contacto, no por Marketplace.
6. Listing con enlaces a `/legal/terms` y `/legal/privacy`, que ya existen.
7. Preview Audience con el tenant de pruebas → Publish → link privado.

### 3.4 Ciclo de prueba obligatorio

Comprar desde el link privado y verificar, en este orden:

1. Redirección a `.../es/marketplace/azure/landing?token=…`.
2. El token resuelve y la landing muestra el plan.
3. Activar deja el tenant con `marketplace_status = 'Subscribed'`,
   `marketplace_offer_id`, `marketplace_purchaser_email` y
   `marketplace_purchaser_tenant_id` poblados.
4. Cambiar el plan desde Azure Portal → llega `ChangePlan` y el tier cambia.
5. Cancelar → llega `Unsubscribed`, queda `marketplace_status='Unsubscribed'` y
   el ciclo de vida registra la baja con fecha (MEJ-12).

```sql
SELECT tenant_id, marketplace_status, marketplace_offer_id,
       marketplace_purchaser_email, subscription_status, canceled_at
  FROM Tenants WHERE marketplace_subscription_id = '<sub-id>';
```

---

## 4. Lo que hay que CREAR, con nombres y valores exactos

Cuatro cosas, en este orden. Nada de código: todo lo que falta es
provisionamiento.

### 4.1 App Registration en Entra ID (tenant del publisher)

**Primero: en qué directorio.** La cuenta tiene dos, y no son intercambiables:

| Directorio | Tenant ID | Qué hay ahí |
|---|---|---|
| CSCloudSolution-Production | `8b41364f-581a-4e43-b7cb-13138dac5517` | La App Registration `07d029f8-…` que le pide tokens a los clientes (`AZURE_TENANT_ID`) |
| CSCS-LandingZone | `81ebe027-e6af-4e09-bc73-58c9012c6408` | La suscripción con el Container App y el Key Vault de producción |

La app tiene que ir en el directorio **asociado a la cuenta de Partner Center**,
no en el de la infraestructura: Microsoft valida que el app registration
declarado en la configuración técnica pertenezca al tenant del publisher. Cuál
de los dos es no se puede ver desde el CLI de Azure — se confirma en Partner
Center → Settings → Account settings → Tenants.

Que el Key Vault esté en el otro directorio no es problema: el secreto lo lee la
managed identity del Container App desde su propio vault, y el `tenantId` viaja
como env var. No hace falta que coincidan.

Entra ID (en el directorio que corresponda) → App registrations → New
registration:

| Campo | Valor |
|---|---|
| Name | `cscs-finops-marketplace-fulfillment` |
| Supported account types | **Accounts in any organizational directory (multitenant)** |
| Redirect URI | *(ninguno)* |
| API permissions | **ninguno** |

Sin redirect URI y sin permisos a propósito: el flujo es `client_credentials`
contra el recurso `20e940b3-4c77-4b0b-9a53-9e16a1b010a7` (el Fulfillment API),
que no se otorga por consentimiento sino por el registro de la app en Partner
Center. Agregar permisos no hace nada.

**App dedicada, no reutilizar `AZURE_CLIENT_ID` (`07d029f8-…`).** Ese client id
es el que le pide tokens a los directorios de los clientes, y
`AZURE_MARKETPLACE_AAD_APP_ID` no es sólo una credencial: es la **audiencia**
contra la que se valida el JWT del webhook (`azure.ts:208`). Si se comparte, un
token emitido para esa audiencia por cualquier otro camino pasa el chequeo de
audiencia, y lo único que queda en pie es el allowlist de issuers. Con una app
propia, la audiencia del webhook es exclusiva del servicio de Marketplace.

De ahí salen dos valores para `extra_env_vars`:

- Directory (tenant) ID → `AZURE_MARKETPLACE_AAD_TENANT_ID`
- Application (client) ID → `AZURE_MARKETPLACE_AAD_APP_ID`

### 4.2 Client secret → Key Vault

Certificates & secrets → New client secret. El valor va al vault **con el
prefijo `infra-`** (ver §3.1):

```bash
az keyvault secret set --vault-name cscs-finops-prod-wus2-kv \
  -n infra-azure-marketplace-aad-app-secret --value '<el-secret>'
```

Anotar la fecha de expiración: cuando vence, resolve y activate dejan de
funcionar y el síntoma es el mismo "not configured".

### 4.3 Las dos env vars no secretas

En `infra/terraform/environments/prod/terraform.tfvars`, dentro de
`extra_env_vars`, junto a `AZURE_MARKETPLACE_OFFER_ID`:

```hcl
  AZURE_MARKETPLACE_AAD_TENANT_ID = "<directory-tenant-id>"
  AZURE_MARKETPLACE_AAD_APP_ID    = "<application-client-id>"
```

El archivo está gitignoreado: CI lo escribe desde el secret `TF_VARS_PROD`, así
que hay que resubirlo y correr el workflow de Terraform.

```bash
gh secret set TF_VARS_PROD < infra/terraform/environments/prod/terraform.tfvars
```

### 4.4 Partner Center

| Qué | Valor |
|---|---|
| Offer type | SaaS |
| Offer ID | libre (ver nota) |
| Plan IDs | `professional-monthly`, `professional-annual`, `business-monthly`, `business-annual` |
| Landing page URL | `https://finops.cscloudsolutions.com.ar/es/marketplace/azure/landing` |
| Connection webhook | `https://finops.cscloudsolutions.com.ar/api/webhooks/marketplace/azure` |
| Azure AD Tenant ID | el de §4.1 |
| Azure AD Application ID | el de §4.1 |

**Los plan IDs sí importan.** `planMapping.ts` los traduce a tier con una tabla
exacta. Un ID que no esté en esa tabla cae a `inferTierByKeyword()`, que busca
las palabras `enterprise` y `business` en el string y si no encuentra ninguna
devuelve **Professional**. O sea: un plan llamado `plan-basico` o `premium` se
convierte en Professional sin avisar. Usar los IDs de la tabla, o como mínimo
que el nombre del tier aparezca literal en el ID.

**El Offer ID, en cambio, no lo lee nadie.** `AZURE_MARKETPLACE_OFFER_ID` está
en el Container App pero ningún archivo de `src/` lo consume: el
`marketplace_offer_id` que se guarda sale de lo que resuelve Microsoft, no de la
variable. Conviene mantenerla en sincronía por claridad, pero no es un requisito
funcional y no hay que elegir el Offer ID para que coincida.

Enterprise no se publica: su capacidad va negociada por contrato. Si alguna vez
se publicara, `enterprise-monthly` y `enterprise-annual` ya están mapeados.

### 4.5 Lo que NO hay que crear

- **`marketplaceFulfillment.service.ts`** — duplicaría `src/lib/marketplace/azure.ts`.
- **Endpoints nuevos** — las tres rutas existen y están en producción.
- **Migración de base de datos** — `20260903-002-marketplace-fulfillment-fields.sql`
  ya está en el repo y viajó en el deploy; el job de migraciones la aplica.
- **Redirect URI / API permissions** en la App Registration (§4.1).
- **Producto en Paddle** para los planes de Marketplace — cuando la compra entra
  por Azure, cobra Microsoft. Paddle es el otro canal.

---

## 5. Por qué `marketplace_status` va aparte de `subscription_status`

`marketplace_status` es lo que dice **Microsoft**. `subscription_status` es el
estado comercial nuestro, y también lo mueven Paddle y las acciones de
SuperAdmin. Si se unificaran, una suspensión de Azure pisaría el motivo real de
una baja gestionada por otro canal, y en una conciliación con Partner Center no
se podría explicar de dónde salió cada estado. Fijado en
`__tests__/unit/marketplaceStatus.test.ts`.
