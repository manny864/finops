# Pruebas de carga externas (JMeter/k6) con Service Principal

Arquitectura: una identidad máquina-a-máquina (Service Principal, client
credentials — sin usuario, sin MFA) obtiene un access token de Entra ID y lo
usa para autenticarse contra un endpoint dedicado (`/api/loadtest/probe`)
que ejercita los 3 contenedores reales del stack (app Next.js + MySQL +
Redis), no un simulador aislado.

No se reutiliza `/api/health` a propósito: ese endpoint es público y sin
DB/Redis (lo usa el healthcheck de Docker/Traefik, que no tiene forma de
mandar un Bearer token) — pegarle con carga solo mediría el techo del
proceso Node.js vacío, no la infraestructura real. `/api/loadtest/probe` sí
exige el token del Service Principal y hace un `SELECT 1` en MySQL + un
`PING` a Redis en cada llamada.

## 1. Crear el Service Principal en Azure Entra ID (una sola vez)

```bash
# 1a. Crear el App Registration dedicado a load testing.
az ad app create --display-name "FinOps-LoadTest-SP"
# Anotar el "appId" (Client ID) que devuelve. Este valor es el que va en
# LOAD_TEST_SP_APP_ID (no es sensible, es un identificador público — igual
# que AZURE_CLIENT_ID ya vive en el .env plano del VPS).

# 1b. Crear el Service Principal asociado y un secret.
az ad sp create --id <APP_ID_DEL_PASO_1a>
az ad app credential reset --id <APP_ID_DEL_PASO_1a> --display-name "loadtest-secret" --years 1
# Esto devuelve "password" (Client Secret) y "tenant" (Tenant ID). El
# secret NO se puede volver a ver después de este comando — subilo AL TOQUE
# al Key Vault (paso 1c), no lo dejes en la terminal/portapapeles/chat.
```

### 1c. Guardar el Client Secret en Key Vault (no en `.env`, no en el script)

Este proyecto ya tiene Key Vault integrado (`cscs-kv-finops-saas-prod` — ver
[key-vault-integration.md](key-vault-integration.md)). El secret del SP de
load testing va ahí, bajo un nombre que lo distingue claramente de los
`infra-*` (esos los hidrata la propia app en boot — este NO: nuestro
backend nunca necesita el client secret, solo lo necesita quien CORRE k6/
JMeter desde afuera, así que no tiene sentido que la app lo lea):

```bash
az keyvault secret set \
  --vault-name cscs-kv-finops-saas-prod \
  --name loadtest-sp-client-secret \
  --value "<el 'password' devuelto en el paso 1b>"
```

RBAC necesario para correr esto: `Key Vault Secrets Officer` (o
`Administrator`) sobre el vault — el mismo rol que ya tiene el humano admin
según el runbook de key-vault-integration.md.

Para consumirlo al momento de correr la prueba (en vez de tenerlo pegado en
un script o env var persistente), quien ejecuta k6/JMeter lo trae recién en
ese momento:

```bash
export CLIENT_SECRET=$(az keyvault secret show \
  --vault-name cscs-kv-finops-saas-prod \
  --name loadtest-sp-client-secret \
  --query value -o tsv)
```

Esto requiere que esa persona/CI tenga el rol `Key Vault Secrets User`
(mínimo, solo lectura) sobre el vault — pedilo por separado del rol
`Secrets Officer` del paso anterior, no reuses el mismo principal con más
permiso del que necesita cada quien.

## 2. Exponer la app FinOps como API y dar el permiso mínimo

El Service Principal de load testing necesita permiso para pedir un token
cuya `audience` sea la app FinOps (así nuestro backend lo reconoce). Esto se
hace vía "Expose an API" + un App Role de tipo Application, NO vía permisos
de Microsoft Graph (el SP de load testing no necesita leer nada de Graph,
solo necesita poder autenticarse contra NUESTRA API).

En el Azure Portal, sobre el **App Registration de la app FinOps** (la que
ya usan los usuarios para loguearse — el mismo `AZURE_CLIENT_ID` que ya está
configurado en el `.env` del VPS):

1. **Expose an API** → si no tiene un Application ID URI, generarlo (default
   `api://<client-id-de-finops>` está bien).
2. **App roles** → **Create app role**:
   - Display name: `Load Test Probe`
   - Allowed member types: **Applications** (no Users/Groups)
   - Value: `LoadTest.Probe`
   - Description: "Permite ejecutar pruebas de carga contra /api/loadtest/probe"
3. En el **App Registration del Service Principal de load testing**
   (`FinOps-LoadTest-SP`) → **API permissions** → **Add a permission** →
   **APIs my organization uses** → buscar la app FinOps → **Application
   permissions** → tildar `LoadTest.Probe` → **Add permissions** →
   **Grant admin consent** (requiere un admin del tenant).

Esto es el "permiso mínimo": el SP de load testing solo puede pedir tokens
con audience = la app FinOps, y nuestro backend además valida explícitamente
que el `appid` del token coincida con este Service Principal específico (no
alcanza con tener *cualquier* token válido del tenant — ver paso 3).

## 3. Configurar el backend (nuestro lado)

Agregar al `.env` del VPS (mismo archivo que ya define `AZURE_CLIENT_ID`,
`REDIS_HOST`, etc. — `docker-compose.yml` ya lo pasa a los 3 contenedores
vía `env_file: .env`, no hace falta tocar el compose):

```bash
LOAD_TEST_SP_APP_ID=<APP_ID_DEL_PASO_1a>
```

Sin esta variable el endpoint rechaza TODO (fail-closed) — ver
`requireLoadTestServicePrincipal` en `src/lib/requestAuth.ts`. La
validación reutiliza el mismo pipeline de verificación de firma
RS256/issuer/audience que ya usan los tokens de usuario (`validateRequestToken`),
así que no hay lógica de JWT nueva que auditar — solo se agrega el chequeo
extra de que `claims.appid` sea EXACTAMENTE este Service Principal, no
cualquier identidad válida del tenant.

Desplegar el cambio (`git push` a `main`, el deploy ya corre automático vía
GitHub Actions) antes de correr la primera prueba.

## 4. Correr la prueba con k6

Script listo en [`loadtest/k6-probe.js`](../loadtest/k6-probe.js) — obtiene
el token UNA vez (`setup()`, no por request) vía `client_credentials` y
después manda tráfico real con ese token:

```bash
k6 run \
  -e TENANT_ID=<tenant-id> \
  -e CLIENT_ID=<app-id-del-paso-1a> \
  -e CLIENT_SECRET=<secret-del-paso-1a> \
  -e APP_SCOPE=api://<client-id-de-finops>/.default \
  -e TARGET_URL=https://finops.cscloudsolutions.com.ar/api/loadtest/probe \
  --vus 20 --duration 30s \
  loadtest/k6-probe.js
```

`--vus`/`--duration` (o `--stage` para ramp-up) los define quien corre la
prueba — a diferencia de la herramienta interna (`/admin/load-test`, superadmin,
con topes duros de 50 concurrencia / 15s), acá no hay límites de nuestro lado:
es tu herramienta, vos controlás la carga. Los thresholds del script
(`p(95)<1000ms`, `error rate <5%`) son solo indicadores visuales en el
reporte de k6, no bloquean nada.

## 5. JMeter (alternativa a k6)

Mismo flujo en 2 samplers:
1. **HTTP Request** (POST) a `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token`,
   body form-urlencoded con `grant_type=client_credentials`, `client_id`,
   `client_secret`, `scope=api://<client-id-de-finops>/.default` → extraer
   `access_token` de la respuesta JSON con un **JSON Extractor** (post-processor).
2. **HTTP Request** (GET) a `/api/loadtest/probe`, header `Authorization: Bearer ${access_token}`,
   dentro de tu Thread Group con la concurrencia/duración que quieras probar.

## Qué mide esto vs. la herramienta interna

| | `/admin/load-test` (interno) | k6/JMeter externo (este doc) |
|---|---|---|
| Origen del tráfico | Desde dentro del mismo proceso Next.js | Desde afuera, por la red real (DNS, Traefik, TLS) |
| Auth | Ninguna (superadmin ya autenticado en la UI) | Service Principal, client credentials, sin MFA |
| Límites | Duros (concurrencia ≤50, duración ≤15s) | Los que definas vos |
| Uso recomendado | Chequeo rápido ad-hoc desde el dashboard | Prueba de carga real pre-lanzamiento / capacity planning |
