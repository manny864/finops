# HANDOFF — FinOpsProyect: migración del VPS a Azure Container Apps
**Última actualización:** 2026-07-29

## Dónde quedó

La app corre en Azure, se despliega sola desde GitHub, y tiene dominio propio:

- **Producción:** `https://finops.cscloudsolutions.com.ar` (detrás de Cloudflare, Full strict)
- **FQDN de Azure** (sigue vivo, no lo saques): `cscs-finops-prod-westus2-web.victoriousmoss-01886ec5.westus2.azurecontainerapps.io`

| | Estado |
|---|---|
| Terraform | 83+ recursos, plan estable salvo drift menor conocido (ver abajo) |
| Esquema | 56 migraciones, 80 tablas — idéntico al VPS |
| Deploy | Automático: push a `main` → GitHub Actions → Container Apps |
| Dominio propio | Certificado + binding activos, importados al state |
| Checkov (gate de infra) | 122/122 checks, verificado en CI real |
| Repo | **privado** (estuvo público un rato hoy — ver más abajo) |
| Superadmin, Key Vault, Redis | funcionando |
| Azure Sync | `degraded` — correcto: hay tenants activos sin credenciales cargadas |

## Pendientes, por urgencia

### 1. Credencial OIDC para `environment:dev` (bloquea `plan-apply` en PRs)
`terraform.yml` → job `plan-apply` declara `environment: dev` (default cuando el
trigger es `pull_request`, no `workflow_dispatch`). Eso cambia el subject del
token OIDC a `repo:manny864/finops:environment:dev`, y el service principal
`cscs-finops-terraform` sólo tiene credenciales para:
```
repo:manny864/finops:environment:prod
repo:manny864/finops:pull_request
repo:manny864/finops:ref:refs/heads/main
```
`azure/login` falla con eso. **No lo toqué** — crear una credencial federada es
un cambio de superficie de confianza de identidad y es tu decisión. `scan` (el
gate de Checkov) sí funciona bien en PRs; sólo `plan-apply` queda bloqueado.

### 2. Rotar credenciales expuestas (vos ya dijiste que no vas a rotar — asumido)
`.env.production` viajó dentro de imágenes del ACR hasta el 2026-07-28 ~21:52
UTC (antes de que `.dockerignore` excluyera `.env*`). Esas 14 imágenes ya se
purgaron del registry. Decisión tuya explícita: no rotar `DB_PASSWORD`,
`CRON_SECRET`, `AZURE_CLIENT_SECRET`, `GEMINI_API_KEY` — riesgo asumido.
Paddle sí se rotó (ver abajo).

### 3. `allowed_ip_ranges` con los rangos de Cloudflare
Sigue vacío. El FQDN de Azure (`*.azurecontainerapps.io`) es alcanzable
directo salteando el WAF de Cloudflare. El mecanismo ya existe
(`modules/containerapp/main.tf`, `ip_security_restriction`), sólo falta
cargar la variable.

### 4. `resource_lock_enabled = true`
Cuando el sistema esté estable un tiempo.

### 5. Drift de tags/`workload_profile_name`
`terraform plan` muestra ~17-18 cambios permanentes: Azure agrega
`workload_profile_name="Consumption"` y ajusta tags (`Owner`,
`Environment`) que Terraform no declaró. Es cosmético — no fuerza replace en
ningún recurso — pero conviene declarar esos valores explícitamente en algún
momento para que el plan quede realmente limpio.

## Repo público → privado (2026-07-29)

El repo estuvo público un rato. Verificado: **ningún secreto real llegó al
historial de git** (`.env.production` nunca se commiteó, sólo `.env.example`).
El riesgo real era la topología de infra expuesta (IDs, nombres de recursos,
arquitectura completa en comentarios) y que `terraform.yml` corre `scan` en
cualquier PR contra `infra/terraform/**`, incluido uno abierto desde un fork.
Ya se volvió a privado. `scan` no toca Azure (sólo Checkov), así que no había
explotación directa posible, pero no vale la pena dejarlo abierto de más.

## Paddle — estado final

| | Valor |
|---|---|
| `PADDLE_API_KEY` | `pdl_live_...`, en Key Vault (`infra-paddle-api-key`) |
| `PADDLE_WEBHOOK_SECRET` | rotado, en Key Vault (`infra-paddle-webhook-secret`) |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | `live_a5fd740ac1687e38b13f619591e`, en variable de GitHub y horneado en el bundle |
| Los 6 price id | de producción, verificados contra la API (dan `forbidden` de lectura con esta key — normal, la key no tiene scope de precios, pero sí tiene el de `/subscriptions` que es lo único que usa la app) |
| `.env.production` local | ✅ sincronizado — bloque live activo, sandbox comentado |

Checkout probado end-to-end tras el fix de precios: funciona.

## Trampas — leer antes de tocar

### `AZURE_CLIENT_ID` significa TRES cosas distintas
Ya rompió producción una vez. No reusar ese nombre:

| Contexto | Valor | Para qué |
|---|---|---|
| Secret de GitHub (`azure/login`) | `3826973d-…` (SP `cscs-finops-terraform`, es el **appId**, no el objectId) | que el pipeline entre a Azure |
| `extra_env_vars` de la app | `07d029f8-…` | que el backend hable con suscripciones de clientes |
| `AZURE_KEYVAULT_MI_CLIENT_ID` | `99141ef2-…` (managed identity del stamp) | que la app lea el Key Vault |

Ídem `AZURE_TENANT_ID`: como secret de GitHub va el de **CSCS** (`81ebe027`); en
`extra_env_vars` va el del **cliente** (`8b41364f`). Cruzarlos da `AADSTS700016`.

### Managed Certificate + Custom Domain: dos bugs del provider `azurerm`
Encontrados activando `finops.cscloudsolutions.com.ar` (certificado y binding
se habían creado a mano en el portal antes de que el módulo Terraform
existiera; se importaron).

1. **IDs desalineados entre dos recursos del mismo provider.**
   `azurerm_container_app_environment_managed_certificate.id` usa el segmento
   real de Azure (`.../managedCertificates/<nombre>`), pero
   `azurerm_container_app_custom_domain.container_app_environment_certificate_id`
   valida contra el segmento `certificates` (el de BYOC/legacy). Usar el
   `.id` tal cual hace **reventar hasta un `terraform plan`** con error de
   parseo, no un diff. Se resuelve con
   `replace(cert.id, "managedCertificates", "certificates")`.

2. **`replace()` interpreta `/patrón/` como regex.** El primer intento de
   fix usó `"/managedCertificates/"` (con barras) como patrón — Terraform lo
   tomó como delimitador de regex y produjo barras dobles en el resultado.
   El patrón va sin barras: `"managedCertificates"`.

3. **`container_app_environment_certificate_id` es de sólo-escritura.** Al
   importar el binding, Azure sólo devuelve la contraparte de lectura
   (`container_app_environment_managed_certificate_id`), así que cualquier
   refresh ve el atributo como "distinto" del config — y es `ForceNew`. Sin
   `ignore_changes` en ese atributo, cada plan quería destruir y recrear un
   binding que ya estaba funcionando en producción. Se ignora explícitamente.

Todo esto queda comentado in-situ en `modules/custom_domain/main.tf`.

### Los IDs de import de Container Apps no son intuitivos
- Managed certificate: `.../managedEnvironments/<env>/managedCertificates/<nombre>`
- Custom domain binding: `.../containerApps/<app>/customDomainName/<dominio>`
  (el segmento es `customDomainName`, **no** `customDomains` — singular y con
  "Name", pese a que el resto de la API usa plural).

### El Redis de prod NO se puede crear desde cero
`CREATE` con `high_availability=true` falla siempre en West US 2 (a los 2m10s
exactos, con B3 y con B0 por igual). El `UPDATE` de false→true sí funciona, y
`zones` queda en `null` en ambos casos — no es capacidad zonal, es el path de
*create* de Azure el que está roto.

Si hay que rehacerlo: crear con `high_availability_enabled = false`, aplicar,
y después `az redisenterprise update -n <name> -g <rg> --high-availability Enabled`.

### Probar migraciones en local, CON LA COLLATION DE AZURE
```bash
docker run -d --name mig -e MYSQL_ROOT_PASSWORD=t -e MYSQL_DATABASE=finops \
  -p 13306:3306 mysql:8 --collation-server=utf8mb4_unicode_ci
DB_HOST=127.0.0.1 DB_PORT=13306 DB_USER=root DB_PASSWORD=t DB_NAME=finops npm run migrate
```
`mysql:8` sin ese flag usa `utf8mb4_0900_ai_ci`, distinto del
`utf8mb4_unicode_ci` que pone Terraform — un FK que pasa en local revienta en
Azure con `ER_FK_INCOMPATIBLE_COLUMNS`. Ya pasó una vez.

### Nunca `-lock=false` ni Terraform concurrente
Contra backend remoto produce *lost update*. Los "state lock stuck" son el
síntoma, no la causa.

### Checkov: `framework: terraform` en el workflow, no todos los frameworks
Si corrés Checkov local para verificar antes de pushear, agregá
`--framework terraform` al comando — sin eso corre también el scanner de
secretos (`CKV_SECRET_*`), que en este repo da falsos positivos (nombres de
Key Vault secrets con forma de alta entropía) y no corre en CI de todas
formas.

## Qué se arregló esta sesión (resumen, por si reaparece algo parecido)

**Esquema:** 37 tablas y 37 columnas que el VPS tenía y las migraciones no
creaban. Se sacaron con `mysqldump --no-data` del VPS real, DDL literal, sin
inferir nada (`20260728-003-sincronizar-esquema-vps.sql`).

**Autenticación:** el wrapper de Key Vault sólo sabía Service Principal (era
para el VPS). Se agregó `ManagedIdentityCredential` directo — no
`DefaultAzureCredential`, que prueba `EnvironmentCredential` primero y tomaba
credenciales equivocadas.

**Redis:** zona DNS privada equivocada (`redisenterprise.cache` en vez de
`redis.azure.net`) y clustering `OSSCluster` (exige cliente cluster-aware) en
vez de `EnterpriseCluster`.

**Build/CI:** `.dockerignore` no excluía `.env*` — corregido. El Dockerfile
usaba `RUN --mount=type=cache` (exige BuildKit, `az acr build` no lo tiene) —
el pipeline nunca habría podido compilar. `deploy-azure.yml` tenía nombres de
plantilla sin completar (`REPLACE_WITH_ACR_NAME`, etc.) — corregidos y
verificados con un deploy real de punta a punta.

**Checkov:** 27 hallazgos en la primera corrida real sobre `infra/` — 7
arreglados (secretos con expiración, política SAS, diagnostic setting de blob
en el sub-recurso correcto), 20 documentados como decisión consciente
(costo/complejidad sin mandato de compliance). Un paso adicional de subida de
SARIF al Security tab bloqueaba el gate entero por 403 (repo privado sin
GitHub Advanced Security) — se hizo no-bloqueante.

## Estado del repo

Rama de trabajo: `staging`. Los últimos commits (Checkov + dominio propio)
están pusheados; falta abrir/actualizar el PR hacia `main` para que el
próximo deploy los incluya. Nada crítico sin commitear salvo lo que esta
sesión dejó en curso al momento de escribir esto — revisar `git status` antes
de asumir que está todo integrado.
