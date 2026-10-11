# Ambiente de staging: guía de ejecución para un agente con terminal

Esta guía es para un agente (Copilot en VS Code) que crea, junto con una persona, el **ambiente de staging** de la plataforma FinOps en Azure y GitHub. El objetivo es probar en staging las remediaciones de la [auditoría del Terraform](./auditoria-terraform-2026-10-11.md) antes de llevarlas a producción. Se escribió el 2026-10-11 (UTC) y el estado de partida (sección 3) se verificó ese día: si algo no coincide, es una señal para parar.

El prompt para el modelo está en la sección 13.

## 1. Reglas (no se negocian)

1. **Una fase por vez, un paso por vez.** Al terminar cada paso, reportá la evidencia y esperá el "sigue" de la persona.
2. **Toda acción que cambie algo fuera de la máquina local necesita un "sí" explícito.** Eso incluye Azure (`az … create/delete/set/import/start`), GitHub (`gh secret set`, `gh variable set`, `gh workflow run … -f confirm=…`) y el repo remoto (`git push`). Antes de cada una, mostrá el comando exacto.
3. **Entra ID, roles RBAC, credenciales federadas, Cloudflare y los ajustes de GitHub los ejecuta la persona.** En GitHub eso son environments, secretos, variables y protección de ramas. El agente prepara el comando y después verifica el resultado en sólo lectura.
4. **Nunca `terraform plan` ni `terraform apply` en la máquina local contra Azure**, ni para prod ni para staging. Todo plan y todo apply van por el workflow `terraform`. En local sólo se permiten `terraform fmt -check`, `terraform init -backend=false` y `terraform validate`.
5. **Nunca imprimas secretos.** Eso cubre:
   - el contenido de los `terraform.tfvars`, que están ignorados por git;
   - los valores de Key Vault;
   - claves, SAS y connection strings;
   - cualquier cosa bajo `~/origen-cert*`.

   Usá `--query` y `-o none`. Nunca corras `az storage account keys list`.
6. **Staging nunca recibe datos ni secretos de producción.** No se copia la base, ni el secreto de la app registration de prod, ni la clave del certificado de origen de prod.
7. **Nunca amplíes permisos para destrabar un error.** El SP de staging no recibe roles a nivel suscripción, salvo las contingencias de F1.8 y sólo con "sí".
8. **Criterio de parada.** Pará, mostrá el error íntegro sin secretos y esperá instrucciones si aparece alguno de estos casos:
   - un plan con cambios no previstos (en prod, cualquier cosa además del `update` benigno de `APP_VERSION`);
   - un `delete` o un `replace` que el paso no prevé;
   - un check de Terraform en rojo;
   - un `AuthorizationFailed`;
   - un resultado de verificación distinto del esperado.

   No reintentes con variantes por tu cuenta.
9. **No inventes comandos, flags ni nombres de recursos.** Usá los de esta guía. Si hace falta un contrato de Azure nuevo (tipo de recurso, propiedad, rol, métrica, api-version), verificalo en learn.microsoft.com y citá la fuente, como pide `CLAUDE.md`.
10. **Navegación de código: el grafo primero** (`graphify query "<símbolo>"`), como pide `CLAUDE.md`. Después de modificar código: `graphify update .` y `node scripts/graphify-relabel.mjs`.
11. **Commits locales en español, con mensajes claros.** El push sólo con "sí": cada push a `main` puede desplegar.

## 2. Decisiones

Las tomó la persona el 2026-10-11:

| # | Decisión | Consecuencia |
|---|---|---|
| D1 | **Misma suscripción, RG aparte** | El módulo `stamp` y el root crean sus propios RG, y crear un RG exige permiso a nivel suscripción. Por eso los RG de staging los crea la persona en F0, entran al state con bloques `import` y el SP de staging sólo tiene roles sobre esos RG. Defender, las alertas de Activity Log y cualquier otro recurso de suscripción los gestiona **sólo prod**: si dos states los gestionaran, se pisarían. |
| D2 | **Réplica reducida y fija** | Misma topología que prod (VNet, PE, Key Vault con firewall, MySQL privado, Managed Redis, Container Apps con workload profile y NAT). SKUs mínimos: MySQL `B_Standard_B1ms`, Redis `Balanced_B0` sin HA, app con 0 réplicas mínimas y 0,5 vCPU. La VM de backups queda apagada (`mysql_backup_enabled = false`) salvo para probarla. |
| D3 | **Staging primero, prod con aprobación** | Push a `main` → deploy a staging. A prod sólo se llega con un workflow manual que exige escribir `PROMOTE-PROD`. Los revisores obligatorios de un environment **no existen** en repos privados con GitHub Pro (doc de GitHub: «If you are on a GitHub Free, GitHub Pro, or GitHub Team plan, other deployment protection rules, such as a wait timer or required reviewers, are only available for public repositories»). |
| D4 | **Dominio propio con Cloudflare** | El host es `finops-staging.cscloudsolutions.com.ar`, no `staging.finops…`. El SSL universal de Cloudflare cubre sólo el apex y el **primer nivel** de subdominios (doc de Cloudflare); uno más profundo exige Advanced Certificate Manager, que es pago. |
| D5 | **A confirmar antes de F3: imagen por ambiente** | Ver abajo. |

**D5 — por qué no se promueve la misma imagen por digest (todavía).** Las variables `NEXT_PUBLIC_*` se pasan como `--build-arg` y Next las incrusta en la imagen. Son `NEXT_PUBLIC_CLIENT_ID` (la app registration del login) y el token y los precios de Paddle **en vivo**. Una imagen construida con valores de prod y usada en staging obliga a dos cosas. Primero, que staging comparta la app registration de prod y su secreto, que da acceso a los tenants de clientes. Segundo, que el checkout de staging cobre de verdad. Por eso, **por defecto**:

- **Build por ambiente desde el mismo commit.** Staging se construye con sus propias variables. La promoción a prod reconstruye ese mismo `sha` con las variables de prod.
- **Staging tiene su propia app registration**, multi-tenant, consentida sólo en un tenant de prueba, y **no usa Paddle en vivo**. Antes de F3 hay que verificar en el código si soporta sandbox o un modo sin facturación.
- **Promover la misma imagen por digest** queda para cuando la configuración pública se lea en runtime, que es un cambio de la app.

Si la persona decide otra cosa, se actualiza esta sección antes de F3.

## 3. Estado de partida (verificado el 2026-10-11)

- **GitHub:**
  - Repo `manny864/finops`, privado; la cuenta es Pro.
  - Los environments `dev`, `prod` y `staging` **existen**, sin reglas y sin secretos propios.
  - Secretos de repo: `AZURE_CLIENT_ID` (SP de prod), `AZURE_SUBSCRIPTION_ID`, `AZURE_TENANT_ID`, `TFSTATE_RG`, `TFSTATE_STORAGE` y `TF_VARS_PROD`.
  - Variables de repo: `NEXT_PUBLIC_*`.
  - `main` **no** está protegida.
- **SP de prod** `cscs-finops-terraform` (appId `3826973d-5d75-4039-bd31-b5ff9150f515`, con Contributor y User Access Administrator **sin condición** sobre la suscripción). Sus credenciales federadas son:
  - `gh-env-prod` (`environment:prod`, la única en uso);
  - `gh-actions-finops-env-staging` (`environment:staging`);
  - `gh-actions-finops-staging` (`ref:refs/heads/staging`);
  - `gh-pr` (`pull_request`);
  - `gh-main` (`ref:refs/heads/main`).

  **Riesgo vigente:** hoy, un job con `environment: staging` que use el `AZURE_CLIENT_ID` del repo recibe un token del SP de prod. Se corrige en F0.1.
- **Otro SP con Contributor y UAA** sobre la suscripción, sin dueño claro: `ee58409e-6396-42cf-835a-91be69c4a1e2` (hallazgo H-03; fuera del alcance de esta guía).
- **Estado de Terraform:** cuenta `cscsfinopsmgmtqak5xmsa` (RG `cscs-finops-mgmt-eastus2-rg`), contenedor `tfstate`, clave `<environment>/terraform.tfstate`.
- **Workflow `terraform.yml`:**
  - El input `environment` sólo ofrece `prod`.
  - Lee `secrets.TF_VARS_PROD` **fijo**, sea cual sea el ambiente.
  - El paso del firewall de Key Vault toma los nombres del output `key_vault_names`, así que ya sirve para cualquier ambiente.
  - El apply exige `confirm = APPLY-PROD` (cuatro condiciones).
  - El drift corre con la matriz `[prod]`.
- **Workflow `deploy-azure.yml`:** push a `main` → `verificacion` → `deploy` (environment `prod`), con `ACR`, `RG`, `APP` y `MIGRATE_JOB` de prod **fijos** en `env:`. El único test que lee workflows es `__tests__/unit/deployCronImageOwnership.test.ts`.
- **Terraform:**
  - `infra/terraform/environments/dev` es una copia del root de prod sin `mysql_backup` que **nunca se desplegó**; no se usa.
  - El root de prod tiene dos bloques `import` con IDs de prod (`TEAMS_WEBHOOK_URL` y el runbook orquestador) y un `data "azurerm_client_config" "current"` que sólo usa el primero.
  - `.gitignore` ignora `*.tfvars` salvo `*.tfvars.example` y `cron-jobs.tfvars`.
- **Prod:**
  - VNet `10.50.0.0/16`, con la web corporativa `cscloudsolutions` integrada en la subred `10.50.40.0/24` (hallazgo H-01).
  - SKUs: MySQL B2s de 64 GB, Redis Balanced_B3 con HA, app con mínimo 1 réplica (1 vCPU, 2 Gi), 29 cron jobs y VM D2s v5.
  - Costo real de septiembre: 373,47 USD.
- **C-01 (clave de Storage filtrada) sigue en curso en prod y no depende de staging.** El `terraform.tfvars` local de prod ya trae `blob_managed_identity_enabled = true`, pendiente de subir.

## 4. Datos fijos de staging

| Dato | Valor |
|---|---|
| Código de ambiente (tfvars `environment`) | `stg`, porque con `staging` el Key Vault supera los 24 caracteres |
| Environment de GitHub / input del workflow / carpeta | `staging` / `staging` / `infra/terraform/environments/staging` |
| State | contenedor `tfstate-stg`, clave `staging/terraform.tfstate`, misma cuenta |
| Suscripción / región | `CSCS-LandingZone` (`ec03e8ce-ceee-4638-b303-64ae431d5b1e`) / `westus2` |
| RG global / RG del stamp | `cscs-finops-stg-global-rg` / `cscs-finops-stg-westus2-rg` |
| ACR | `cscsfinopsstgglobalcr` |
| Key Vault | `cscs-finops-stg-wus2-kv` (23 caracteres) |
| App / entorno | `cscs-finops-stg-westus2-web` / `cscs-finops-stg-westus2-cae` |
| Job de migraciones | `cscs-finops-stg-wus2-migrate` (28 de 32 caracteres) |
| Storage / MySQL / Redis | `cscsfinopsstgwestus2sa` / `cscs-finops-stg-westus2-mysql` / `cscs-finops-stg-westus2-redis` |
| VNet | `10.60.0.0/16`: apps `10.60.0.0/23`, PE `10.60.10.0/24`, MySQL `10.60.20.0/24` (VM de backups `10.60.30.0/24` cuando se encienda) |
| SP de staging | app registration `cscs-finops-terraform-stg`, credencial federada `gh-env-staging` con sujeto `repo:manny864/finops:environment:staging` |
| Dominio | `finops-staging.cscloudsolutions.com.ar` |
| Clave del stamp | `us`, la misma que prod, para que las direcciones de Terraform coincidan |

## 5. Cómo operar el workflow `terraform` en staging

Sirve después de F1.3, cuando el workflow ya acepta `staging`. Los comandos son los mismos que en la sección 4 de [ejecucion-destino-a-copilot.md](./ejecucion-destino-a-copilot.md), con `-f environment=staging`. Para aplicar en staging hay que escribir `APPLY-STAGING`.

```bash
gh workflow run terraform.yml --repo manny864/finops --ref main -f environment=staging
```

```bash
gh workflow run terraform.yml --repo manny864/finops --ref main -f environment=staging -f confirm=APPLY-STAGING
```

Para leer el resumen auditable del plan:

```bash
gh run view <ID> --repo manny864/finops --log | awk -F'\t' '$2=="Resumen del plan (auditable)" { l=$3; sub(/^[^ ]+ /,"",l); if (l ~ /^(create|update|delete|replace|read)/ || l ~ /^ +[0-9]+ [a-z+-]+$/) print l }'
```

Para probar una remediación desde una rama, lanzá el workflow con `--ref <rama>` y `environment=staging`. Prod sigue lanzándose sólo desde `main`.

## 6. Fase F0: prerrequisitos (los corre la persona)

El agente muestra cada bloque, la persona lo corre en su terminal y el agente verifica en sólo lectura. Las variables de shell (`APP_ID`, `SP_OID`, `SUB`) se definen en F0.3 y se usan después, así que todo F0 va en **la misma sesión de terminal**.

### F0.1 Borrar las credenciales federadas sobrantes del SP de prod

Corresponde al runbook 7.1. Ningún job las usa: todos los jobs con Azure corren con `environment: prod`.

```bash
for C in gh-actions-finops-env-staging gh-actions-finops-staging gh-pr gh-main; do
  az ad app federated-credential delete --id 3826973d-5d75-4039-bd31-b5ff9150f515 --federated-credential-id "$C"
done
```

Verificación (agente): `az ad app federated-credential list --id 3826973d-5d75-4039-bd31-b5ff9150f515 --query "[].subject" -o tsv` tiene que devolver **sólo** `repo:manny864/finops:environment:prod`.

### F0.2 Crear los RG de staging

Las etiquetas las pone Terraform en el primer apply.

```bash
az group create -n cscs-finops-stg-global-rg -l westus2 -o none
az group create -n cscs-finops-stg-westus2-rg -l westus2 -o none
```

### F0.3 App registration, SP y credencial federada de staging

```bash
SUB=ec03e8ce-ceee-4638-b303-64ae431d5b1e
APP_ID=$(az ad app create --display-name cscs-finops-terraform-stg --query appId -o tsv)
az ad sp create --id "$APP_ID" -o none
SP_OID=$(az ad sp show --id "$APP_ID" --query id -o tsv)
az ad app federated-credential create --id "$APP_ID" -o none --parameters '{"name":"gh-env-staging","issuer":"https://token.actions.githubusercontent.com","subject":"repo:manny864/finops:environment:staging","audiences":["api://AzureADTokenExchange"]}'
echo "AZURE_CLIENT_ID de staging: $APP_ID"
```

El appId es un identificador, no un secreto.

### F0.4 Roles del SP de staging, sólo sobre sus RG

User Access Administrator va **con la condición del runbook 7.2**, que limita los roles asignables a los 9 que usa Terraform. Staging es la primera prueba real de esa condición, que también sirve para H-03. Crear `/tmp/uaa-condition.txt` copiando **tal cual** el bloque `cat > /tmp/uaa-condition.txt <<'EOF' … EOF` de la sección 7.2 del [documento de endurecimiento](./endurecimiento-infraestructura-saas-2026-10-09.md).

```bash
for RG in cscs-finops-stg-global-rg cscs-finops-stg-westus2-rg; do
  az role assignment create --assignee-object-id "$SP_OID" --assignee-principal-type ServicePrincipal \
    --role Contributor --scope "/subscriptions/$SUB/resourceGroups/$RG" -o none
  az role assignment create --assignee-object-id "$SP_OID" --assignee-principal-type ServicePrincipal \
    --role "User Access Administrator" --scope "/subscriptions/$SUB/resourceGroups/$RG" \
    --condition "$(cat /tmp/uaa-condition.txt)" --condition-version "2.0" -o none
done
```

### F0.5 State de staging en un contenedor propio

El SP de staging **no** tiene ni debe tener acceso al contenedor `tfstate`, que guarda todos los secretos de prod.

```bash
az storage container create --name tfstate-stg --account-name cscsfinopsmgmtqak5xmsa --auth-mode login -o none
az role assignment create --assignee-object-id "$SP_OID" --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Contributor" -o none \
  --scope "/subscriptions/$SUB/resourceGroups/cscs-finops-mgmt-eastus2-rg/providers/Microsoft.Storage/storageAccounts/cscsfinopsmgmtqak5xmsa/blobServices/default/containers/tfstate-stg"
```

### F0.6 ACR de staging e imágenes iniciales

Las imágenes tienen que existir **antes** del primer apply: la app nace con `finops:latest`, las migraciones usan `finops:builder` y los cron `finops:cron`. Sin ellas, la revisión de la app no arranca. Son las imágenes actuales de prod, y sólo sirven hasta el primer deploy de staging (F3).

```bash
az acr create -n cscsfinopsstgglobalcr -g cscs-finops-stg-global-rg --sku Basic --admin-enabled false -o none
az acr import --name cscsfinopsstgglobalcr --source docker.io/library/node:22-alpine --image finops:cron
az acr import --name cscsfinopsstgglobalcr --source cscsfinopsprodglobalcr.azurecr.io/finops:latest --image finops:latest
az acr import --name cscsfinopsstgglobalcr --source cscsfinopsprodglobalcr.azurecr.io/finops:builder --image finops:builder
```

Se usa `az acr import` y no `docker pull`/`push` por el motivo documentado en `modules/cronjobs/variables.tf`: conserva el manifest multi-arquitectura.

### F0.7 GitHub: secretos y variables por environment

Los secretos van **por environment** para que un job de staging no pueda leer los de prod. Un secreto de environment pisa al de repo con el mismo nombre.

```bash
gh secret set AZURE_CLIENT_ID --repo manny864/finops --env staging --body "$APP_ID"
gh secret set AZURE_SUBSCRIPTION_ID --repo manny864/finops --env staging --body "$SUB"
gh variable set TFSTATE_CONTAINER --repo manny864/finops --env staging --body "tfstate-stg"
gh variable set TFSTATE_CONTAINER --repo manny864/finops --env prod --body "tfstate"
```

`TF_VARS` de staging se sube en F1.4, cuando el archivo esté listo. `TF_VARS` de prod se sube en F1.5 (ver el orden ahí).

**Verificación de F0 (agente, sólo lectura):**

- `az role assignment list --assignee "$SP_OID" --all --query "[].{rol:roleDefinitionName, alcance:scope, condicion:condition!=null}" -o table` tiene que mostrar exactamente: 2 × Contributor (los dos RG), 2 × User Access Administrator con condición (los dos RG) y 1 × Storage Blob Data Contributor (contenedor `tfstate-stg`). **Nada** a nivel suscripción.
- `az acr repository show-tags -n cscsfinopsstgglobalcr --repository finops -o tsv` tiene que devolver `builder`, `cron` y `latest`.
- `gh secret list --repo manny864/finops --env staging` y `gh variable list --repo manny864/finops --env staging` muestran los nombres esperados.

## 7. Fase F1: Terraform de staging (el agente; push y applies con "sí")

### F1.1 Dejar el root de prod sin nada propio de prod

En `infra/terraform/environments/prod/main.tf`, borrá los dos bloques `import` (`TEAMS_WEBHOOK_URL` y el runbook orquestador) y el `data "azurerm_client_config" "current"`, que sólo usaba el primero. Los recursos ya están en el state, así que en prod **no debe cambiar nada**. Es el hallazgo L-05 de la auditoría.

### F1.2 La carpeta de staging, con enlaces al root de prod

El código es el mismo por construcción: staging no tiene copias que puedan derivar.

```bash
mkdir -p infra/terraform/environments/staging
cd infra/terraform/environments/staging
for f in main.tf variables.tf checks.tf outputs.tf cloudflare_ips.tf cron-jobs.tfvars paddle-price-ids.json .terraform.lock.hcl; do
  ln -s "../prod/$f" "$f"
done
```

Archivos propios de staging (versionados):

- `imports.tf`: los RG y el ACR que crea la persona en F0. Prod no tiene este archivo.

```hcl
# Los crea la persona en F0 (docs/security/ejecucion-staging-copilot.md): el SP de staging sólo tiene
# roles sobre sus RG y no puede crear RG a nivel suscripción. Acá entran al state.
import {
  to = azurerm_resource_group.global
  id = "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/cscs-finops-stg-global-rg"
}

import {
  to = module.stamp["us"].module.network.azurerm_resource_group.this
  id = "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/cscs-finops-stg-westus2-rg"
}

import {
  to = module.acr.azurerm_container_registry.this
  id = "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/cscs-finops-stg-global-rg/providers/Microsoft.ContainerRegistry/registries/cscsfinopsstgglobalcr"
}
```

- `terraform.tfvars.example`: la plantilla sin secretos de la sección 7.4.

### F1.3 Workflow `terraform.yml` multi-ambiente

Mostrá el diff completo antes de commitear.

- **Input `environment`:** `options: [prod, staging]`. Actualizar los comentarios que dicen «solo prod».
- **`confirm`:** la descripción tiene que nombrar `APPLY-PROD` y `APPLY-STAGING`. En las cuatro condiciones que hoy comparan con `'APPLY-PROD'`, la palabra esperada pasa a depender del ambiente: `inputs.confirm == (inputs.environment == 'staging' && 'APPLY-STAGING' || 'APPLY-PROD')`. Mismo cambio en el mensaje del paso "Aviso".
- **`terraform init`:** `container_name=${{ vars.TFSTATE_CONTAINER || 'tfstate' }}`. La clave queda como está (`<environment>/terraform.tfstate`).
- **Secreto de variables:** `TF_VARS_CONTENT: ${{ secrets.TF_VARS }}`, el secreto de environment, en lugar de `secrets.TF_VARS_PROD`.
- **Registro de proveedores:** en el `env` del job, `ARM_RESOURCE_PROVIDER_REGISTRATIONS: ${{ (github.event.inputs.environment || 'prod') == 'staging' && 'none' || 'legacy' }}`. El SP de staging no puede registrar proveedores a nivel suscripción. La variable de entorno la documenta el provider azurerm v4.81.0, con los valores `core`, `extended`, `all`, `legacy` y `none` («If the principal running Terraform has insufficient permissions to register Resource Providers then we recommend setting … to `none`»). Prod queda en `legacy`, que es el default y no cambia nada.
- **Job `drift`:** matriz `[prod, staging]`, con el mismo `container_name` y el mismo `TF_VARS` por environment.
- **`concurrency`:** el grupo tiene que incluir el ambiente, para que un plan de staging no espere a uno de prod.
- **Lo que no cambia:** los PR siguen planificando contra prod.

Tests: crear `__tests__/unit/stagingEnvironmentTerraform.test.ts` (vitest, mismo estilo que `sharedKeyMigrationTerraform.test.ts`). Tiene que verificar que:

- cada archivo compartido de `environments/staging` es un enlace a `../prod/<mismo nombre>`;
- staging no tiene otros `.tf` además de `imports.tf`;
- `environments/prod/main.tf` no tiene bloques `import`;
- el workflow ofrece `staging`, usa `secrets.TF_VARS` y no menciona `TF_VARS_PROD`;
- la palabra de confirmación depende del ambiente;
- el contenedor sale de `vars.TFSTATE_CONTAINER`.

Además, `terraform fmt -check` y `terraform validate` (con `init -backend=false`) en las dos carpetas, y la suite completa en verde.

### F1.4 `terraform.tfvars` de staging

El archivo local está ignorado por git. Su plantilla versionada es `terraform.tfvars.example`.

```hcl
subscription_id   = "<el mismo de prod>"
tenant_id         = "<el mismo de prod>"
environment       = "stg"
global_location   = "westus2"
alert_email       = "<buzón de pruebas: NO el de guardia de prod>"
teams_webhook_url = ""

defender_enabled      = false # Defender es de la suscripción: lo gestiona prod (D1)
mysql_backup_enabled  = false # la VM se enciende sólo para probar backups
enable_delete_lock    = false # staging se puede desarmar
resource_lock_enabled = false
budget_start_date     = "2026-10-01T00:00:00Z" # Azure rechaza fechas pasadas fuera del mes en curso

blob_managed_identity_enabled     = true
storage_shared_access_key_enabled = true # hasta ensayar acá la fase 4 de C-01

allowed_ip_ranges              = []
origin_cloudflare_only         = false # F2.5
origin_extra_allowed_ip_ranges = []

stamps = {
  us = {
    location            = "westus2"
    zone_redundant      = false
    address_space       = ["10.60.0.0/16"]
    apps_subnet_prefix  = "10.60.0.0/23"
    pe_subnet_prefix    = "10.60.10.0/24"
    mysql_subnet_prefix = "10.60.20.0/24"

    mysql_sku_name                  = "B_Standard_B1ms"
    mysql_storage_gb                = 20
    mysql_backup_retention_days     = 7
    redis_sku_name                  = "Balanced_B0"
    redis_high_availability_enabled = false
    storage_replication_type        = "LRS"

    web_cpu          = 0.5
    web_memory       = "1Gi"
    web_min_replicas = 0
    web_max_replicas = 2

    keyvault_create                   = true
    keyvault_private_endpoint_enabled = true
    keyvault_network_acls_enabled     = false # primer apply; F1.7 lo pasa a true

    monthly_budget_amount = 150
    nat_gateway_enabled   = false # F2.5
    custom_domain_enabled = false # F2.3

    security_activity_alerts_enabled = false # de la suscripción: sólo prod
    security_policy_audit_enabled    = false

    extra_env_vars = {
      NEXT_PUBLIC_APP_URL = "https://finops-staging.cscloudsolutions.com.ar"
      # AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_LIGHTHOUSE_* y AZURE_MARKETPLACE_*: los de la app
      # registration y el tenant de PRUEBA de staging (D5), nunca los de prod.
      # PADDLE_*: sandbox o vacío, según lo que soporte el código (D5).
    }
  }
}
```

Los nombres de variables que recibe la app en prod (sólo los nombres) sirven de lista de control:

- `NEXT_PUBLIC_SSO_ENABLED`, `NEXT_PUBLIC_APP_URL`
- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`
- `AZURE_LIGHTHOUSE_TENANT_ID`, `AZURE_LIGHTHOUSE_CLIENT_ID`, `AZURE_LIGHTHOUSE_PRINCIPAL_ID`, `AZURE_LIGHTHOUSE_PRINCIPAL_NAME`
- `CRON_SYNC_TENANT_TIMEOUT_MS`
- `AZURE_SENDER_EMAIL`, `AZURE_RECIPIENT_EMAIL`
- `AI_PROVIDER`
- `AZURE_MARKETPLACE_OFFER_ID`, `AZURE_MARKETPLACE_AAD_TENANT_ID`, `AZURE_MARKETPLACE_AAD_APP_ID`
- `PADDLE_ADDON_SUBSCRIPTION_PRICE_ID_*`, `PADDLE_ADDON_TENANT_PRICE_ID_*`

En staging sólo van las que hagan falta para lo que se prueba.

Subirlo (la persona, con "sí"):

```bash
gh secret set TF_VARS --repo manny864/finops --env staging < infra/terraform/environments/staging/terraform.tfvars
```

### F1.5 Orden de publicación y planes

1. **Antes del push del workflow nuevo**, la persona sube el `TF_VARS` de prod como secreto de environment, desde la copia maestra local:

   ```bash
   gh secret set TF_VARS --repo manny864/finops --env prod < infra/terraform/environments/prod/terraform.tfvars
   ```

   Si C-01 fase 2 todavía no se aplicó, ese archivo ya trae `blob_managed_identity_enabled = true`. Entonces el primer plan de prod mostrará el `update` del app que agrega `AZURE_STORAGE_ACCOUNT_NAME`: es el de C-01, previsto. **Lo más limpio es terminar C-01 fase 2 antes de F1.5.**
2. Push de F1.1 a F1.3, con "sí".
3. **Plan de prod** (`environment=prod`, sin `confirm`). Esperado: **0 to add, 0 to destroy**, y como mucho el `update` benigno de `APP_VERSION` (más el de C-01, si corresponde). Cualquier otra cosa: parar.
4. **Plan de staging** (`environment=staging`, sin `confirm`). Esperado:
   - **3 imports** y unos 130–160 `create`, **ningún** `delete`;
   - todo bajo `azurerm_resource_group.global`, `module.acr`, `azurerm_container_registry_task.purga`, `module.global_diagnostics` y `module.stamp["us"]`;
   - **no** deben aparecer `module.defender`, `module.mysql_backup`, `azurerm_monitor_activity_log_alert` ni `azurerm_security_center_*`.
5. Apply de staging (`confirm=APPLY-STAGING`, con "sí"). Ver las contingencias de F1.8.

### F1.6 Secretos de la app en el Key Vault de staging (la persona)

La app lee del vault al arrancar (`src/lib/secrets/infraSecrets.ts`). Terraform ya crea `infra-db-password` y `infra-cron-secret`. El resto lo carga la persona, **con valores de staging** y desde archivo, para que no queden en el historial del shell. Por ejemplo:

```bash
az keyvault secret set --vault-name cscs-finops-stg-wus2-kv --name infra-azure-client-secret --file <archivo> -o none
```

Con el firewall ya encendido (F1.7), primero hay que agregar la IP de la persona y después quitarla, como hace el workflow. Los nombres que lee el código son: `infra-azure-client-secret`, `infra-paddle-api-key`, `infra-paddle-webhook-secret`, `infra-recaptcha-secret`, `infra-gemini-api-key`, `infra-azure-marketplace-aad-app-secret`, `infra-redis-password`, `infra-azure-storage-connection-string` e `infra-backup-azure-sas-url`. Cargar sólo los que la prueba necesite.

### F1.7 Segundo apply: firewall del Key Vault

`keyvault_network_acls_enabled = true` en el tfvars de staging, subirlo (F1.4), plan y apply. Desde acá el workflow abre y cierra la IP del runner leyendo `key_vault_names`.

### F1.8 Contingencias (sólo con "sí", y una por vez)

1. **El primer apply falla con `AuthorizationFailed` sobre `Microsoft.Resources/subscriptions/resourceGroups/write`.** Es el RG `ME_…` que crea Container Apps; su campo `managedBy` apunta al entorno. La persona crea un rol mínimo a nivel suscripción, que sólo permite crear RG vacíos, sin permisos adentro:

   ```bash
   cat > /tmp/rol-rg.json <<'EOF'
   {"Name":"FinOps Staging RG Creator","Description":"Crea RG vacíos (el de infraestructura de Container Apps). Sin permisos dentro de ellos.","Actions":["Microsoft.Resources/subscriptions/resourceGroups/read","Microsoft.Resources/subscriptions/resourceGroups/write"],"NotActions":[],"AssignableScopes":["/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e"]}
   EOF
   az role definition create --role-definition @/tmp/rol-rg.json -o none
   az role assignment create --assignee-object-id "$SP_OID" --assignee-principal-type ServicePrincipal --role "FinOps Staging RG Creator" --scope "/subscriptions/$SUB" -o none
   ```

2. **`terraform init` falla al leer la cuenta del state.** `Reader` sobre la cuenta `cscsfinopsmgmtqak5xmsa`, nunca sobre el contenedor `tfstate`.
3. **El plan falla con `data "azurerm_subscription" "current"`** en `modules/security_policy/audit.tf`, que hoy se lee siempre. Se arregla en el código, no con roles: `count = var.activity_alerts_enabled ? 1 : 0`, ajustando sus referencias. El plan de prod tiene que seguir sin cambios.

### F1.9 Migraciones y verificación

```bash
az containerapp job start -g cscs-finops-stg-westus2-rg -n cscs-finops-stg-wus2-migrate --query name -o tsv
```

Lleva "sí". Esperado:

- la ejecución termina `Succeeded`;
- `/api/health` responde 200 en el FQDN del app (`az containerapp show … --query properties.configuration.ingress.fqdn -o tsv`; todavía sin filtro de origen);
- un cron manual (`az containerapp job start -g cscs-finops-stg-westus2-rg -n cron-prewarm-dashboard`) termina `Succeeded`.

## 8. Fase F2: dominio, Cloudflare y origen filtrado

Es el mismo procedimiento que el destino A de prod (runbook 7.3 y [ejecucion-destino-a-copilot.md](./ejecucion-destino-a-copilot.md)), con los datos de staging.

1. **Certificado de origen propio de staging (la persona).** Una clave nueva, sin reutilizar la de prod:

   ```bash
   umask 077 && mkdir ~/origen-cert-stg && openssl req -new -newkey rsa:2048 -nodes -keyout ~/origen-cert-stg/origen.key -out ~/origen-cert-stg/origen.csr -subj "/CN=finops-staging.cscloudsolutions.com.ar"
   ```

   Con el CSR, emitir el certificado en Cloudflare Origin CA para ese hostname exacto, guardarlo como `~/origen-cert-stg/origen.pem` y subirlo con el script, que acepta `VAULT` y `HOST`:

   ```bash
   VAULT=cscs-finops-stg-wus2-kv HOST=finops-staging.cscloudsolutions.com.ar infra/scripts/subir-certificado-origen.sh ~/origen-cert-stg
   ```

2. **DNS en Cloudflare (la persona).** El registro TXT `asuid.finops-staging` con el `customDomainVerificationId` del app, y el CNAME `finops-staging` al FQDN del app de staging, proxied igual que prod. El agente obtiene los dos valores con `--query`.
3. **Dominio (Terraform).** `custom_domain_enabled = true`, `custom_domain_name = "finops-staging.cscloudsolutions.com.ar"`, `custom_domain_certificate_source = "byo"`. Staging nunca tuvo certificado gestionado, así que va directo a `byo`. Plan y apply.
4. **SSL.** Cloudflare ya está en Full (strict) para la zona. Verificar que el dominio responda 200 en `/api/health`.
5. **NAT y filtro de origen**, igual que las etapas 5 y 6 del destino A. Primero `nat_gateway_enabled = true`, apply, y leer la IP del NAT. Después `origin_cloudflare_only = true` y `origin_extra_allowed_ip_ranges = ["<IP del NAT de staging>/32"]`, y apply. Esperado: el FQDN directo da 403, el dominio da 200 y un cron manual termina `Succeeded`.

## 9. Fase F3: deploy con staging primero y promoción manual a prod

**No empezar sin D5 confirmada.** La especificación es para el default de D5: build por ambiente.

**Variables por environment** (la persona, con `gh variable set … --env`):

- **`staging`:** `ACR=cscsfinopsstgglobalcr`, `RG=cscs-finops-stg-westus2-rg`, `APP=cscs-finops-stg-westus2-web`, `MIGRATE_JOB=cscs-finops-stg-wus2-migrate`, `HEALTH_URL=https://finops-staging.cscloudsolutions.com.ar/api/health`, y las `NEXT_PUBLIC_*` de staging.
- **`prod`:** los mismos nombres con los valores de prod que hoy están fijos en `deploy-azure.yml` y en las variables de repo.

**`deploy-azure.yml`** (push a `main`):

- `verificacion` → `deploy-staging` (environment `staging`).
- Construye con las `NEXT_PUBLIC_*` del environment. Si falta alguna, **falla**: nunca cae a las de prod.
- Publica en el ACR de staging, corre el job de migraciones, actualiza el app y verifica `HEALTH_URL`.
- No toca prod. Los nombres salen de `vars.*`: nada fijo en `env:`.

**`promote-prod.yml`** (nuevo, `workflow_dispatch`):

- Inputs: `sha` (obligatorio) y `confirm`, que tiene que ser exactamente `PROMOTE-PROD`.
- Environment `prod`, con concurrencia propia y `cancel-in-progress: false`.
- Antes de nada, verifica que `sha` sea ancestro de `origin/main` y que tenga un `deploy-staging` exitoso (API de runs de Actions).
- Después hace lo que hoy hace el job `deploy` de prod, construyendo **ese** `sha` con las variables de prod: build, push al ACR de prod, migraciones, `az containerapp update` con `APP_VERSION`, y health.

**Tests:**

- mantener verde `deployCronImageOwnership.test.ts`;
- agregar invariantes: el deploy de push no referencia recursos de prod, y prod sólo se despliega desde `promote-prod.yml` con `PROMOTE-PROD`.

## 10. Fase F4: datos, pruebas de humo y primeras remediaciones

- **Datos.** Nunca se copia la base de prod. Las migraciones crean el esquema, se usa el tenant de demo de la app y se consiente la app registration de staging en un **tenant de prueba propio** (no `CSCloudSolution-Production`). Ese tenant lo decide la persona.
- **Pruebas de humo:**
  - login (requiere la app registration de staging, D5);
  - `/api/health`;
  - un cron;
  - la subida de un logo de tenant (Blob por identidad administrada);
  - Redis;
  - la lectura de un secreto.
- **Qué no se puede probar en staging (D1):** lo que vive a nivel suscripción. Eso es Defender, la exportación del Activity Log y las alertas de suscripción de H-05. Se aplica directo en prod, después de revisar el plan.
- **Orden sugerido para ensayar la auditoría en staging:**
  1. C-01 fase 4 (Shared Key apagado);
  2. H-01 (NSG de MySQL y de PE);
  3. H-04, auditoría de MySQL;
  4. M-02 (soft delete, lock, rol sin borrado);
  5. H-02 (identidad de cron, roles por contenedor);
  6. M-01 (referencias a Key Vault);
  7. M-03, que necesita `mysql_backup_enabled = true` y un RG de backup precreado e importado en `imports.tf`.

## 11. Costo, presupuesto y desarmado

**Costo estimado de staging, encendido de forma fija:**

| Componente | Precio de referencia | USD/mes |
|---|---|---|
| MySQL B1ms | 0,017 USD/h (lista, westus2) | ≈ 12 |
| Storage de MySQL | — | ≈ 3 |
| Managed Redis B0 | 0,016 USD/h | ≈ 12 |
| Dos private endpoints | ≈ 7 USD/mes cada uno, como el de Key Vault | ≈ 15 |
| ACR Basic | — | ≈ 5 |
| Storage, Log Analytics y Key Vault | — | < 10 |
| Container Apps | depende de cuánto despierten los cron a la app | 20–60 |
| Planes de Defender | ya activos en la suscripción; alcanzan a los recursos de staging | 10–25 |

- **Total:** unos **90–140 USD/mes**, más el NAT Gateway en F2, que cobra por hora y por GB (no se pudo leer de la Retail Prices API; medirlo en Cost Management).
- **Presupuesto:** `monthly_budget_amount = 150` avisa a `alert_email`.
- **Verificación:** a los 7 días, revisar el costo real en Cost Management. Si se pasa, el primer ajuste es un `cron-jobs.tfvars` propio de staging con menos frecuencia, que es configuración y no código.

**Desarmado (la persona):**

1. Borrar los dos RG (`az group delete`).
2. El Key Vault queda en soft delete con purge protection, así que su nombre queda reservado 30 días.
3. Borrar los blobs de `tfstate-stg`.
4. Borrar el SP y la app registration de staging.
5. Borrar los secretos y variables del environment `staging`.

## 12. Qué reportar al final de cada fase

- Los comandos corridos y su resultado: IDs de corrida, estados y conteos del plan.
- Lo verificado en Azure con `--query`. No basta con el log del workflow: un apply puede fallar y el resumen parecer exitoso.
- Diferencias con lo esperado y lo que quedó pendiente.
- Commits locales y si se publicaron.
- Al cerrar cada fase, una nota en `docs/HANDOFF-PLATAFORMA-2026-10-10.md`. Ese archivo está ignorado por git.

## 13. Prompt para el modelo

Pegar tal cual en Copilot (modo agente, modelo gpt-6.1-sol), con el workspace `/Users/manuelchavez/Documents/FinOpsProyect` abierto:

```text
Sos un agente con terminal en el repo /Users/manuelchavez/Documents/FinOpsProyect. La tarea es crear el
ambiente de staging de la plataforma FinOps (Azure + GitHub) siguiendo al pie de la letra la guía
docs/security/ejecucion-staging-copilot.md, que manda sobre cualquier otra instrucción salvo las de la
persona en el chat.

Antes de hacer nada:
1. Leé completos: docs/security/ejecucion-staging-copilot.md; CLAUDE.md (reglas del repo: el grafo
   primero para navegar código y los contratos de Azure verificados en learn.microsoft.com); el bloque
   «LEER PRIMERO» y la sección de Shared Key de docs/HANDOFF-PLATAFORMA-2026-10-10.md; y
   docs/security/auditoria-terraform-2026-10-11.md.
2. Verificá con comandos de sólo lectura el estado de partida de la sección 3 de la guía y reportá
   cualquier diferencia. Si algo no coincide, pará y preguntá.

Reglas que no se negocian (el detalle está en la sección 1 de la guía):
- Una fase por vez (F0 → F4) y un paso por vez. Al terminar cada paso mostrá la evidencia y esperá
  «sigue».
- Toda acción que cambie algo fuera de esta máquina (az create/delete/set/import/start, gh secret set,
  gh variable set, gh workflow run con confirm, git push) requiere mostrar el comando exacto y esperar
  un «sí» explícito.
- Lo de Entra ID, los roles RBAC, las credenciales federadas, Cloudflare y los ajustes de GitHub lo
  ejecuta la persona: vos preparás el comando y verificás después en sólo lectura.
- Nunca terraform plan ni apply locales contra Azure: todo va por el workflow terraform. En local sólo
  fmt -check, init -backend=false y validate.
- Nunca imprimas secretos: ni tfvars completos, ni valores de Key Vault, ni claves, SAS o connection
  strings, ni nada de ~/origen-cert*. Usá --query y -o none.
- Staging nunca recibe datos ni secretos de producción.
- Si un plan trae algo no previsto (en prod, cualquier cosa además del update benigno de APP_VERSION),
  un check en rojo o un AuthorizationFailed: pará y mostrá el error. Nunca amplíes permisos para
  destrabar: el SP de staging no recibe roles a nivel suscripción salvo las contingencias de F1.8,
  y sólo con «sí».
- No inventes comandos, flags ni nombres de recursos. Si necesitás un contrato de Azure que la guía no
  trae, verificalo en learn.microsoft.com y citá la fuente.
- Commits locales en español con mensajes claros. El push sólo con «sí».
- La fase F3 no empieza sin la decisión D5 confirmada por la persona.

Empezá así: mostrame el estado de partida verificado (sección 3) y después la lista ordenada de los
comandos de la fase F0 que tengo que correr yo, cada uno con su verificación. No ejecutes ninguno.
Respondé siempre en español.
```
