# Guía de despliegue

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
terraform plan -out tfplan
terraform apply tfplan
```

## 3. Permisos que Terraform NO puede dar

- **Federated credential de GitHub → Azure** (OIDC) para el App Registration
  del pipeline: crearla a mano o con `az ad app federated-credential create`.
- **Consentimiento de admin de los app roles de Graph** en cada tenant cliente:
  es del cliente, no de la suscripción.
- **Rol Global Reader al SP de collection** por tenant cliente para EXO
  (`scripts/onboarding/assign-collection-role.ps1`).

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

## Rollback

```bash
RG=cscs-finops-prod-westus2-rg
APP=cscs-finops-prod-westus2-web
az containerapp revision list -g $RG -n $APP -o table
az containerapp revision activate -g $RG --revision <anterior>
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
