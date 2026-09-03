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

```bash
az keyvault secret show --vault-name cscs-finops-prod-wus2-kv \
  -n azure-marketplace-aad-app-secret --query id -o tsv
```

Si no está, crearlo con el client secret de la App Registration del publisher y
mapearlo en `key_vault_secret_env` del `terraform.tfvars` de prod.

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

## 4. Por qué `marketplace_status` va aparte de `subscription_status`

`marketplace_status` es lo que dice **Microsoft**. `subscription_status` es el
estado comercial nuestro, y también lo mueven Paddle y las acciones de
SuperAdmin. Si se unificaran, una suspensión de Azure pisaría el motivo real de
una baja gestionada por otro canal, y en una conciliación con Partner Center no
se podría explicar de dónde salió cada estado. Fijado en
`__tests__/unit/marketplaceStatus.test.ts`.
