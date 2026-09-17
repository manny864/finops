# Guía de despliegue

> **Si lo que vas a desplegar son los fixes de 429 (2026-09-16), empezá por
> [`runbook-pre-deploy-429.md`](./runbook-pre-deploy-429.md).** Son tres pasos
> manuales (secret `TF_VARS_PROD`, el apply que recrea el ingress, y el rol de
> Cost Management Reader sobre el management group del cliente) que hay que
> hacer **antes** y que ningún workflow puede automatizar.

## Prerrequisitos

- Azure CLI autenticado con permisos de Owner (o Contributor + User Access
  Administrator: hacen falta asignaciones RBAC para AcrPull y Key Vault).
- Terraform >= 1.8, provider azurerm ~> 4.0.
- El Key Vault existente del proyecto (credenciales por tenant + secretos de
  infra), su nombre y su resource group.

## 1. Estado remoto (una sola vez)

```bash
cd saas/infra/terraform/bootstrap
terraform init && terraform apply
terraform output backend_config   # copiar al pipeline / a los -backend-config
```

## 2. Ambiente

```bash
cd saas/infra/terraform/environments/prod
cp terraform.tfvars.example terraform.tfvars   # completar; NO commitear
terraform init \
  -backend-config="resource_group_name=<rg>" \
  -backend-config="storage_account_name=<sa>" \
  -backend-config="container_name=tfstate" \
  -backend-config="use_azuread_auth=true" \
  -backend-config="key=prod.tfstate"
terraform plan -var-file=terraform.tfvars -var-file=cron-jobs.tfvars -out tfplan
terraform apply tfplan
```

### Los dos var-file, y por qué el orden importa

`terraform.tfvars` está gitignored y en CI se materializa desde el secret
`TF_VARS_PROD`. Los horarios de los cron **no** viven ahí: viven en
`cron-jobs.tfvars`, que **sí está versionado en git**.

Terraform resuelve los `-var-file` en el orden de la línea de comando y, para
una misma variable, **gana el último**. Por eso `cron-jobs.tfvars` va siempre
**después**: si el secret todavía arrastra un bloque `cron_jobs` viejo, este lo
pisa entero (es reemplazo de la variable completa, no un merge por clave).

Consecuencias prácticas:

- Para cambiar un horario se edita `cron-jobs.tfvars` y se abre un PR. **Nunca**
  se toca el secret.
- No renombrar el archivo a `*.auto.tfvars`: los `auto.tfvars` se cargan *antes*
  que los `-var-file` de la línea de comando, con lo cual el secret volvería a
  ganar y el cambio no tendría efecto.
- Si se corre un `plan` a mano **sin** el segundo `-var-file`, se planifican los
  crons viejos del secret. Pasar siempre los dos.

Esto se hizo así después del incidente de 429 del 2026-09-16: `cron_jobs` estaba
duplicado (el ejemplo en git, el valor real dentro del secret), las dos copias
derivaron y cuatro prewarm terminaron compartiendo el minuto `:00`, saturando
Azure Cost Management. Ahora hay una sola fuente de verdad y `checks.tf` emite un
warning en cada plan si dos jobs horarios vuelven a compartir minuto.

### Lo que todavía hay que editar en el secret

`web_max_replicas` vive **dentro** de la variable `stamps`, y esa variable no se
puede pisar por partes (el override es por variable entera). El default
committeado en `variables.tf` ya es `3`, así que alcanza con **borrar**
`web_max_replicas` del stamp en `TF_VARS_PROD` para que tome el valor correcto;
si se prefiere dejarlo explícito, ponerlo en `3`.

No conviene subirlo: el limitador de concurrencia contra Cost Management
(`COST_MAX_CONCURRENT = 2` en `billingHelpers.ts`) es estado de módulo, o sea
**por proceso**. Cada réplica extra multiplica la concurrencia real contra una
API que ya throttlea con 2, así que escalar horizontalmente *empeora* los 429.
`checks.tf` avisa si algún stamp queda por encima de 3.

## 3. Permisos que Terraform NO puede dar

- **Federated credential de GitHub → Azure** (OIDC) para el App Registration
  del pipeline: crearla a mano o con `az ad app federated-credential create`.
- **Consentimiento de admin de los app roles de Graph** en cada tenant cliente:
  es del cliente, no de la suscripción.
- **Rol Global Reader al SP de collection** por tenant cliente para EXO
  (`scripts/onboarding/assign-collection-role.ps1`).
- **`Cost Management Reader` sobre el management group raíz del tenant cliente**.
  El script de onboarding lo intenta (paso 4), pero falla si quien lo ejecuta no
  es Owner ni User Access Administrator del MG; el fallo aparece en la tabla de
  `[FAIL]` del resumen. Es el permiso de mayor impacto en el rendimiento: con él
  el costo de todas las suscripciones sale en **una** consulta a Cost Management;
  sin él se degrada a una consulta por suscripción y Azure devuelve 429. Se
  verifica desde el panel (`/api/admin/check-sp-roles` →
  `summary.managementGroupCostAccess`) y se repara con:

  ```powershell
  New-AzRoleAssignment -ObjectId <spObjectId> `
    -RoleDefinitionName "Cost Management Reader" `
    -Scope "/providers/Microsoft.Management/managementGroups/<tenantId>"
  ```

  En tenants delegados por **Lighthouse** el MG nunca es utilizable; la
  plataforma lo detecta y va directo al fallback por suscripción sin gastar
  reintentos (`esTenantLighthouseConocido()` en `billingHelpers.ts`).

## 3.5 Un stamp por región

Todo lo de abajo aplica **por stamp**: cada región tiene su propia base, su
propio Key Vault y su propio job de migraciones. El pipeline de deploy corre
la matriz de stamps en paralelo.

```bash
terraform output migrate_jobs      # { us = { job = ..., resource_group = ... } }
terraform output stamp_hostnames   # el origin de cada stamp
terraform output stamp_outbound_ips
```

## 4. Migrar los datos desde el VPS

```bash
# en el VPS
docker exec <mysql> mysqldump -u root -p --single-transaction \
  --routines --triggers finops > finops.sql
# contra Azure
mysql -h <fqdn-de-terraform-output> -u finops_admin -p \
  --ssl-mode=REQUIRED finops < finops.sql
```

MySQL queda con VNet injection: **no es alcanzable desde internet**. Para el
restore, correrlo desde el Container App Job, desde una VM en la misma VNet, o
habilitar temporalmente el acceso público durante la carga.

Verificar counts de `Tenants`, `CostSnapshots`, `ActionLogs` y `Subscriptions`
contra el VPS antes de cortar. El detalle completo del corte está en
`migracion-desde-vps.md`.

## 5. Dominio

1. `custom_domain_name` en el tfvars y `terraform apply`.
2. Cloudflare: el registro en **DNS-only** hasta que se emita el certificado
   gestionado; después volver a **Proxied** con SSL *Full (strict)*.
3. Cargar los rangos de Cloudflare en `allowed_ip_ranges` y aplicar de nuevo:
   sin eso se puede pegar al origen salteando el WAF.
4. Registrar la nueva URL como redirect URI en la App Registration de login.
5. Actualizar la URL del webhook de Paddle (sandbox y live).

## Despliegue por etiquetas (blue/green)

El Container App corre en `revision_mode = "Multiple"` con dos etiquetas:

| Etiqueta | Qué es |
|---|---|
| `produccion` | La revisión que recibe el **100%** del tráfico |
| `testing` | La revisión recién desplegada, con **0%** de tráfico |

Flujo de un cambio:

1. **Push a `main`** → `deploy-azure.yml` corre las migraciones, crea la
   revisión nueva con la etiqueta `testing` y **cero tráfico**, y le hace el
   health check contra su propia URL. Producción no se entera.
2. **Revisión manual** en `https://<app>---testing.<region>.azurecontainerapps.io`
   (el workflow la imprime en el summary del run).
3. **OK** → ejecutar el workflow **Promover a producción** y escribir
   `promover`. Intercambia las etiquetas, actualiza los cron jobs a la imagen
   promovida y desactiva las revisiones viejas.

Los **cron jobs no se actualizan en el paso 1** a propósito: corren contra datos
de producción, así que siguen con la imagen aprobada hasta la promoción.

> **Migraciones:** corren ANTES del split, así que durante la ventana de
> revisión la revisión vieja está sirviendo contra el esquema nuevo. Toda
> migración tiene que ser compatible hacia atrás (agregar columnas, no
> renombrarlas ni borrarlas en el mismo deploy).

## Rollback

Ejecutar **Promover a producción** otra vez. Después de un swap, `testing`
apunta a la revisión que estaba en producción, así que promover de nuevo la
devuelve al 100%.

Para inspeccionar el estado:

```bash
RG=cscs-finops-prod-westus2-rg
APP=cscs-finops-prod-westus2-web
# Qué revisión tiene cada etiqueta y cuánto tráfico recibe
az containerapp show -g $RG -n $APP \
  --query "properties.configuration.ingress.traffic" -o table
az containerapp revision list -g $RG -n $APP -o table
```

Para mover el tráfico a mano (por ejemplo a una revisión sin etiqueta):

```bash
az containerapp revision label add -g $RG -n $APP \
  --revision <revision> --label produccion --yes
az containerapp ingress traffic set -g $RG -n $APP --label-weight produccion=100
```

Las migraciones **no** hacen rollback solas: si una migración rompe, el rollback
de imagen no alcanza.

## Credenciales para Terraform

**No hace falta crear un service principal con secreto.** Dos caminos, y
ninguno guarda una credencial en el repo ni en disco:

**CI/CD — OIDC federado** (es lo que usa el pipeline). Una sola vez:

```bash
az ad app create --display-name "cscs-finops-terraform"
# con el appId que devuelve:
az ad app federated-credential create --id <appId> --parameters '{
  "name": "github-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:<org>/<repo>:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'
az ad sp create --id <appId>
az role assignment create --assignee <appId> --role Contributor \
  --scope /subscriptions/<subId>
# imprescindible: sin esto fallan los role assignments de Key Vault, ACR y Storage
az role assignment create --assignee <appId> --role "User Access Administrator" \
  --scope /subscriptions/<subId>
```

En GitHub, `Settings -> Secrets and variables -> Actions`, sólo
**identificadores, ningún secreto**: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`AZURE_SUBSCRIPTION_ID`, `TFSTATE_RG`, `TFSTATE_STORAGE`, `INFRACOST_API_KEY`.

Hace falta una federated credential por cada contexto que dispare el workflow:
`ref:refs/heads/main`, `pull_request`, y `environment:prod` si se usan GitHub
Environments.

**Local — `az login` como usuario.** Terraform toma la sesión del CLI sola:

```bash
az login
az account set --subscription <subId>
```

Si por algún motivo hiciera falta un SP con secreto para correr local, **nunca**
va en `terraform.tfvars` (quedaría en el state y en el disco del repo). Va en un
archivo fuera del repo y se exporta:

```bash
# ~/.config/finops/azure.env  (chmod 600)
export ARM_CLIENT_ID=...
export ARM_CLIENT_SECRET=...
export ARM_TENANT_ID=...
export ARM_SUBSCRIPTION_ID=...
```

## Notas de seguridad

- Nada de secretos reales en `terraform.tfvars` (está en `.gitignore`).
- La app lee Paddle, Anthropic y el cert de EXO desde Key Vault con managed
  identity: no se declaran como variables de entorno.
- `mysql_admin_password` se deja **vacío**: Terraform genera una por stamp y la
  guarda en el Key Vault de ese stamp. No pasa por tfvars ni por el pipeline.
- Los diagnostic settings registran cada lectura de secreto del Key Vault. Es la
  primera evidencia que pide una auditoría y la única forma de investigar una
  credencial filtrada.
