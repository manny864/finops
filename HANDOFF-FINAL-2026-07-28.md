# HANDOFF — FinOpsProyect: migración del VPS a Azure Container Apps
**Última actualización:** 2026-07-30

## Dónde quedó

La app corre en Azure, se despliega sola desde GitHub, y tiene dominio propio:

- **Producción:** `https://finops.cscloudsolutions.com.ar` (detrás de Cloudflare, Full strict)
- **FQDN de Azure** (sigue vivo, no lo saques): `cscs-finops-prod-westus2-web.victoriousmoss-01886ec5.westus2.azurecontainerapps.io`

| | Estado |
|---|---|
| Terraform | 83+ recursos, plan estable salvo drift menor conocido (ver abajo) |
| Esquema | 56 migraciones, 80 tablas — idéntico al VPS |
| Deploy | Automático: push a `main` → GitHub Actions → Container Apps. **Verificado end-to-end el 2026-07-30** (PR #97, 15m22s, todos los pasos en verde; `/api/health` 200) |
| Dominio propio | Certificado + binding activos, importados al state |
| Checkov (gate de infra) | 122/122 checks, verificado en CI real |
| Repo | **privado** (estuvo público un rato el 2026-07-29 — ver más abajo) |
| Superadmin, Key Vault, Redis | funcionando |
| Azure Sync | `degraded` — correcto: hay tenants activos sin credenciales cargadas |
| Producto | **Azure-only**, consolidado el 2026-07-30 (ver "Sesión 2026-07-30" abajo) |
| `terraform.yml` → `plan-apply` | **nunca corrió con éxito** (6/6 fallidas). No es sólo la credencial OIDC — hay 3 bloqueos encadenados, ver pendiente #1 |

## Pendientes, por urgencia

### 1. `plan-apply` de `terraform.yml`: tres bloqueos encadenados, no uno

Diagnosticado a fondo el 2026-07-30. El síntoma visible es el fallo de
`azure/login`, pero arreglar sólo eso **no** deja el job funcionando: hay tres
problemas en fila, y el tercero es el peligroso. El job **nunca corrió con
éxito** (6/6 ejecuciones fallidas).

**(a) Falta la credencial federada para `environment:dev`.**
`plan-apply` declara `environment: ${{ github.event.inputs.environment || 'dev' }}`.
En un `pull_request` no hay inputs, así que resuelve `dev` y el subject del token
OIDC pasa a ser `repo:manny864/finops:environment:dev`. El SP
`cscs-finops-terraform` (appId `3826973d-5d75-4039-bd31-b5ff9150f515`) tiene
exactamente tres credenciales federadas, verificadas con
`az ad app federated-credential list`:

| Nombre | Subject |
|---|---|
| `gh-env-prod` | `repo:manny864/finops:environment:prod` |
| `gh-pr` | `repo:manny864/finops:pull_request` |
| `gh-main` | `repo:manny864/finops:ref:refs/heads/main` |

Ninguna matchea → `AADSTS700213`.

**(b) `environments/dev/` no tiene `terraform.tfvars`.** Sólo está el
`.example`, y `infra/.gitignore` excluye `*.tfvars`, así que nunca va a estar en
el repo. Con la credencial resuelta, el paso
`terraform plan -var-file=terraform.tfvars` falla igual. Tampoco existe
`dev.tfstate` en el storage del estado: el ambiente dev **nunca se aplicó** (el
único blob del container `tfstate` es `prod/terraform.tfstate`).

**(c) ⚠️ La key del backend que usa el workflow NO es la del estado real.**
El workflow pasa `-backend-config="key=<env>.tfstate"` → `prod.tfstate`. El
estado real de producción vive en `prod/terraform.tfstate` (con barra), que es
lo que tiene configurado el `.terraform` local desde donde se aplicó siempre
(serial 80, 50 recursos). O sea: si se arregla (a) y se dispara `plan-apply`
sobre prod, `terraform init` levanta un **estado vacío** y el plan propone
**crear de cero los recursos que ya existen**. Un `apply` sobre ese plan es el
peor escenario de esta infra. **Arreglar (c) antes de habilitar el job**,
cualquiera sea el camino que se elija para (a).

#### Recomendación (la más barata, y la que además hace útil el plan del PR)

No crear ninguna credencial: hacer que en un PR el plan corra contra **prod**,
que es el único ambiente que existe y el que el PR va a cambiar de verdad. Son
dos líneas de `terraform.yml`, y el subject pasa a ser `environment:prod`, para
el que **ya hay credencial**:

```yaml
    environment: ${{ github.event.inputs.environment || 'prod' }}
    defaults:
      run:
        working-directory: infra/terraform/environments/${{ github.event.inputs.environment || 'prod' }}
```

más la key del backend corregida a
`key=${{ github.event.inputs.environment || 'prod' }}/terraform.tfstate`.

Es seguro porque el paso `Terraform apply` ya está condicionado a
`if: github.event_name == 'workflow_dispatch'`: en un PR el job sólo hace
`init` / `fmt` / `validate` / `plan` / Infracost, todo de lectura.

**Dato que conviene saber antes de decidir:** el comentario del workflow dice que
"el environment de GitHub es el que exige aprobación manual para prod", pero hoy
**eso no es cierto** — los dos environments (`dev` y `prod`) tienen
`protection_rules: []`. Si se quiere esa aprobación hay que configurarla en
Settings → Environments → prod → Required reviewers; declarar `environment:` sin
reglas no protege nada.

#### Si igual se quiere el carril `dev`

Hacen falta las tres cosas: la credencial, un `terraform.tfvars` de dev (local o
como secret) y aplicar dev una primera vez (~USD 40/mes). La credencial se crea
así — **no se ejecutó**: es un cambio de superficie de confianza de identidad y
es decisión del dueño del tenant.

**Por portal:** Entra ID → App registrations → `cscs-finops-terraform` →
Certificates & secrets → **Federated credentials** → Add credential →
*GitHub Actions deploying Azure resources* → Organization `manny864`,
Repository `finops`, Entity type **Environment**, Environment name `dev`,
nombre `gh-env-dev`.

**Por CLI:**
```bash
az ad app federated-credential create \
  --id 3826973d-5d75-4039-bd31-b5ff9150f515 \
  --parameters '{
    "name": "gh-env-dev",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:manny864/finops:environment:dev",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

**En GitHub no va nada nuevo.** Los tres secrets que usa `azure/login`
(`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`) ya existen y no
cambian. Una credencial federada **no es un secreto**: es una relación de
confianza que se declara del lado de Entra, y es justamente lo que evita tener un
client secret guardado en GitHub. Los secrets del repo hoy son 8 —los tres de
Azure, `TFSTATE_RG`, `TFSTATE_STORAGE`, y `SERVER_HOST`/`SERVER_USER`/`SSH_PRIVATE_KEY`
del VPS, que ya no usa ningún workflow automático y se pueden borrar cuando el
VPS deje de ser una salida de emergencia.

`scan` (el gate de Checkov) funciona bien en PRs y es independiente de todo esto.

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

### La key del estado remoto es `prod/terraform.tfstate`, con barra
El `.terraform` local de `environments/prod` apunta a
`key = "prod/terraform.tfstate"` en el storage `cscsfinopsmgmtqak5xmsa`
(RG `cscs-finops-mgmt-eastus2-rg`, container `tfstate`). El workflow
`terraform.yml` pasa `key=prod.tfstate`, **sin barra** — otra key, otro estado.
No confundirlas: usar la equivocada hace que Terraform crea que no hay nada
creado. Ver pendiente #1 (c).

### `errored.tfstate` en `environments/prod` es basura vieja, no lo apliques
Quedó del apply fallido del 2026-07-28 12:04 (serial 24, 52 recursos). El estado
remoto está muy por delante (serial 80, misma lineage `3cac334f`), así que ese
archivo está superado y se puede borrar. **Nunca** hacer
`terraform state push errored.tfstate`: retrocedería el estado 56 serials.
Está fuera de git (`infra/.gitignore` excluye `*.tfstate`), igual que
`terraform.tfvars` y `tfplan`.

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

## Sesión 2026-07-30 — consolidación Azure-only y puesta al día del README

El producto vuelve a ser **exclusivamente Azure** y la documentación quedó
alineada con la infraestructura que se desplegó el 07-28. Cuatro commits
granulares, mergeados a `main` por el PR #97 y desplegados.

**README.md** — era el pedido principal. Además de sacarle las 29 menciones al
segundo proveedor, estaba desactualizado en lo grande: describía el VPS con
crontab manual, no Container Apps.
- Sección nueva "Infraestructura y despliegue": planos de control/stamp,
  recursos del stamp, los 5 workflows y las trampas de este handoff (collation
  de MySQL, el `create` de Redis con HA, los dos bugs del provider en managed
  certificate + custom domain).
- Diagrama Mermaid y árbol de directorios regenerados — el árbol omitía 13
  subtrees de UI, ~25 de API y todo `infra/`.
- "Cron Jobs": el crontab del VPS reemplazado por la tabla real de Container
  Apps Jobs derivada de `cron_jobs`, aclarando que esos `cron` van en **GMT-3**
  (`cron_timezone_offset_hours = -3`) y no en UTC.
- Se corrigió la referencia colgada a `CAMBIOS_IMPLEMENTADOS.md`, que no existe
  en el repo.

**`AGENTS.md` / `CLAUDE.md`** — declaraban un agente multi-cloud y decían que
`main` despliega por SSH al VPS. Lo segundo era un riesgo real: un agente que
leyera esa directiva y disparara `deploy.yml` habría desplegado al VPS congelado
y corrido sus migraciones contra la base vieja. Corregido a `deploy-azure.yml`,
más el gate de `terraform.yml` documentado.

**Docs:** se eliminaron `provider-downgrade-policy.md` y
`finops-framework-coverage.md` — documentaban `provider = 'both'` y gaps por
proveedor, y `providerLifecycleService` ya es un shim de no-ops, así que
describían comportamiento que no ocurre. `marketplace-overview.md` reescrito
Azure-only (también afirmaba que la validación de JWT del webhook estaba
pendiente, y está implementada); `marketplace-integration.md`, `qa-checklist.md`,
`onboarding-wizard.md`, `data-residency.md`, `signup-trial-funnel.md`,
`focus-exporter.md`, `forecasting.md` y `vps-infra-improvement-plan.md`
corregidos.

**i18n:** 23 claves huérfanas eliminadas en los 3 idiomas (0 consumidores en el
código), paridad verificada en 4114 strings cada uno.

**Código:** se eliminó la rama muerta de proveedor — el atajo que preguntaba por
el proveedor secundario devolvía siempre `false`, así que en
`cost-projection/route.ts` la decisión de backfill tenía un solo camino real. Se sacaron también 29 factores de emisión de carbono
de regiones que ningún tenant puede tener, y 16 archivos de comentarios que
explicaban el comportamiento en términos del proveedor retirado.

**Se dejó a propósito:** el prompt del clasificador de IA y el mapper de FOCUS
nombran otras nubes porque la carga de CSV FOCUS acepta exports de terceros **por
diseño** — es un estándar abierto de la FinOps Foundation, no una integración.
Cambiar los ejemplos del prompt degradaría una clasificación que hoy funciona.
Ídem el tercer valor del enum `marketplace_source`: nada lo escribe, pero sacarlo
es DDL sobre una columna viva por un detalle cosmético.

**Verificación:** lint 0 errores, typecheck limpio, 592 tests en verde, build de
producción OK. CI verde en `staging`, PR #97 mergeado, deploy de 15m22s con todos
los pasos en verde (build ACR → migraciones → app → cron jobs → health check).
`/api/health` 200, `/es` 200, `/es/login` 200.

## Estado del repo

`main` y `staging` están al día y en el mismo commit (PR #97 mergeado el
2026-07-30). El árbol de trabajo quedó limpio. Lo único pendiente de decisión es
el pendiente #1 (el job `plan-apply`), que sigue rojo a propósito.
