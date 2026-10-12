# Auditoría de seguridad del Terraform de FinOps (Azure), 2026-10-11

**Alcance.** Todos los `.tf` versionados (7.354 líneas): `environments/prod` (desplegado), `bootstrap` (backend de estado) y los 23 módulos. `environments/dev` no está desplegado (no tiene tfvars): hereda los módulos y no se reporta aparte.

**Método.** Lectura completa del código, medición de sólo lectura en Azure (az CLI y Log Analytics, sin imprimir secretos) y verificación de cada argumento propuesto contra el esquema del provider instalado (azurerm 4.81.0, random 3.9.0), la documentación de esa versión del provider y learn.microsoft.com. **No se aplicó nada.** Lo ya decidido o cerrado (destino A, Front Door eliminado, certificado propio, migración de Shared Key en curso) sólo aparece donde todavía queda riesgo abierto. Cada hallazgo indica si es **nuevo** o si ya estaba en [endurecimiento-infraestructura-saas-2026-10-09.md](./endurecimiento-infraestructura-saas-2026-10-09.md).

**Corrección que afecta al incidente de GitGuardian.** El workspace de Log Analytics retiene 30 días (`retentionInDays = 30`, igual que las tablas `StorageBlobLogs` y `AzureDiagnostics`). Que los registros de Storage "empiecen el 11-sep" es el borde de la retención, no la fecha en que se activaron. No hay evidencia de quién usó la clave antes del 11-sep. GitGuardian la volvió a validar hoy a las 07:43Z.

---

## Hallazgos

### C-01. [CRITICIDAD: Crítica] Clave de cuenta de Storage filtrada y vigente, con Shared Key habilitado y endpoint público sin firewall

- **Archivo y Recurso:** `modules/storage/main.tf` → `azurerm_storage_account.this` (`public_network_access_enabled = true`, `shared_access_key_enabled = var.shared_access_key_enabled`, sin `network_rules`); `environments/prod/variables.tf` → `storage_shared_access_key_enabled` (default `true`); `modules/stamp/main.tf` → `local.app_secrets["storage-connection-string"]`; `modules/mysql_backup/main.tf` → `data.azurerm_storage_account_blob_container_sas.backups`. Conocido (P1 Storage).
- **Riesgo:** con la clave, cualquiera en internet lee, sobrescribe o borra todo `cscsfinopsprodwestus2sa`. Eso incluye `db-backups` (dumps completos de la base, con datos de todos los tenants), los adjuntos de soporte, los logos y las exportaciones de costos. Medido: `allowSharedKeyAccess = true`, firewall `Allow`, sin private endpoint. GitGuardian la detectó y la sigue validando. Hoy ya no la usan el worker de backups (publicado con OAuth a las 13:48Z) ni Terraform (`storage_use_azuread`). Sólo la usa la app, hasta que se aplique la fase 2.
- **Control / Norma:** ASB v3 IM-8, IM-1 y NS-2. CIS Azure Foundations (Storage): regenerar periódicamente las claves de acceso y dejar en Deny el acceso de red por defecto. Azure Policy integrada «Storage accounts should prevent shared key access», que ya está en la lista de auditoría del repo.
- **Remediación en Código:**

```hcl
# TF_VARS_PROD (el tfvars local ya está preparado). Paso 1: la app pasa a identidad administrada.
blob_managed_identity_enabled = true

# Paso 3: con al menos 24 h de StorageBlobLogs sin AccountKey ni SAS de clientes propios.
storage_shared_access_key_enabled = false
```

```bash
# Paso 2, apenas la app entre con OAuth (sin esperar a la fase 5). Invalida la clave filtrada.
# "-o none" porque el comando imprime las claves nuevas por defecto.
az storage account keys renew -g cscs-finops-prod-westus2-rg -n cscsfinopsprodwestus2sa --key key1 -o none
az storage account keys renew -g cscs-finops-prod-westus2-rg -n cscsfinopsprodwestus2sa --key key2 -o none
```

```diff
 # modules/stamp/main.tf, paso 4 (limpieza, fase 5 del runbook 7.6)
   app_secrets = {
     db-password                   = random_password.mysql.result
     redis-password                = module.redis.primary_access_key
-    storage-connection-string     = module.storage.primary_connection_string
     appinsights-connection-string = module.monitoring.appinsights_connection_string
   }
   app_secret_env = {
     DB_PASSWORD                           = "db-password"
     REDIS_PASSWORD                        = "redis-password"
-    AZURE_STORAGE_CONNECTION_STRING       = "storage-connection-string"
     APPLICATIONINSIGHTS_CONNECTION_STRING = "appinsights-connection-string"
   }
```

- **Documentación de la Mejora:** la rotación se adelanta respecto del plan original (estaba en la fase 5) porque, desde las 13:48Z, ningún cliente propio usa la clave salvo la app hasta su apply. Lo que se rompe al rotar no está en uso: la connection string inline y la SAS de `STORAGE_SAS_TOKEN`. Por eso un rollback del worker a SAS necesitaría antes un apply que regenere la SAS. Apagar Shared Key es un update en sitio, reversible con el flag. Las validaciones de GitGuardian van a empezar a fallar, como corresponde, y quien navegue blobs desde el portal va a necesitar un rol de datos. Para la investigación, ver H-05 (retención).

> **Estado de C-01 (2026-10-12): fase 4 ensayada en staging y plan de prod revisado; pendiente el «sí» para aplicar.**
> - **Migrados los tres clientes propios.** Desde el apply de la fase 2 (11-oct 23:54Z) hasta las 13:32Z de hoy **ningún pedido de Blob usó clave ni SAS**: Terraform, AzCopy (el worker, que pasó su ciclo programado) y la app entran con `OAuth`. La app lo demostró a las 12:41Z (`GetBlobProperties` 200, `GetBlob` 206 y `CreateContainer` 409 sobre `tenant-logos`); su último uso con `AccountKey` fue el 10-oct a las 14:47Z. Se midieron 13 horas y no las 24 de la guía; lo compensa el inventario de 30 días de logs (sin ningún cliente mensual escondido) y que el ciclo de vida de las 02:38Z ya corrió en ese lapso.
> - **Ensayo en staging** (`storage_shared_access_key_enabled = false`): plan con un solo atributo cambiado (`shared_access_key_enabled = true -> false`), apply `0 added, 1 changed, 0 destroyed`. Negativas: la clave de cuenta recibe `Key based authentication is not permitted on this storage account` y una SAS firmada con ella recibe `HTTP 403 KeyBasedAuthenticationNotPermitted`. Positivas: la app de staging responde (el primer pedido fue un arranque en frío de 7,6 s), no hay errores de Storage en su consola y un plan posterior da `79 no-op` con Terraform leyendo la cuenta con OAuth (`GetBlobServiceProperties` 200).
> - **Plan de prod** (run 38256003455): `0 add, 2 change, 0 destroy`: la cuenta de Storage (un solo atributo, `shared_access_key_enabled`) y el `APP_VERSION` benigno. `TF_VARS_PROD` ya trae la variable de nivel raíz (subido 13:29Z).
> - **No se pudo ensayar:** el ciclo de vida de Azure (`xAzure`, `TrustedAccessSas`): la doc no documenta ninguna dependencia de la clave de cuenta y staging no tiene filas suyas. Se verifica en prod en la corrida de las 02:38Z del día siguiente (sin `xAzure` con 403); el rollback es `storage_shared_access_key_enabled = true`.
> - **Efectos esperados:** las validaciones de GitGuardian van a empezar a fallar (es lo que se busca) y quien explore blobs por el portal necesita un rol de datos.

### H-01. [CRITICIDAD: Alta] La web corporativa está conectada a la VNet de producción de FinOps y ninguna subred del stamp tiene NSG

- **Archivo y Recurso:** `modules/network/main.tf` → `azurerm_subnet.apps`, `azurerm_subnet.private_endpoint` (`private_endpoint_network_policies = "Disabled"`) y `azurerm_subnet.mysql`; el módulo no declara ningún NSG. Fuera de Terraform: la subred `cscs-webpage-snet-appservice` (`10.50.40.0/24`), dentro de `cscs-finops-prod-westus2-vnet`, con la integración de VNet del App Service `cscloudsolutions` (RG `cscs-webpage-wus2-prod`). **Nuevo.**
- **Riesgo:** la web pública de la empresa (otro proyecto, expuesto a internet) sale a la red privada de FinOps. Desde ahí llega a MySQL (3306, con un usuario administrador), al private endpoint de Redis (10000) y a los de Key Vault. Si comprometen el sitio, eso se convierte en movimiento lateral hacia los datos de todos los tenants, y la única barrera que queda es la autenticación de cada servicio. La VM de backups también llega a todos los private endpoints, sin necesitarlo. Medido: cero NSG en las tres subredes del stamp y en la de la web.
- **Control / Norma:** ASB v3 NS-1 y NS-2. CIS (Networking): subredes asociadas a un NSG. Azure Policy «Subnets should be associated with a Network Security Group».
- **Remediación en Código:**

```bash
# (a) En el proyecto de la web, no en este repo: sacar su integración de esta VNet y borrar la subred.
az webapp vnet-integration remove -g cscs-webpage-wus2-prod -n cscloudsolutions
```

```hcl
# (b) modules/network/main.tf. Variable nueva: backup_vm_subnet_prefix (viene de mysql_backup_vm_subnet_prefix).
resource "azurerm_subnet" "private_endpoint" {
  # ...
  private_endpoint_network_policies = "NetworkSecurityGroupEnabled" # con "Disabled" el NSG no se aplica a los PE
}

resource "azurerm_network_security_group" "mysql" {
  name                = "${var.name_base}-nsg-mysql"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = var.tags

  security_rule {
    name                       = "AllowMySqlFromAppsAndBackup"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3306"
    source_address_prefixes    = [var.apps_subnet_prefix, var.backup_vm_subnet_prefix]
    destination_address_prefix = var.mysql_subnet_prefix
  }

  security_rule {
    name                       = "AllowMySqlSubnetInternal"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = var.mysql_subnet_prefix
    destination_address_prefix = var.mysql_subnet_prefix
  }

  security_rule {
    name                       = "DenyRestOfVnetInbound"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "VirtualNetwork"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "mysql" {
  subnet_id                 = azurerm_subnet.mysql.id
  network_security_group_id = azurerm_network_security_group.mysql.id
}

resource "azurerm_network_security_group" "private_endpoint" {
  name                = "${var.name_base}-nsg-pe"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = var.tags

  security_rule {
    name                       = "AllowAppsToPrivateEndpoints"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_ranges    = ["443", "10000"] # Key Vault / AI, y Managed Redis (puerto medido: 10000)
    source_address_prefix      = var.apps_subnet_prefix
    destination_address_prefix = var.pe_subnet_prefix
  }

  security_rule {
    name                       = "DenyRestOfVnetInbound"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "VirtualNetwork"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "private_endpoint" {
  subnet_id                 = azurerm_subnet.private_endpoint.id
  network_security_group_id = azurerm_network_security_group.private_endpoint.id
}
```

- **Documentación de la Mejora:** (a) no toca a FinOps, pero antes conviene confirmar que la web no use nada de esta VNet. (b) Asociar un NSG a subredes delegadas y cambiar la política de PE son updates en sitio, sin recrear nada. En cambio, una regla mal escrita corta MySQL o Redis al instante. Por eso va en una ventana: probar antes con `az network watcher test-ip-flow` y después revisar `/api/health` y un cron manual. Si se hace M-05 (PE de blob), hay que sumar el 443 desde la subred de la VM. La subred de apps queda para una segunda etapa, porque Container Apps exige reglas propias.

### H-02. [CRITICIDAD: Alta] Una sola identidad para web, cron y migraciones, con permisos sobre toda la cuenta de Storage y todo el Key Vault

- **Archivo y Recurso:** `modules/stamp/main.tf` → `azurerm_user_assigned_identity.app`, usada por `module.app`, `module.cronjobs` (`identity_id`) y `azurerm_container_app_job.migrate`. `modules/storage/main.tf` → `azurerm_role_assignment.app_blob_contributor` (alcance: toda la cuenta). `modules/keyvault/main.tf` → `azurerm_role_assignment.app_secrets_user` (`Key Vault Secrets Officer` sobre todo el vault). Conocido en parte (separar identidades); **nuevo** que el rol de Storage alcanza a los backups.
- **Riesgo:** esa identidad lee y borra `db-backups` (dumps de la base completa) y puede leer, escribir o borrar `tenant-<id>-client-secret` de todos los clientes, o sea, acceso cross-tenant a sus APIs de facturación. Un RCE en el contenedor de un cron (imagen `node:22-alpine`, distinta de la app) o un SSRF en la web alcanza para obtener el token de la identidad. Los cron sólo necesitan `AcrPull` y leer `infra-cron-secret`.
- **Control / Norma:** ASB v3 PA-7 e IM-3. Guía de RBAC de Key Vault de Microsoft: un vault por aplicación y ambiente.
- **Remediación en Código:**

```hcl
# modules/stamp/main.tf: identidad propia para los cron.
resource "azurerm_user_assigned_identity" "cron" {
  name                = "${local.name_base}-cron-id"
  location            = var.location
  resource_group_name = module.network.resource_group_name
  tags                = var.tags
}

resource "azurerm_role_assignment" "cron_acr_pull" {
  scope                = var.acr_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.cron.principal_id
}

# El RBAC de Key Vault admite alcance de un solo secreto.
resource "azurerm_role_assignment" "cron_secret_reader" {
  scope                = "${module.keyvault.id}/secrets/${var.cron_secret_name}"
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.cron.principal_id
}

resource "time_sleep" "cron_rbac_propagation" {
  depends_on      = [azurerm_role_assignment.cron_acr_pull, azurerm_role_assignment.cron_secret_reader]
  create_duration = "90s"
}

module "cronjobs" {
  # ...
  identity_id = azurerm_user_assigned_identity.cron.id
  depends_on  = [time_sleep.cron_rbac_propagation]
}
```

```hcl
# modules/storage/main.tf: rol por contenedor; los dos que la app creó en runtime pasan a estar declarados.
locals {
  app_containers = toset(["support-attachments", "tenant-logos", "finops-cost-exports", "user-avatars", "cms-media"])
}

resource "azurerm_storage_container" "app" {
  for_each              = local.app_containers
  name                  = each.key
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}

resource "azurerm_role_assignment" "app_blob_contributor_container" {
  for_each             = local.app_containers
  scope                = "${azurerm_storage_account.this.id}/blobServices/default/containers/${each.key}"
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = var.app_principal_id
  depends_on           = [azurerm_storage_container.app]
}
```

```hcl
# environments/prod/main.tf: los dos contenedores ya existen en Azure.
import {
  for_each = toset(["user-avatars", "cms-media"])
  to       = module.stamp["us"].module.storage.azurerm_storage_container.app[each.key]
  id       = "/subscriptions/${data.azurerm_client_config.current.subscription_id}/resourceGroups/cscs-finops-prod-westus2-rg/providers/Microsoft.Storage/storageAccounts/cscsfinopsprodwestus2sa/blobServices/default/containers/${each.key}"
}
```

- **Documentación de la Mejora:** va en dos applies. (1) Crear la identidad del cron, sus roles y los roles por contenedor, sin borrar nada. (2) Pasar los jobs a la identidad nueva y quitar `azurerm_role_assignment.app_blob_contributor`. Ese segundo apply incluye un delete, y el validador del workflow deja pasar uno solo por apply, mediante el input `replace`. La app llama a `createIfNotExists()` (`src/lib/azureBlobStorage.ts:71`). Con rol por contenedor eso funciona para los contenedores que ya existen; uno nuevo hay que declararlo antes. Después del cambio la app deja de ver `db-backups`, que es lo buscado. El paso de diseño siguiente es partir el vault en dos: infra (sólo lectura para la app) y credenciales de tenants (con Officer).

### H-03. [CRITICIDAD: Alta] Dos service principals con Contributor y User Access Administrator sin condición sobre la suscripción

- **Archivo y Recurso:** fuera del Terraform de los stamps. Son asignaciones sobre `/subscriptions/ec03e8ce-…` para los principales `ee58409e-…` y `3826973d-…`, ambos con `Contributor` y `User Access Administrator`, sin `condition`. Relacionados: `bootstrap/main.tf` (`var.terraform_sp_object_id`) y `.github/workflows/terraform.yml` (OIDC). Conocido (P0 «OIDC y planes», runbooks 7.1 y 7.2).
- **Riesgo:** con User Access Administrator sin condición, el principal puede darse `Owner` o `Key Vault Secrets Officer` y así leer las credenciales de todos los tenants. Cualquier camino que consiga un token de esos principales escala a dueño de una suscripción que además aloja otros proyectos: una credencial federada sobrante, un workflow comprometido o el secreto de un principal en desuso. El segundo SP no tiene dueño claro.
- **Control / Norma:** ASB v3 PA-1, PA-2 y PA-7. CIS (Identity): limitar los administradores. Microsoft, «Delegate Azure role assignment management using conditions».
- **Remediación en Código:**

```hcl
# En el código que gestione los permisos del pipeline (por ejemplo bootstrap/main.tf).
resource "azurerm_role_assignment" "pipeline_uaa_condicionado" {
  scope                = "/subscriptions/${var.subscription_id}"
  role_definition_name = "User Access Administrator"
  principal_id         = var.terraform_sp_object_id
  condition_version    = "2.0"
  # El texto exacto de la condición «Constrain roles», con los 9 GUID verificados, está en el
  # runbook 7.2 del doc de endurecimiento. Sumar el GUID de cada rol custom nuevo (M-02 y M-03).
  condition = file("${path.module}/uaa-condition.txt")
}
```

```bash
# Identificar cuál de los dos NO es el del pipeline y quitarle los roles, con aprobación previa.
az ad sp show --id 3826973d-5d75-4039-bd31-b5ff9150f515 --query "{app:appId, nombre:displayName}" -o table
az ad sp show --id ee58409e-6396-42cf-835a-91be69c4a1e2 --query "{app:appId, nombre:displayName}" -o table
```

- **Documentación de la Mejora:** la asignación condicionada se crea **antes** de borrar la vieja; si no, el pipeline puede quedarse sin permiso de asignar roles a mitad de un apply. Con la condición puesta, un apply que asigne un rol fuera de la lista falla en Azure, no en el plan, así que la lista hay que mantenerla al día. El Owner humano y los `Key Vault Administrator`/`Secrets Officer` humanos permanentes deberían pasar a elegibles con PIM (requiere Entra ID P2).

### H-04. [CRITICIDAD: Alta] La app, los cron, las migraciones y el backup usan el administrador de MySQL, sin auditoría ni Entra ID

- **Archivo y Recurso:** `modules/stamp/main.tf` → `local.app_env` (`DB_USER = var.mysql_admin_login`) y `local.app_secrets["db-password"]`. `modules/mysql/main.tf` → `azurerm_mysql_flexible_server.this`, sin `identity` ni `azurerm_mysql_flexible_server_active_directory_administrator`; el único parámetro gestionado es `require_secure_transport`. `environments/prod/main.tf` → `module.mysql_backup` (`mysql_admin_password`). Conocido el usuario (P1 «Identidades y usuario MySQL»); **nueva** la auditoría apagada.
- **Riesgo:** una inyección SQL o un RCE en la web o en un cron obtiene privilegios de administrador: DDL, DCL, `GRANT` y lectura de todos los tenants. Encima, no queda registro de conexiones administrativas, DDL ni cambios de permisos. La VM de backups guarda la misma contraseña en una variable de Automation. Medido: `audit_log_enabled = OFF`, `audit_log_events = CONNECTION`, cero administradores de Entra. Está bien: TLS 1.2/1.3, `require_secure_transport = ON` y red privada.
- **Control / Norma:** ASB v3 PA-7, IM-1 y LT-3. CIS (Database Services, MySQL flexible): `audit_log_enabled` en ON y `audit_log_events` con CONNECTION.
- **Remediación en Código:**

```hcl
# modules/mysql/main.tf, inmediato. Los valores salen de allowedValues en Azure; ambos parámetros son dinámicos (no reinician).
resource "azurerm_mysql_flexible_server_configuration" "audit_log_enabled" {
  name                = "audit_log_enabled"
  resource_group_name = var.resource_group_name
  server_name         = azurerm_mysql_flexible_server.this.name
  value               = "ON"
}

resource "azurerm_mysql_flexible_server_configuration" "audit_log_events" {
  name                = "audit_log_events"
  resource_group_name = var.resource_group_name
  server_name         = azurerm_mysql_flexible_server.this.name
  value               = "CONNECTION_V2,DDL,DCL"
  depends_on          = [azurerm_mysql_flexible_server_configuration.audit_log_enabled]
}
```

> **Corrección del 2026-10-12, tras leer la doc de Microsoft (`concepts-audit-logs`) y ensayarlo en staging:** la propuesta original usaba `CONNECTION` y `ADMIN`. `CONNECTION` **no** registra los intentos de conexión fallidos; `CONNECTION_V2` sí, con su código de error (la señal contra fuerza bruta). `ADMIN` incluye `SHOW STATUS` y mete mucho ruido con poco valor de seguridad. Quedó `CONNECTION_V2,DDL,DCL`, detrás de un interruptor apagado por defecto (`mysql_audit_log_enabled` en `stamps`): ver `modules/mysql` y `__tests__/unit/mysqlAuditTerraform.test.ts`.

```sql
-- Usuario de backup, fuera de Terraform. Su contraseña va a Key Vault y a MYSQL_PASS de Automation.
-- mysqldump necesita SELECT, SHOW VIEW y TRIGGER. Con --single-transaction no pide LOCK TABLES
-- y con --no-tablespaces no pide PROCESS. Para --routines, validar el privilegio con un dump de prueba.
CREATE USER 'finops_backup'@'%' IDENTIFIED BY '<desde Key Vault>' REQUIRE SSL;
GRANT SELECT, SHOW VIEW, TRIGGER ON finops.* TO 'finops_backup'@'%';
```

- **Documentación de la Mejora:** la auditoría aumenta la ingesta de Log Analytics, porque el diagnóstico `allLogs` ya envía `MySqlAuditLogs`; hay que mirar el tope diario (L-04). El usuario de backup exige agregar `--no-tablespaces` al worker y volver a publicarlo, con el mismo procedimiento de hoy. Un usuario de app con sólo DML sigue bloqueado por el DDL en runtime (P1); mientras tanto, el administrador debería quedar sólo para el job `migrate`. Entra ID para MySQL (servidor con identidad y `azurerm_mysql_flexible_server_active_directory_administrator`) necesita permisos de Graph para esa identidad: hay que verificarlos en learn antes de diseñarlo.

> **Estado de H-04 (auditoría de MySQL): ACTIVADA EN PROD el 2026-10-12 a las 11:23Z** (run 38242195971, `2 added, 1 changed, 0 destroyed`; plan revisado: sólo los dos parámetros y el `APP_VERSION` benigno). Verificado en Azure: `audit_log_enabled = ON`, `audit_log_events = CONNECTION_V2,DDL,DCL`, servidor `Ready` sin reinicio, app sana, y los primeros 12 registros llegaron a `AzureDiagnostics` en 5 minutos (conexiones de las dos réplicas, subred de apps, y un DDL). **Todas las conexiones son de `finops_admin`**: con datos reales queda a la vista el hallazgo de usuario único. Pendiente: medir el volumen a las 24 horas (agendado) y la regla de alerta de fuerza bruta. Ensayada antes en staging.
> El interruptor es `mysql_audit_log_mode` en `stamps` (`unmanaged` por defecto, `on`, `off`): prod no cambia hasta decidirlo.
> Resultado medido en staging (workspace de Log Analytics, tabla `AzureDiagnostics`, categoría `MySqlAuditLogs`):
> - llegan `connection_log` `CONNECT`/`DISCONNECT` con usuario, IP de origen y `status_d` (0 = éxito), y `general_log` con los DDL (por ejemplo `CREATE TABLE IF NOT EXISTS SchemaMigrations`, el DDL en runtime que ya figuraba como pendiente);
> - **un login fallido real** (usuario inexistente, error 1045) aparece como `connection_log` `CONNECT` con `status_d = 1045`, que es lo que `CONNECTION_V2` agrega y `CONNECTION` no registra;
> - la latencia de ingesta es de 3 a 5 minutos, y las primeras filas pueden llegar vacías porque Log Analytics crea las columnas al recibir datos;
> - el rollback está ensayado: `off` es **un update** (`0 added, 1 changed, 0 destroyed`, parámetro en `OFF`, sin reinicio). Con un booleano, apagar habría borrado dos recursos y el validador del apply, que sólo perdona un `delete`, lo habría bloqueado.
>
> Detección de fuerza bruta (consulta lista para una regla de alerta):
>
> ```kusto
> AzureDiagnostics
> | where Category == "MySqlAuditLogs" and event_class_s == "connection_log" and event_subclass_s == "CONNECT"
> | where status_d != 0
> | summarize intentos = count(), usuarios = dcount(user_s) by ip_s, bin(TimeGenerated, 5m)
> | where intentos >= 5
> ```
>
> Volumen en prod, estimado con las métricas del servidor (7 días): 460 conexiones nuevas (unas 66 por día) y 0 abortadas, o sea del orden de 130 eventos de conexión por día; el DDL en runtime se mide en las primeras 24 horas. El tope diario del workspace es 1 GB y el máximo medido es 0,115 GB/día.
>
> Receta que se siguió en prod (cada paso con su «sí»): (1) agregar `mysql_audit_log_mode = "on"` al stamp `us` de `terraform.tfvars` y subir `TF_VARS_PROD`; (2) plan de CI: tienen que salir exactamente 2 `create` (`audit_log_enabled[0]` y `audit_log_events[0]`) más el `APP_VERSION` benigno; (3) apply con `APPLY-PROD`; (4) comprobar los dos parámetros en Azure y las filas en `AzureDiagnostics`; (5) mirar el volumen a las 24 horas. Rollback: `mysql_audit_log_mode = "off"`.

### H-05. [CRITICIDAD: Alta] Detección: Activity Log sin exportar, alertas y Policy apagadas, retención de 30 días

- **Archivo y Recurso:** no existe un `azurerm_monitor_diagnostic_setting` de suscripción. `modules/security_policy/audit.tf` → `azurerm_monitor_activity_log_alert.audit` y `azurerm_resource_group_policy_assignment.audit`, ambos apagados porque `security_activity_alerts_enabled` y `security_policy_audit_enabled` valen `false` por defecto en `environments/prod/variables.tf`. `modules/monitoring/main.tf` → `azurerm_log_analytics_workspace.this` (en tfvars, `log_retention_days = 30` y `log_daily_quota_gb = 1`). Conocidas las alertas y Policy apagadas; **nuevos** el Activity Log sin exportar y el efecto de la retención.
- **Riesgo:** una asignación de Owner, el borrado de un lock o de la base no le avisa a nadie, y el evento sólo queda 90 días en el Activity Log nativo. Investigar qué secretos se leyeron o qué blobs se descargaron tiene un horizonte de 30 días, y eso ya afectó al incidente de GitGuardian. Medido: `AzureActivity` con 0 filas en 7 días, una sola alerta de Activity Log (Service Health), ninguna asignación de Policy en el RG, y retención de 30 días en `StorageBlobLogs`, `AzureDiagnostics` (Key Vault y MySQL) y la consola de las apps.
- **Control / Norma:** ASB v3 LT-3, LT-5 y LT-6. CIS (Logging and Monitoring): diagnostic setting del Activity Log con las categorías adecuadas, y alertas de Activity Log para operaciones críticas.
- **Remediación en Código:**

```hcl
# environments/prod/main.tf: el Activity Log, al workspace del stamp por defecto. Categorías verificadas en la doc del esquema.
resource "azurerm_monitor_diagnostic_setting" "activity_log" {
  name                       = "${local.global_name_base}-activity-log"
  target_resource_id         = "/subscriptions/${data.azurerm_client_config.current.subscription_id}"
  log_analytics_workspace_id = module.stamp[var.default_stamp].workspace_id

  enabled_log {
    category = "Administrative"
  }
  enabled_log {
    category = "Security"
  }
  enabled_log {
    category = "Policy"
  }
  enabled_log {
    category = "Alert"
  }
}
```

```hcl
# modules/monitoring/main.tf: retención por tabla para lo que sirve en una investigación.
resource "azurerm_log_analytics_workspace_table" "seguridad" {
  for_each                = toset(["StorageBlobLogs", "AzureDiagnostics", "AzureActivity"])
  workspace_id            = azurerm_log_analytics_workspace.this.id
  name                    = each.key
  retention_in_days       = 90
  total_retention_in_days = 365
}
```

```hcl
# TF_VARS_PROD, dentro de stamps.us
security_activity_alerts_enabled = true
security_policy_audit_enabled    = true
```

```hcl
# modules/security_policy/audit.tf: operaciones que hoy no avisan (nombres verificados con `az provider operation show`).
    vm-run-command    = "Microsoft.Compute/virtualMachines/runCommand/action"
    runbook-publish   = "Microsoft.Automation/automationAccounts/runbooks/publish/action"
    nsg-rule-write    = "Microsoft.Network/networkSecurityGroups/securityRules/write"
    storage-key-regen = "Microsoft.Storage/storageAccounts/regeneratekey/action"
```

- **Documentación de la Mejora:** no se recrea nada. La retención de más de 31 días se cobra por GB-mes; con la ingesta medida (0,115 GB/día como máximo) el costo es marginal. `runCommand` y `publish` van a sonar en operaciones legítimas (pruebas de humo, publicación del worker): es lo esperado y pasa poco. `listKeys` queda afuera a propósito, porque el provider lo llama en cada plan y la alerta sería ruido. Las Policy quedan en modo auditoría (`enforce = false`): no bloquean nada.

> **Estado de H-05 (detección): ACTIVADA EN PROD el 2026-10-12 a las 12:21Z** (run 38248480035, `25 added, 1 changed, 0 destroyed`; plan revisado). Verificado en Azure, recurso por recurso: las tres tablas en retención 90/365; la exportación del Activity Log de la suscripción con sus 4 categorías hacia el workspace de prod; las 11 alertas habilitadas; las 10 políticas en `DoNotEnforce`; app sana y health 200. **Circuito de alertas probado de punta a punta:** un lock de prueba creado y borrado en un RG de staging disparó `audit-lock-delete` (Sev4, `Fired` a las 12:35:05Z, unos 7 minutos después del evento de las 12:27:32Z), y una segunda prueba disparó otra a las 12:55:06Z. **Exportación a Log Analytics: parcial, dentro de lo documentado.** Llegaron los eventos `Alert` (latencia de 2 minutos) y la escritura de la propia configuración; los `Administrative` y `Policy` todavía no. La doc de Azure Monitor dice que tras crear la configuración los datos pueden tardar hasta 90 minutos en empezar a fluir y que sólo si pasan 24 horas sin nada hay que deshabilitarla y volver a habilitarla; hay una comprobación agendada para después de esa ventana. Ensayado antes en staging (lo que no es de la suscripción).
> Todo viene apagado por defecto (interruptores en `stamps`): `security_activity_log_export_enabled`, `security_activity_alerts_enabled`, `security_policy_audit_enabled`, `security_tables_retention_days` y `security_tables_total_retention_days`.
> - **Ensayado en staging** (lo que no vive a nivel suscripción): 3 tablas con retención 90/365 (`AzureDiagnostics`, `AzureActivity`, `StorageBlobLogs`) y las 10 asignaciones de Policy en `DoNotEnforce` (sólo miden). El apply dio `13 added, 0 destroyed`. **La auditoría de Policy ya marca un incumplimiento real: `Storage: sin Shared Key`** (la cuenta de staging tiene la clave habilitada, igual que prod: es C-01).
> - **Rollback de la retención ensayado:** igualar la total a la interactiva (90/90) es un `update` (`0 added, 3 changed, 0 destroyed`, verificado en Azure). Borrar los tres recursos devuelve la retención del workspace pero son tres `delete` y el validador del apply sólo perdona uno.
> - **No se puede ensayar en staging** (son de la suscripción y el SP de staging no tiene permisos a ese nivel, por diseño): la exportación del Activity Log y las 11 alertas. Se revisan en el plan de prod. El rollback de la exportación es un solo `delete` (apagar el flag), que el validador sí deja pasar con el input `replace`.
> - **Plan de prod aplicado** (run 38247123095 el plan, 38248480035 el apply): `25 add, 1 change, 0 destroy`: 3 tablas, 11 alertas de Activity Log (las 7 originales y 4 nuevas: `vm-run-command`, `runbook-publish`, `nsg-rule-write`, `storage-key-regen`), la exportación del Activity Log (`Administrative`, `Security`, `Policy`, `Alert`), 10 políticas en auditoría, y el `APP_VERSION` benigno.
> - **Ruido esperable en el buzón de alertas:** las alertas son de toda la suscripción, así que suenan con cualquier asignación de rol, incluidas las de los applies de staging, y `storage-key-regen` va a sonar cuando se rote la clave filtrada (C-01).

### H-06. [CRITICIDAD: Alta] El backend de estado guarda todos los secretos y está abierto, sin auditoría ni protección de borrado

- **Archivo y Recurso:** `bootstrap/main.tf` → `azurerm_storage_account.tfstate` (sin `network_rules`, sin `container_delete_retention_policy`, sin lock ni diagnóstico); `azurerm_role_assignment.tfstate_blob_operator` con `grant_bootstrap_operator_access` (default `true`). Conocido en parte; **nuevos** el contenedor sin soft delete, el lock y la auditoría faltantes, y los tres humanos con escritura.
- **Riesgo:** el state guarda en claro la contraseña de administrador de MySQL, la clave de Redis, las claves y la connection string de Storage, la SAS, la contraseña de la VM y la URL firmada de la Logic App. Hay tres cuentas humanas con escritura permanente: el compromiso de cualquiera de ellas entrega todos los secretos, y la lectura no deja rastro. Además, borrar el contenedor `tfstate` es irrecuperable, porque el soft delete de blobs no cubre el borrado del contenedor. Medido en `cscsfinopsmgmtqak5xmsa`: Shared Key apagada y versionado (bien); red pública con `defaultAction = Allow`; `containerDeleteRetentionPolicy` deshabilitada; 0 locks; 0 diagnósticos del servicio blob; `Storage Blob Data Contributor` directo para 3 usuarios y 1 SP; replicación LRS.
- **Control / Norma:** ASB v3 IM-8, NS-2, LT-3, PA-7 y BR-2.
- **Remediación en Código:**

```bash
# El bootstrap se corrió una vez con backend local: se aplica por CLI y se refleja en el código.
az storage account blob-service-properties update -g cscs-finops-mgmt-eastus2-rg --account-name cscsfinopsmgmtqak5xmsa \
  --enable-container-delete-retention true --container-delete-retention-days 30
az lock create --name tfstate-no-borrar --lock-type CanNotDelete -g cscs-finops-mgmt-eastus2-rg \
  --resource-name cscsfinopsmgmtqak5xmsa --resource-type Microsoft.Storage/storageAccounts
az monitor diagnostic-settings create --name tfstate-blob-auditoria \
  --resource "<id de la cuenta>/blobServices/default" --workspace "<id del workspace de prod>" \
  --logs '[{"categoryGroup":"allLogs","enabled":true}]'
```

```hcl
# bootstrap/main.tf, para el próximo bootstrap.
resource "azurerm_storage_account" "tfstate" {
  # ...
  blob_properties {
    versioning_enabled = true
    delete_retention_policy {
      days = 30
    }
    container_delete_retention_policy {
      days = 30
    }
  }
}

resource "azurerm_management_lock" "tfstate" {
  name       = "${azurerm_storage_account.tfstate.name}-lock"
  scope      = azurerm_storage_account.tfstate.id
  lock_level = "CanNotDelete"
  notes      = "El estado de Terraform contiene todos los secretos de la plataforma."
}

variable "grant_bootstrap_operator_access" {
  type    = bool
  default = false
}
```

- **Documentación de la Mejora:** los tres comandos no interrumpen nada. Quitarles el rol a los humanos (dejarlo elegible con PIM, o `Storage Blob Data Reader` puntual) no afecta al pipeline. Cerrar la red (`network_rules` con `default_action = "Deny"`) rompe el `terraform init` de los runners hasta que el workflow abra la IP del runner, como ya hace con Key Vault: queda para una segunda etapa, con ese paso agregado al workflow. Sacar los secretos del state es M-01.

### M-01. [CRITICIDAD: Media] Secretos inline en la Container App y en el job de migraciones, y secretos en el state

- **Archivo y Recurso:** `modules/stamp/main.tf` → `local.app_secrets` (`db-password`, `redis-password`, `storage-connection-string`, `appinsights-connection-string`), que pasa a `module.app` (`inline_secrets`) y a `azurerm_container_app_job.migrate` (`dynamic "secret"` con `value`). `modules/containerapp/main.tf` → `dynamic "secret"` inline. `random_password.mysql`. `.github/workflows/terraform.yml` → `terraform_version: 1.9.8`. Conocido Redis (P2); **nuevo** el resto.
- **Riesgo:** cualquiera con `Contributor` sobre el RG (hoy 2 SP y el Owner) lee estos secretos con `listSecrets`. Rotarlos exige apply y una revisión nueva, y quedan en el state (H-06). Medido: los 4 secretos del app son inline. Los cron ya usan una referencia a Key Vault (`cron-secret`), así que el patrón funciona con el firewall del vault.
- **Control / Norma:** ASB v3 IM-8.
- **Remediación en Código:**

```hcl
# Paso 1, modules/stamp/main.tf: referencias a Key Vault en lugar de valores inline.
resource "azurerm_key_vault_secret" "redis_password" {
  name            = "infra-redis-password" # el nombre que ya resuelve infraSecrets.ts; si existe, importarlo
  value           = module.redis.primary_access_key
  key_vault_id    = module.keyvault.id
  content_type    = "password"
  expiration_date = time_offset.secret_expiry.rfc3339
  tags            = var.tags
}

locals {
  app_kv_secret_ids = {
    db-password    = azurerm_key_vault_secret.mysql_password.versionless_id
    redis-password = azurerm_key_vault_secret.redis_password.versionless_id
  }
  app_secrets = {
    appinsights-connection-string = module.monitoring.appinsights_connection_string
  }
}

module "app" {
  # ...
  inline_secrets       = local.app_secrets
  key_vault_secret_ids = merge(var.key_vault_secret_ids, local.app_kv_secret_ids)
}

# azurerm_container_app_job.migrate: un bloque secret por referencia (el esquema de 4.81.0 admite key_vault_secret_id).
  dynamic "secret" {
    for_each = local.app_kv_secret_ids
    content {
      name                = secret.key
      identity            = azurerm_user_assigned_identity.app.id
      key_vault_secret_id = secret.value
    }
  }
```

```hcl
# Paso 2: secretos fuera del state. Exige terraform_version >= 1.11 en el workflow.
ephemeral "random_password" "mysql" {
  length           = 32
  special          = true
  override_special = "!#$%*()-_=+[]{}<>:?"
}

resource "azurerm_key_vault_secret" "mysql_password" {
  name             = "infra-db-password"
  value_wo         = ephemeral.random_password.mysql.result
  value_wo_version = 2 # incrementar para rotar, junto con administrator_password_wo_version
  key_vault_id     = module.keyvault.id
  # ...
}
# modules/mysql: administrator_password_wo y administrator_password_wo_version, con el mismo valor
# recibido por una variable `ephemeral = true`.
```

- **Documentación de la Mejora:** el paso 1 crea una revisión nueva del app, sin downtime y sin cambiar ningún valor. Si `infra-redis-password` ya existe en el vault, hay que importarlo. Las referencias a Key Vault se toman al iniciar la revisión, no al instante. El paso 2 **cambia** la contraseña de MySQL al aplicarse: hay que coordinarlo con el reinicio de la app, los cron y las migraciones, y subir el `terraform_version` del workflow (hoy 1.9.8; los atributos de sólo escritura piden 1.11). Para Redis, el destino es Entra ID (`azurerm_managed_redis_access_policy_assignment` con `managed_redis_id` y `object_id`, más un cambio en `src/lib/redis.ts`) y después `access_keys_authentication_enabled = false`.

### M-02. [CRITICIDAD: Media] Los backups los puede borrar quien los escribe, sin soft delete de contenedores ni lock

- **Archivo y Recurso:** `modules/storage/main.tf` → `blob_properties`, sin `container_delete_retention_policy`. `modules/security_policy/main.tf` → `azurerm_management_lock.data_resources`, que no se crea porque `resource_lock_enabled = false` en tfvars. `modules/mysql_backup/main.tf` → `azurerm_role_assignment.vm_backups_blob_contributor` y `automation_backups_blob_contributor` (`Storage Blob Data Contributor`, que incluye borrar). `modules/mysql/main.tf` → `geo_redundant_backup_enabled` y `high_availability`. Conocido (P1 Recuperación); **nuevos** el lock, el soft delete y el borrado.
- **Riesgo:** quien comprometa la VM o la Automation Account (o la identidad de la app, H-02) puede borrar todos los dumps, y el borrado del contenedor `db-backups` o de la cuenta no tiene vuelta. Si un ransomware sobrescribe, las versiones anteriores sólo quedan 7 días. Medido: sin lock en la cuenta (MySQL y Key Vault sí tienen), `containerDeleteRetentionPolicy` deshabilitada, MySQL con 14 días de retención y sin geo ni HA.
- **Control / Norma:** ASB v3 BR-1, BR-2 y BR-4. CIS (Storage): soft delete para contenedores y blobs.
- **Remediación en Código:**

```hcl
# modules/storage/main.tf
  blob_properties {
    delete_retention_policy {
      days = 30
    }
    container_delete_retention_policy {
      days = 30
    }
    versioning_enabled = true
  }
```

```hcl
# TF_VARS_PROD
resource_lock_enabled = true
```

```hcl
# modules/mysql_backup/main.tf: escribir sin poder borrar. Son las acciones de Storage Blob Data
# Contributor (leídas de Azure) sin delete ni move.
resource "azurerm_role_definition" "backup_writer" {
  name              = "FinOps Backup Writer (sin borrado)"
  scope             = var.storage_resource_group_id
  description       = "Sube y lee dumps en db-backups. No borra blobs ni contenedores."
  assignable_scopes = [var.storage_resource_group_id]

  permissions {
    actions = ["Microsoft.Storage/storageAccounts/blobServices/containers/read"]
    data_actions = [
      "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read",
      "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/write",
      "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/add/action",
    ]
  }
}

resource "azurerm_role_assignment" "automation_backups_blob_contributor" {
  scope              = var.storage_container_resource_id
  role_definition_id = azurerm_role_definition.backup_writer.role_definition_resource_id
  principal_id       = azurerm_automation_account.this.identity[0].principal_id
}
# Lo mismo para vm_backups_blob_contributor.
```

```hcl
# modules/mysql/main.tf. NO activar la geo-redundancia desde el tfvars: en azurerm 4.81.0
# geo_redundant_backup_enabled "forces a new MySQL Flexible Server to be created".
  lifecycle {
    ignore_changes = [zone, high_availability[0].standby_availability_zone, version, geo_redundant_backup_enabled]
  }
```

- **Documentación de la Mejora:** el soft delete y el lock son updates en sitio, sin corte. El lock también frena un `terraform destroy` de la cuenta, que es lo que se quiere; para quitarlo está el flag. Cambiar el rol recrea las dos asignaciones: son dos deletes y el validador admite uno por apply, así que van en dos applies, con un test job en el medio. AzCopy con `--overwrite=true` (los nombres fijos de monthly y yearly) es una escritura, no un borrado, así que el rol nuevo alcanza; el lifecycle (`xAzure`) sigue borrando por su cuenta. La geo-redundancia de MySQL se puede pasar de local a geo desde Compute + Storage en el portal (según la doc de MySQL Flexible; de zona a geo no se puede): se hace ahí y Terraform la ignora. `backup_retention_days` (hoy 14, máximo 35) sí cambia en sitio. Falta decidir la HA.

### M-03. [CRITICIDAD: Media] VM de backups y Automation Account: salida libre, sin EDR, autenticación local y un rol que permite ejecutar código como SYSTEM

- **Archivo y Recurso:** `modules/mysql_backup/main.tf` → `azurerm_network_security_group.vm` (sólo reglas de entrada), `azurerm_subnet.vm`, `azurerm_windows_virtual_machine.this`, `azurerm_automation_account.this` (sin `local_authentication_enabled`), y `azurerm_role_assignment.automation_vm_contributor` (`Virtual Machine Contributor` sobre el RG). `modules/defender/main.tf` y `defender_resource_types`, sin `VirtualMachines`. **Nuevo.**
- **Riesgo:** la VM corre como SYSTEM, guarda la contraseña de administrador de MySQL y puede salir a cualquier destino de internet o de la VNet: es un canal de exfiltración sin control y sin EDR que lo vea. `Virtual Machine Contributor` incluye `runCommand`, así que quien obtenga la identidad de Automation ejecuta código en esa VM. Medido: Defender `VirtualMachines` en Free; Automation con `publicNetworkAccess = true` y `disableLocalAuth = false`. Está bien: la VM no tiene IP pública, tiene cifrado en el host y parches `AutomaticByPlatform`.
- **Control / Norma:** ASB v3 NS-3 (salida), ES-1 y ES-2 (EDR), PA-7 e IM-1.
- **Remediación en Código:**

```hcl
# modules/mysql_backup/main.tf: salida explícita. Las etiquetas salen de la doc de red del Hybrid Worker
# (GuestAndHybridManagement y AzureMonitor). Fase 1, sin Deny. Variable nueva: mysql_subnet_prefix.
  security_rule {
    name                       = "AllowMySqlOutbound"
    priority                   = 100
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3306"
    source_address_prefix      = "*"
    destination_address_prefix = var.mysql_subnet_prefix
  }

  security_rule {
    name                       = "AllowAutomationOutbound"
    priority                   = 110
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "GuestAndHybridManagement"
  }
  # Una regla por etiqueta: AzureMonitor (120), AzureActiveDirectory (130), Storage.WestUS2 (140).
  # Fase 2, después de ver los flow logs (L-05): DenyInternetOutbound (4000, destino "Internet").
```

```hcl
# modules/defender/main.tf. "P1" es el valor del ejemplo oficial de la API de Pricings.
  default_subplans = {
    Arm             = "PerSubscription"
    KeyVaults       = "PerKeyVault"
    StorageAccounts = "DefenderForStorageV2"
    VirtualMachines = "P1"
  }
# environments/prod/variables.tf, en el default de defender_resource_types: agregar "VirtualMachines".
```

```hcl
# modules/mysql_backup/main.tf
resource "azurerm_automation_account" "this" {
  # ...
  local_authentication_enabled = false # afecta webhooks, sincronización con control de código y DSC: no se usan
}

resource "azurerm_role_definition" "vm_starter" {
  name              = "FinOps Backup VM Starter"
  scope             = azurerm_resource_group.this.id
  assignable_scopes = [azurerm_resource_group.this.id]

  permissions {
    actions = [
      "Microsoft.Compute/virtualMachines/read",
      "Microsoft.Compute/virtualMachines/start/action",
      "Microsoft.Compute/virtualMachines/instanceView/read",
    ]
  }
}

resource "azurerm_role_assignment" "automation_vm_contributor" {
  scope              = azurerm_windows_virtual_machine.this.id
  role_definition_id = azurerm_role_definition.vm_starter.role_definition_resource_id
  principal_id       = azurerm_automation_account.this.identity[0].principal_id
}
```

- **Documentación de la Mejora:** las reglas Allow no cambian nada, porque hoy ya se permite todo. El Deny final, en cambio, puede romper Windows Update, la activación de Windows y Defender for Endpoint si falta alguna etiqueta: hay que agregarlas según la doc de cada uno y probar antes. Defender for Servers activado por suscripción cubre todas las VMs, incluidas las de otros proyectos, y cobra por servidor; la API de Pricings también admite activarlo para una sola VM, pero eso queda fuera de azurerm. `local_authentication_enabled = false` no afecta al Hybrid Worker por extensión. El rol nuevo recrea la asignación (un delete, en un apply propio). Hay que comprobar que el orquestador sólo use `Start-AzVM` y lecturas; como la VM queda prendida 24 horas, casi no lo necesita.

### M-04. [CRITICIDAD: Media] La URL firmada de la Logic App de alertas está expuesta en el historial de despliegues

- **Archivo y Recurso:** `modules/mysql_backup/main.tf` → `azurerm_resource_group_template_deployment.logic_app_alerts` (`outputs.triggerUrl` con `listCallbackUrl`), `azurerm_automation_variable_string.alert_webhook_url` y `azurerm_api_connection.office365`. **Nuevo.**
- **Riesgo:** la URL lleva la firma SAS del trigger. Los outputs de un despliegue ARM los puede leer cualquiera con `Reader` sobre el RG, y además quedan en el state. Con esa URL se pueden mandar correos con asunto y HTML arbitrarios desde la cuenta de Office 365, porque el cuerpo interpola `ErrorMessage` sin escapar: es phishing interno con un remitente legítimo. Además, la conexión depende de un buzón personal. Medido: el despliegue `la-backup-alerts-deploy` expone `triggerUrl`.
- **Control / Norma:** ASB v3 IM-8.
- **Remediación en Código:**

```hcl
# Recomendada, sin ningún secreto: alerta por la métrica de jobs. La métrica TotalJob y la dimensión
# Status se leyeron de Azure. El destino es el action group existente.
resource "azurerm_monitor_metric_alert" "backup_job_failed" {
  name                = "${var.resource_group_name}-backup-job-failed"
  resource_group_name = azurerm_resource_group.this.name
  scopes              = [azurerm_automation_account.this.id]
  description         = "Un job de backup terminó en Failed, Suspended o Stopped."
  severity            = 1
  frequency           = "PT5M"
  window_size         = "PT15M"

  criteria {
    metric_namespace = "Microsoft.Automation/automationAccounts"
    metric_name      = "TotalJob"
    aggregation      = "Total"
    operator         = "GreaterThan"
    threshold        = 0

    dimension {
      name     = "Status"
      operator = "Include"
      values   = ["Failed", "Suspended", "Stopped"]
    }
  }

  action {
    action_group_id = var.action_group_id # exponer module.monitoring.action_group_id como output del stamp
  }
}
```

- **Documentación de la Mejora:** hoy el orquestador captura el error y termina en `Completed`; para que la métrica lo vea, tiene que relanzar la excepción después de avisar (el worker ya falla en voz alta). Si se conserva la Logic App, lo inmediato es: regenerar sus claves de acceso (invalida la URL expuesta), sacar `triggerUrl` de los outputs y pasar a OAuth de Entra (`accessControl.triggers.openAuthenticationPolicies`) con SAS deshabilitado, según la doc de Logic Apps. Regenerar las claves rompe la alerta actual hasta actualizar `ALERT_WEBHOOK_URL`. Para retirar la Logic App, la conexión y la variable hay tres deletes: en applies separados o con bloques `removed`.

### M-05. [CRITICIDAD: Media] Storage sin restricción de red (endpoint público, sin firewall ni private endpoint)

- **Archivo y Recurso:** `modules/storage/main.tf` → `azurerm_storage_account.this` (`public_network_access_enabled = true`, sin `network_rules`). `modules/private_dns/main.tf` no tiene la zona de blob, y su comentario «Blob/Storage no está» quedó desactualizado. Conocido (fuera del alcance de la 7.6).
- **Riesgo:** con Shared Key apagado (C-01), entrar exige Entra ID, pero el endpoint sigue alcanzable desde todo internet. Un token robado de la identidad de la app (H-02) se puede usar desde cualquier lugar.
- **Control / Norma:** ASB v3 NS-2. CIS (Storage): acceso de red por defecto en Deny.
- **Remediación en Código:**

```hcl
# modules/private_dns/main.tf: agregar la zona
      blob = "privatelink.blob.core.windows.net"

# modules/storage/main.tf (variables nuevas: subnet_id y blob_private_dns_zone_id)
  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices", "Logging", "Metrics"]
    ip_rules       = [] # el workflow agrega y quita la IP del runner, como con Key Vault
  }

  lifecycle {
    ignore_changes = [network_rules[0].ip_rules]
  }

resource "azurerm_private_endpoint" "blob" {
  name                = "${azurerm_storage_account.this.name}-blob-pe"
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = var.subnet_id

  private_service_connection {
    name                           = "psc-blob"
    private_connection_resource_id = azurerm_storage_account.this.id
    subresource_names              = ["blob"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [var.blob_private_dns_zone_id]
  }
}
```

- **Documentación de la Mejora:** el riesgo de breaking change es alto. La llamada de plano de datos de Terraform (`GetBlobServiceProperties`) necesita el paso del workflow que abre la IP del runner. El portal sólo funciona desde una IP permitida o por el PE. La app y la VM resuelven el PE por la zona vinculada a la VNet (sumar el 443 desde la subred de la VM en el NSG de H-01). El lifecycle no se ve afectado. Va después de C-01, y el PE tiene costo mensual, igual que el de Key Vault.

### M-06. [CRITICIDAD: Media] Al origen sólo lo autentica el rango de IP de Cloudflare

- **Archivo y Recurso:** `modules/containerapp/main.tf` → `azurerm_container_app.this.ingress`, sin `client_certificate_mode`; `environments/prod` → `origin_cloudflare_only` y las IP de Cloudflare. Conocido (residual del destino A).
- **Riesgo:** los rangos de Cloudflare los comparten todos sus clientes. Cualquiera puede crear su propia zona apuntando a este origen y llegar a la app salteando el WAF y el rate limiting de la zona de CSCS. Medido: 16 reglas de IP y `clientCertificateMode` sin definir.
- **Control / Norma:** ASB v3 IM-4 y NS-2.
- **Remediación en Código:**

```hcl
# modules/containerapp/main.tf
  ingress {
    external_enabled        = true
    client_certificate_mode = "accept" # "require" cortaría a los cron, que llaman a la URL interna sin certificado
    # ...
  }
```

- **Documentación de la Mejora:** según la doc de Container Apps, la plataforma acepta certificados emitidos por una CA o autofirmados y los pasa a la app en `X-Forwarded-Client-Cert` (`Hash`, `Cert`, `Chain`); la validación queda a cargo de la app. El resto es: Authenticated Origin Pulls en Cloudflare con un **certificado propio** de la zona, y un middleware que acepte sólo si el `Hash` coincide con ese certificado o si el origen es la IP del NAT (los cron). El certificado global de AOP no sirve, porque es el mismo para todos los clientes de Cloudflare (dato de Cloudflare: verificarlo en su doc). Hay una alternativa más simple: un encabezado secreto agregado por una Transform Rule de Cloudflare y validado en el middleware. `accept` no corta nada mientras la app no exija el certificado.

### L-01. [CRITICIDAD: Baja] `status-snapshot` autentica el cron por query string

- **Archivo y Recurso:** `environments/prod/cron-jobs.tfvars` (`status-snapshot … auth_mode = "query"`); `modules/cronjobs/main.tf` (el `runner` arma `?secret=`); `src/app/api/cron/status-snapshot/route.ts:68`, que sólo lee `searchParams`. **Nuevo.**
- **Riesgo:** `CRON_SECRET` es uno solo para todos los endpoints. Una URL con el secreto en la query termina tarde o temprano en algún log (proxy, APM o trazas), y con él se puede disparar cualquier cron, con llamadas costosas a las APIs de Azure de los tenants. Medido: 0 apariciones de `secret=` en `ContainerAppConsoleLogs_CL` (30 días) y en `AppRequests`. Es un riesgo latente, no una fuga.
- **Control / Norma:** ASB v3 IM-8.
- **Remediación en Código:**

```diff
-  status-snapshot = { cron = "*/5 * * * *", timeout_seconds = 120, auth_mode = "query" }
+  status-snapshot = { cron = "*/5 * * * *", timeout_seconds = 120 }
```

Además, la ruta tiene que validar `Authorization: Bearer` igual que el resto de los cron, y dejar de aceptar `?secret=`.

- **Documentación de la Mejora:** primero hay que desplegar el código de la ruta. Si el tfvars cambia antes, el job recibe 401 cada 5 minutos.

### L-02. [CRITICIDAD: Baja] Container Apps sin cifrado entre pares dentro del entorno

- **Archivo y Recurso:** `modules/stamp/main.tf` → `azurerm_container_app_environment.this`. **Nuevo.**
- **Riesgo:** el tramo interno del entorno viaja sin cifrar dentro de la red del entorno: del proxy a la réplica, y del cron a la app por la URL interna. Medido: `peerTrafficConfiguration.encryption.enabled = false` y `peerAuthentication.mtls.enabled = false`.
- **Control / Norma:** ASB v3 DP-3.
- **Remediación en Código:** azurerm 4.81.0 no expone el cifrado entre pares (sólo `mutual_tls_enabled`, en preview, que es otra función). Se activa por CLI (flag verificado):

```bash
az containerapp env update -g cscs-finops-prod-westus2-rg -n cscs-finops-prod-westus2-cae --enable-peer-to-peer-encryption true
```

- **Documentación de la Mejora:** es un cambio fuera de Terraform y hay que anotarlo. Suma algo de latencia: probar el health y un cron después.

### L-03. [CRITICIDAD: Baja] El Key Vault de prod está fuera de Terraform y tiene acceso humano permanente

- **Archivo y Recurso:** `modules/keyvault/main.tf` → `data.azurerm_key_vault.existing`; roles directos sobre `cscs-finops-prod-wus2-kv`. **Nuevo.**
- **Riesgo:** puede haber deriva silenciosa (alguien apaga el firewall o la purge protection) y hay acceso humano sin JIT a todas las credenciales de tenants. Medido: el vault está bien configurado (RBAC, purge protection, firewall `Deny`, PE y lock), pero nada en el código lo garantiza. `Key Vault Administrator` y `Key Vault Secrets Officer` están asignados a usuarios en forma permanente.
- **Control / Norma:** ASB v3 PA-2, PV-1 y PV-2.
- **Remediación en Código:** encender la auditoría de Policy (H-05), que ya incluye `keyvault-purge`, `keyvault-firewall`, `keyvault-rbac` y `keyvault-logs`, y pasar los roles humanos a elegibles con PIM. Como opción, importar el vault al módulo (`create = true`, con los valores medidos).
- **Documentación de la Mejora:** importar exige reproducir exactamente la configuración medida, para que el plan no proponga cambios. La auditoría de Policy no toca nada.

### L-04. [CRITICIDAD: Baja] Log Analytics y Application Insights con autenticación local, acceso público y un tope de 1 GB/día

- **Archivo y Recurso:** `modules/monitoring/main.tf` → `azurerm_log_analytics_workspace.this` (`daily_quota_gb`) y `azurerm_application_insights.this`. **Nuevo.**
- **Riesgo:** con la clave del workspace o el connection string se puede inyectar telemetría falsa. Y si un incidente, o un atacante, satura la ingesta, el tope corta todos los logs del día, también los de seguridad. Medido: `disableLocalAuth = false` en ambos recursos, ingesta y consulta públicas, tope de 1 GB/día (máximo medido: 0,115 GB/día, sin cortes en 30 días).
- **Control / Norma:** ASB v3 IM-1 y LT-6.
- **Remediación en Código:**

```hcl
resource "azurerm_log_analytics_workspace" "this" {
  # ...
  local_authentication_enabled = false
}

resource "azurerm_application_insights" "this" {
  # ...
  local_authentication_enabled = false # reemplaza al deprecado local_authentication_disabled
}
```

```hcl
# TF_VARS_PROD: subir el tope y vigilar el costo con el presupuesto
log_daily_quota_gb = 5
```

- **Documentación de la Mejora:** apagar la autenticación local de App Insights rompe la telemetría hasta que el SDK use Entra (credencial en Azure Monitor OpenTelemetry). En Log Analytics afecta a los agentes que usen la clave del workspace: verificar que no haya ninguno. El tope es sólo costo; cambiarlo no recrea nada.

### L-05. [CRITICIDAD: Baja] Higiene y visibilidad de red

- **Archivo y Recurso:**
  - `environments/prod/main.tf`: los bloques `import` de `TEAMS_WEBHOOK_URL` y del orquestador (este con el id de suscripción literal); su propio comentario pide borrarlos.
  - `modules/mysql_backup/main.tf` → `azurerm_windows_virtual_machine.this`: los parches `AutomaticByPlatform` se configuraron fuera de Terraform y boot diagnostics está apagado.
  - `modules/network/main.tf`: no hay VNet flow logs (0 medidos en westus2).
  - `modules/stamp/main.tf`: el backup vault de Data Protection tiene la instancia en `count = 0` y hoy no hay vault desplegado; es código muerto.
  - CMK en Storage y MySQL: sólo si un contrato lo exige. `infrastructure_encryption_enabled` recrea la cuenta, así que aplica sólo a cuentas nuevas.
  - ACR Basic: endpoint público y despliegue por tag (P2: digest y firma).
- **Riesgo:** sin flow logs no se puede diseñar ni verificar la salida de M-03 ni investigar movimiento lateral. Además, la configuración aplicada a mano se pierde si se recrea la VM.
- **Control / Norma:** ASB v3 LT-4, PV-1 y DP-5.
- **Remediación en Código:**

```hcl
# modules/mysql_backup/main.tf
resource "azurerm_windows_virtual_machine" "this" {
  # ...
  patch_mode            = "AutomaticByPlatform"
  patch_assessment_mode = "AutomaticByPlatform"
  boot_diagnostics {} # storage administrado
}

# modules/network/main.tf. Network Watcher medido: NetworkWatcher_westus2 en NetworkWatcherRG.
resource "azurerm_network_watcher_flow_log" "vnet" {
  name                 = "${var.name_base}-vnet-flowlog"
  network_watcher_name = "NetworkWatcher_${var.location}"
  resource_group_name  = "NetworkWatcherRG"
  target_resource_id   = azurerm_virtual_network.this.id
  storage_account_id   = var.flow_logs_storage_account_id
  enabled              = true

  retention_policy {
    enabled = true
    days    = 30
  }
}
```

- **Documentación de la Mejora:** borrar los `import` y declarar los parches no produce cambios en el plan. Los flow logs necesitan una cuenta de Storage propia (los logs no deberían vivir en la de datos) y tienen costo por GB procesado. Traffic Analytics es opcional.

---

## Matriz resumen

| ID | Severidad | Recurso afectado | Esfuerzo | Riesgo de breaking change |
|---|---|---|---|---|
| C-01 | Crítica | `azurerm_storage_account.this` (clave filtrada, Shared Key, red) | Bajo (flags y CLI ya preparados) | Medio (la rotación invalida la SAS y la connection string en desuso) |
| H-01 | Alta | Subred de la web en la VNet; subredes del stamp sin NSG | Medio | Alto (un NSG mal escrito corta MySQL o Redis) |
| H-02 | Alta | `azurerm_user_assigned_identity.app` y sus roles | Medio | Medio (dos applies; contenedores a declarar) |
| H-03 | Alta | Dos SP con Contributor y UAA en la suscripción | Bajo | Medio (los applies con roles fuera de la lista fallan) |
| H-04 | Alta | `azurerm_mysql_flexible_server.this` y usuario de la app | Bajo (auditoría) / Alto (usuarios y Entra) | Bajo (auditoría) / Alto (usuarios) |
| H-05 | Alta | Activity Log, alertas, Policy y retención | Bajo | Bajo |
| H-06 | Alta | `azurerm_storage_account.tfstate` | Bajo (CLI) / Medio (red) | Bajo / Alto (red sin el paso del runner) |
| M-01 | Media | Secretos inline y secretos en el state | Medio / Alto (sólo escritura) | Medio (cambia la contraseña de MySQL) |
| M-02 | Media | Backups: soft delete, lock, rol con borrado, geo | Bajo / Medio | Bajo (geo nunca por tfvars: recrea el servidor) |
| M-03 | Media | VM de backups, Automation, Defender for Servers | Medio | Medio (el Deny de salida puede cortar Windows Update) |
| M-04 | Media | Logic App de alertas | Bajo | Medio (la alerta cambia de canal) |
| M-05 | Media | Red de Storage (PE y firewall) | Medio | Alto (CI, portal) |
| M-06 | Media | Ingress del Container App | Medio (Cloudflare y middleware) | Bajo con `accept` / Alto con `require` |
| L-01 | Baja | Cron `status-snapshot` | Bajo | Medio si se cambia antes que el código |
| L-02 | Baja | Container Apps Environment | Bajo | Bajo |
| L-03 | Baja | Key Vault de prod | Bajo | Bajo |
| L-04 | Baja | Log Analytics y App Insights | Bajo | Alto en App Insights (requiere SDK con Entra) |
| L-05 | Baja | Higiene: imports, VM, flow logs, CMK, ACR | Bajo | Bajo |

## Acción inmediata (antes del próximo release)

1. **Neutralizar la clave de Storage filtrada (C-01).** Subir `TF_VARS_PROD` (ya preparado) y aplicar la fase 2. Apenas la app entre con OAuth, rotar `key1` y `key2` sin esperar a la fase 5. A las 24 h, `storage_shared_access_key_enabled = false`.
2. **Cortar la línea lateral desde la web corporativa (H-01).** Sacar la integración de VNet del App Service `cscloudsolutions` de la VNet de FinOps. Como mínimo, y en el mismo release, poner el NSG de la subred de MySQL y el de los private endpoints.
3. **Encender la detección (H-05, más la auditoría de H-04).** Exportar el Activity Log, poner los flags de alertas y Policy en `true`, dar 365 días de retención a las tablas de seguridad y activar `audit_log_enabled` en MySQL (dinámico, sin reinicio). Sin esto, cualquier incidente se investiga con un horizonte de 30 días.

Lo siguiente es H-03 (condicionar UAA y quitar el SP sobrante), que necesita a alguien con permisos de Owner y está preparado en el runbook 7.2.

## Fuera del alcance de este Terraform, en la misma suscripción

Hay recursos de otros proyectos que comparten la superficie de H-03: `cscs-kv-wus2-prod` (web) sin purge protection y con 7 días de soft delete, `kvcscse22c35` sin purge protection, ambos sin firewall, y el ACR `acrcscse22c35` con usuario administrador habilitado. Cualquier principal con permisos de suscripción los alcanza.

## Verificaciones hechas para escribir las remediaciones

- **Esquema del provider:** cada argumento propuesto se comprobó contra el esquema de azurerm 4.81.0 (`terraform providers schema -json`), y los valores admitidos y los «forces new», contra la doc de esa versión. Dos casos cambiaron la remediación: `geo_redundant_backup_enabled` e `infrastructure_encryption_enabled` recrean el recurso, y `peer_traffic_encryption_enabled` no existe.
- **Contratos de Azure:**
  - `audit_log_events` admitidos y parámetros dinámicos: `az mysql flexible-server parameter show`.
  - Métrica `TotalJob` con dimensiones `Runbook`/`Status`: `az monitor metrics list-definitions`.
  - Nombres de operaciones: `az provider operation show`.
  - Acciones de datos de `Storage Blob Data Contributor`: `az role definition list`.
  - Puerto de Managed Redis: 10000.
- **learn.microsoft.com:**
  - Categorías del Activity Log.
  - Subplan `P1` de Defender for Servers.
  - Etiquetas de servicio del Hybrid Worker.
  - Efectos de desactivar la autenticación local de Automation.
  - Modo de certificado cliente de Container Apps.
  - Controles de acceso del trigger de Logic Apps.
  - Paso de redundancia local a geo en MySQL Flexible.
  - Alcance por secreto en el RBAC de Key Vault.
- **Sin verificar en esta sesión, y señalado en el texto:** el comportamiento del certificado global de AOP de Cloudflare, los permisos de Graph para Entra en MySQL y el privilegio exacto que pide `--routines` en Azure.
