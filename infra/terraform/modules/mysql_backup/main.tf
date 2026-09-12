resource "azurerm_resource_group" "this" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags
}

# ─────────────────────────────────────────────────────────────────────────────
# Red: 2 subredes nuevas en la VNet EXISTENTE del stamp. Sin Private Endpoint
# nuevo — esa VNet ya tiene privatelink.mysql.database.azure.com vinculada
# (ver comentario de variables.tf), así que cualquier recurso en una subred de
# esa misma VNet ya resuelve el FQDN de MySQL a su IP privada.
# ─────────────────────────────────────────────────────────────────────────────

resource "azurerm_subnet" "vm" {
  name                 = "snet-backup-vm"
  resource_group_name  = var.existing_vnet_resource_group_name
  virtual_network_name = var.existing_vnet_name
  address_prefixes     = [var.vm_subnet_prefix]
}

# Nombre EXACTO obligatorio — Azure Bastion sólo se despliega en una subred
# llamada literalmente así.
resource "azurerm_subnet" "bastion" {
  count                = var.bastion_enabled ? 1 : 0
  name                 = "AzureBastionSubnet"
  resource_group_name  = var.existing_vnet_resource_group_name
  virtual_network_name = var.existing_vnet_name
  address_prefixes     = [var.bastion_subnet_prefix]
}

# La VM no tiene IP pública (Fase 3.1 del manual): sólo Bastion puede llegar a
# RDP, y sólo desde su propia subred. Sin este NSG, cualquier recurso de la
# VNet (incluida la app web) podría intentar RDP a la VM.
resource "azurerm_network_security_group" "vm" {
  name                = "${var.resource_group_name}-nsg-vm"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = var.tags

  security_rule {
    name                       = "AllowRdpFromBastion"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3389"
    source_address_prefix      = var.bastion_subnet_prefix
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "DenyAllOtherInbound"
    priority                   = 4096
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "vm" {
  subnet_id                 = azurerm_subnet.vm.id
  network_security_group_id = azurerm_network_security_group.vm.id
}

# Reglas exactas que exige Microsoft para AzureBastionSubnet — un NSG más
# restrictivo (o sin alguna de estas reglas) rompe Bastion en runtime, no en
# el apply: https://learn.microsoft.com/azure/bastion/bastion-nsg
resource "azurerm_network_security_group" "bastion" {
  count               = var.bastion_enabled ? 1 : 0
  name                = "${var.resource_group_name}-nsg-bastion"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = var.tags

  security_rule {
    name                       = "AllowHttpsInbound"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowGatewayManagerInbound"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "GatewayManager"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowAzureLoadBalancerInbound"
    priority                   = 120
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "AzureLoadBalancer"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowBastionHostCommunicationInbound"
    priority                   = 130
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_ranges    = ["8080", "5701"]
    source_address_prefix      = "VirtualNetwork"
    destination_address_prefix = "VirtualNetwork"
  }

  security_rule {
    name                       = "AllowSshRdpOutbound"
    priority                   = 100
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_ranges    = ["22", "3389"]
    source_address_prefix      = "*"
    destination_address_prefix = "VirtualNetwork"
  }

  security_rule {
    name                       = "AllowAzureCloudOutbound"
    priority                   = 110
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "AzureCloud"
  }

  security_rule {
    name                       = "AllowBastionHostCommunicationOutbound"
    priority                   = 120
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_ranges    = ["8080", "5701"]
    source_address_prefix      = "VirtualNetwork"
    destination_address_prefix = "VirtualNetwork"
  }

  security_rule {
    name                       = "AllowGetSessionInformationOutbound"
    priority                   = 130
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "*"
    destination_address_prefix = "Internet"
  }
}

resource "azurerm_subnet_network_security_group_association" "bastion" {
  count                     = var.bastion_enabled ? 1 : 0
  subnet_id                 = azurerm_subnet.bastion[0].id
  network_security_group_id = azurerm_network_security_group.bastion[0].id
}

resource "azurerm_public_ip" "bastion" {
  count               = var.bastion_enabled ? 1 : 0
  name                = "${var.resource_group_name}-pip-bastion"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = var.tags
}

resource "azurerm_bastion_host" "this" {
  count               = var.bastion_enabled ? 1 : 0
  name                = "${var.resource_group_name}-bastion"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  # Basic alcanza: sólo se usa para RDP puntual de mantenimiento/setup inicial
  # (Fase 4), no para acceso frecuente.
  sku  = "Basic"
  tags = var.tags

  ip_configuration {
    name                 = "bastion-ipconfig"
    subnet_id            = azurerm_subnet.bastion[0].id
    public_ip_address_id = azurerm_public_ip.bastion[0].id
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# VM Worker (Windows) — Hybrid Runbook Worker. Sin IP pública (Fase 3.1).
# ─────────────────────────────────────────────────────────────────────────────

resource "random_password" "vm_admin" {
  length      = 24
  special     = true
  min_upper   = 2
  min_lower   = 2
  min_numeric = 2
  min_special = 2
}

# Se guarda en el Key Vault que YA existe para el stamp — un solo lugar donde
# buscar credenciales, en vez de sumar un vault nuevo para una sola password.
resource "azurerm_key_vault_secret" "vm_admin_password" {
  name         = "infra-backup-vm-admin-password"
  value        = random_password.vm_admin.result
  key_vault_id = var.key_vault_id
  content_type = "text/plain"
  # random_password no rota sola: la password vive mientras viva la VM. Un
  # año da margen para rotarla a mano por Bastion sin dejarla sin vencimiento
  # para siempre.
  expiration_date = timeadd(time_static.vm_admin_password_created.rfc3339, "8760h")
}

resource "time_static" "vm_admin_password_created" {}

resource "azurerm_network_interface" "vm" {
  name                = "${var.resource_group_name}-nic-vm"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = var.tags

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.vm.id
    private_ip_address_allocation = "Dynamic"
  }
}

resource "azurerm_windows_virtual_machine" "this" {
  name                = "vm-mysql-worker"
  resource_group_name = azurerm_resource_group.this.name
  location            = var.location
  size                = var.vm_size
  admin_username      = var.vm_admin_username
  admin_password      = random_password.vm_admin.result
  network_interface_ids = [
    azurerm_network_interface.vm.id,
  ]
  tags = var.tags

  identity {
    type = "SystemAssigned"
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
  }

  # Cifrado en el host soportado nativamente por la familia Standard_D2s_v5.
  encryption_at_host_enabled = true

  source_image_reference {
    publisher = "MicrosoftWindowsServer"
    offer     = "WindowsServer"
    sku       = "2022-datacenter-azure-edition"
    version   = "latest"
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Azure Automation + Hybrid Runbook Worker
# ─────────────────────────────────────────────────────────────────────────────

resource "azurerm_automation_account" "this" {
  name                = "aa-mysql-backups"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  sku_name            = "Basic"
  tags                = var.tags

  identity {
    type = "SystemAssigned"
  }
}

# Módulos Az que usan los runbooks (Connect-AzAccount, Start/Stop-AzVM,
# Start-AzAutomationRunbook, Get-AzAutomationJob). IMPORTANTE: deben importarse
# con azurerm_automation_powershell72_module para que queden disponibles en el
# runtime de PS 7.2 — el resource genérico azurerm_automation_module los importa
# en PS 5.1, invisible para runbooks de tipo PowerShell72.
#
# LA VERSIÓN VA EN LA URI, SIEMPRE. Sin ella la Gallery devuelve la última, y eso
# convirtió a estos tres recursos en una dependencia que se actualiza sola: el
# 2026-09-03 el runbook falló con "Connect-AzAccount is not recognized" sin que
# nadie hubiera cambiado nada, porque Az.Accounts había pasado a la línea 5.x.
# El porqué de cada número está en la descripción de `az_module_versions`.
resource "azurerm_automation_powershell72_module" "az_accounts" {
  name                  = "Az.Accounts"
  automation_account_id = azurerm_automation_account.this.id
  module_link {
    uri = "https://www.powershellgallery.com/api/v2/package/Az.Accounts/${var.az_module_versions.accounts}"
  }
}

resource "azurerm_automation_powershell72_module" "az_compute" {
  name                  = "Az.Compute"
  automation_account_id = azurerm_automation_account.this.id
  module_link {
    uri = "https://www.powershellgallery.com/api/v2/package/Az.Compute/${var.az_module_versions.compute}"
  }
  depends_on = [azurerm_automation_powershell72_module.az_accounts]
}

resource "azurerm_automation_powershell72_module" "az_automation" {
  name                  = "Az.Automation"
  automation_account_id = azurerm_automation_account.this.id
  module_link {
    uri = "https://www.powershellgallery.com/api/v2/package/Az.Automation/${var.az_module_versions.automation}"
  }
  depends_on = [azurerm_automation_powershell72_module.az_accounts]
}

resource "azurerm_automation_hybrid_runbook_worker_group" "this" {
  name                    = "hwg-mysql-worker"
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
}

# Patrón "extension-based hybrid worker" (el que usa el asistente del Portal
# desde 2024) — instala el agente en la VM y lo conecta automáticamente a esta
# Automation Account y al grupo de trabajadores híbridos.

# NO declarar aquí un `azurerm_automation_hybrid_runbook_worker`.
#
# Lo registra sola la extensión `HybridWorkerExtension` de más abajo: ése es el
# patrón "extension-based" y es el que efectivamente corrió. Verificado el
# 2026-08-22 contra la API de ARM — hay exactamente un worker,
# ec15b7be-1556-5728-8a3a-28fc4ecc2c51 (workerType HybridV2, workerName
# vm-mysql-worker), registrado el 2026-08-01 y con lastSeen del día.
#
# El recurso explícito estuvo declarado un tiempo pero NUNCA llegó al state:
# azurerm 4.x volvió obligatorio `worker_id` y la configuración no lo pasaba,
# así que `terraform validate` fallaba y el workflow quedó rojo desde el
# 2026-08-17. Reponerlo con un uuid nuevo no arregla nada: como no está en el
# state, Terraform intentaría CREAR un segundo worker sobre la misma VM
# (`ignore_changes` no aplica en la creación). Por eso se elimina en vez de
# completarse.

resource "azurerm_virtual_machine_extension" "hybrid_worker" {
  name                       = "HybridWorkerExtension"
  virtual_machine_id         = azurerm_windows_virtual_machine.this.id
  publisher                  = "Microsoft.Azure.Automation.HybridWorker"
  type                       = "HybridWorkerForWindows"
  type_handler_version       = "1.1"
  auto_upgrade_minor_version = true
  tags                       = var.tags

  settings = jsonencode({
    AutomationAccountURL = azurerm_automation_account.this.hybrid_service_url
  })

  depends_on = [
    azurerm_automation_hybrid_runbook_worker_group.this
  ]
}

# ─────────────────────────────────────────────────────────────────────────────
# RBAC: la identidad de la Automation Account necesita poder prender/apagar la
# VM (Fase 6.2 del manual) y disparar/consultar sus propios runbook jobs.
# ─────────────────────────────────────────────────────────────────────────────

resource "azurerm_role_assignment" "automation_vm_contributor" {
  scope                = azurerm_resource_group.this.id
  role_definition_name = "Virtual Machine Contributor"
  principal_id         = azurerm_automation_account.this.identity[0].principal_id
}

# Start-AzAutomationRunbook / Get-AzAutomationJob contra la MISMA cuenta:
# "Automation Operator" alcanza (correr y consultar jobs, sin poder editar
# runbooks ni variables).
resource "azurerm_role_assignment" "automation_operator_self" {
  scope                = azurerm_automation_account.this.id
  role_definition_name = "Automation Operator"
  principal_id         = azurerm_automation_account.this.identity[0].principal_id
}

# ─────────────────────────────────────────────────────────────────────────────
# SAS del contenedor destino (Fase 3.3 del manual) — generado por Terraform en
# vez de a mano en el Portal, para que quede versionado y sea reproducible.
# Mismos permisos que el manual: lectura, escritura, eliminación, lista,
# agregado, creación (r/w/d/l/a/c).
#
# ADVERTENCIA (igual que el manual original): un SAS no se auto-rota. Vence en
# sas_validity_years años desde el apply — agendar su renovación antes de esa
# fecha (ver output sas_expiry_warning). Renovarlo es sólo bump de
# sas_validity_years o un `terraform apply` que regenere el time_rotating de
# abajo; no hace falta recrear ningún otro recurso.
# ─────────────────────────────────────────────────────────────────────────────

# `start`/`expiry` NO pueden depender de timestamp(): timestamp() es "ahora"
# en CADA plan, así que el SAS calculado (y con él
# azurerm_automation_variable_string.storage_sas_token) cambiaría de valor en
# cada plan aunque nada haya cambiado de verdad — drift perpetuo. time_static
# ancla el "start" al momento del primer apply y no se vuelve a mover (a
# diferencia de timestamp()); time_rotating hace lo mismo para el "expiry",
# pero SÍ avanza cuando se cumple rotation_years — así el SAS es estable
# mientras es válido y se recalcula solo cuando corresponde renovarlo.
resource "time_static" "sas_start" {}

resource "time_rotating" "sas_reference" {
  rotation_years = var.sas_validity_years
}

data "azurerm_storage_account_blob_container_sas" "backups" {
  connection_string = var.storage_account_primary_connection_string
  container_name    = var.storage_container_name
  https_only        = true

  start  = time_static.sas_start.rfc3339
  expiry = time_rotating.sas_reference.rotation_rfc3339

  permissions {
    read   = true
    write  = true
    delete = true
    list   = true
    add    = true
    create = true
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Variables de Automation (Fase 7.1)
# ─────────────────────────────────────────────────────────────────────────────

resource "azurerm_automation_variable_string" "mysql_host" {
  name                    = "MYSQL_HOST"
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  value                   = var.mysql_fqdn
  encrypted               = true
}

resource "azurerm_automation_variable_string" "mysql_user" {
  name                    = "MYSQL_USER"
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  value                   = var.mysql_admin_login
  encrypted               = true
}

resource "azurerm_automation_variable_string" "mysql_pass" {
  name                    = "MYSQL_PASS"
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  value                   = var.mysql_admin_password
  encrypted               = true
}

resource "azurerm_automation_variable_string" "storage_account_name" {
  name                    = "STORAGE_ACCOUNT_NAME"
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  value                   = var.storage_account_name
  encrypted               = true
}

resource "azurerm_automation_variable_string" "storage_sas_token" {
  name                    = "STORAGE_SAS_TOKEN"
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  value                   = data.azurerm_storage_account_blob_container_sas.backups.sas
  encrypted               = true
}

resource "azurerm_automation_variable_string" "teams_webhook_url" {
  name                    = "TEAMS_WEBHOOK_URL"
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  value                   = var.teams_webhook_url
  encrypted               = true
}

resource "azurerm_automation_variable_string" "alert_webhook_url" {
  name                    = "ALERT_WEBHOOK_URL"
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  # El trigger HTTP de la Logic App expone su URL de invocación como output
  # del template ARM (listCallbackUrl) — no hace falta copiarla a mano desde
  # el Portal (Fase 6.2).
  value     = local.logic_app_alerts_outputs.triggerUrl.value
  encrypted = true
}

# ─────────────────────────────────────────────────────────────────────────────
# Runbooks (Fase 8). Contenido == el del manual, con las rutas de
# herramientas, el path temporal y la lista de bases de datos parametrizados
# por variable en vez de hardcodeados — así una VM re-configurada (Fase 4) o
# un cambio en las bases a respaldar es un `terraform apply`, no editar el
# runbook a mano en el Portal.
# ─────────────────────────────────────────────────────────────────────────────

resource "azurerm_automation_runbook" "worker" {
  name                    = "Backup-MySQL-Smart"
  location                = var.location
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  runbook_type            = "PowerShell72"
  log_progress            = true
  log_verbose             = true
  tags                    = var.tags

  content = <<-PS1
    <#
    .DESCRIPTION
    Runbook Worker: ejecuta mysqldump, comprime con gzip y sube a Blob Storage
    usando SAS Token. Organiza los archivos en estructura jerárquica
    (db/frecuencia/archivo). Generado desde Terraform — ver
    infra/terraform/modules/mysql_backup/main.tf, no editar a mano en el Portal.
    #>

    $toolPath_MysqlDump = "${var.vm_tool_path_mysqldump}"
    $toolPath_Gzip = "${var.vm_tool_path_gzip}"
    $toolPath_AzCopy = "${var.vm_tool_path_azcopy}"
    $localTempPath = "${var.vm_local_temp_path}"

    $mysqlHost = Get-AutomationVariable -Name "MYSQL_HOST"
    $mysqlUser = Get-AutomationVariable -Name "MYSQL_USER"
    $mysqlPass = Get-AutomationVariable -Name "MYSQL_PASS"
    $storageAccount = Get-AutomationVariable -Name "STORAGE_ACCOUNT_NAME"
    $sasToken = Get-AutomationVariable -Name "STORAGE_SAS_TOKEN"
    $containerName = "${var.storage_container_name}"

    # Una variable de Automation vacia no da error: se interpola como cadena
    # vacia y el backup "funciona" contra una URL invalida. El 2026-08-22 un
    # apply recreo STORAGE_ACCOUNT_NAME (paso a encrypted) y la dejo sin valor:
    # el dump siguio saliendo bien y azcopy subio a https://.blob.core.windows.net
    # durante 21 dias. Se chequea antes de tocar la base.
    $requeridas = @{
      MYSQL_HOST           = $mysqlHost
      MYSQL_USER           = $mysqlUser
      MYSQL_PASS           = $mysqlPass
      STORAGE_ACCOUNT_NAME = $storageAccount
      STORAGE_SAS_TOKEN    = $sasToken
    }
    $vacias = @($requeridas.GetEnumerator() | Where-Object { [string]::IsNullOrWhiteSpace("$($_.Value)") } | ForEach-Object { $_.Key })
    if ($vacias.Count -gt 0) {
      throw "Variables de Automation vacias: $($vacias -join ', '). Revisar el Automation Account: un apply que recrea una variable encriptada la deja sin valor."
    }

    $databases = @(${join(", ", [for db in var.mysql_database_names : "\"${db}\""])})

    $now = Get-Date
    $dateStr = $now.ToString("yyyy-MM-dd_HHmm")
    $dayOfMonth = $now.Day
    $monthOfYear = $now.Month

    if (!(Test-Path $localTempPath)) { New-Item -ItemType Directory -Path $localTempPath | Out-Null }

    Write-Output "Configurando entorno seguro para MySQL..."
    $env:MYSQL_PWD = $mysqlPass
    $fallos = @()

    foreach ($db in $databases) {
      Write-Output "--- Iniciando backup para base de datos: $db ---"
      $fileName = "$${db}_$${dateStr}.sql.gz"
      $localFilePath = Join-Path $localTempPath $fileName

      $dumpCommand = "`"$toolPath_MysqlDump`" -h $mysqlHost -u $mysqlUser --single-transaction --quick --routines --triggers --ssl-mode=REQUIRED $db | `"$toolPath_Gzip`" > `"$localFilePath`""
      Write-Output "Ejecutando dump y compresión..."
      cmd /c $dumpCommand

      if (!(Test-Path $localFilePath) -or (Get-Item $localFilePath).Length -eq 0) {
        $fallos += "dump de $${db}: no se genero o quedo vacio"
        Write-Warning "FALLO: El archivo de backup no se generó correctamente para $db."
        if (Test-Path $localFilePath) { Remove-Item $localFilePath -Force }
        continue
      }

      $fileSize = (Get-Item $localFilePath).Length / 1MB
      Write-Output "Dump generado exitosamente: $fileName ($([math]::Round($fileSize, 2)) MB)"

      $destinations = @()
      $dbBaseUrl = "https://$storageAccount.blob.core.windows.net/$containerName/$db"
      $destinations += "$dbBaseUrl/daily/$fileName$sasToken"
      if ($dayOfMonth -eq 1) { $destinations += "$dbBaseUrl/monthly/$fileName$sasToken" }
      if ($dayOfMonth -eq 1 -and $monthOfYear -eq 1) { $destinations += "$dbBaseUrl/yearly/$fileName$sasToken" }

      foreach ($destUrl in $destinations) {
        $logUrl = $destUrl.Substring(0, $destUrl.IndexOf('?'))
        Write-Output "Iniciando subida con AzCopy (SAS) a: $logUrl"
        $azCopyArgs = "copy `"$localFilePath`" `"$destUrl`" --overwrite=true --log-level=ERROR"
        $uploadProcess = Start-Process -FilePath $toolPath_AzCopy -ArgumentList $azCopyArgs -Wait -PassThru -NoNewWindow

        if ($uploadProcess.ExitCode -ne 0) {
          $fallos += "$${logUrl}: azcopy exit $($uploadProcess.ExitCode)"
          Write-Warning "Error subiendo a Blob Storage. Exit Code: $($uploadProcess.ExitCode). Verifica el SAS Token."
        } else {
          Write-Output "Subida completada OK."
        }
      }

      Remove-Item $localFilePath -Force
      Write-Output "Finalizado para $db."
      Write-Output "------------------------------------"
    }

    $env:MYSQL_PWD = $null

    # Sin este throw el job termina en "Completed" aunque no se haya subido
    # nada: Write-Error es non-terminating. El orquestador decide si alertar
    # mirando el estado terminal del hijo, asi que 19 fallos seguidos de
    # azcopy no dispararon una sola alerta.
    if ($fallos.Count -gt 0) {
      throw "El ciclo de backup termino con $($fallos.Count) fallo(s): $($fallos -join ' | ')"
    }
    Write-Output "Ciclo finalizado."
  PS1

  # El provider lee `runbook_type` como "PowerShell" aunque Azure lo tenga en
  # "PowerShell72", y el atributo es ForceNew: sin esto los dos runbooks se
  # destruyen y se recrean en cada apply, para siempre.
  #
  # Verificado el 2026-08-22: ARM (api 2023-11-01) devuelve
  # `"runbookType": "PowerShell72"` para Backup-MySQL-Smart y para
  # Orchestrator-Start-Backup-Stop, mientras el state guarda "PowerShell" en los
  # dos — tanto en el importado como en el creado por Terraform. Es la lectura
  # del provider, no Azure ni el import.
  #
  # Corolario: el runtime real ES 7.2, así que los
  # `azurerm_automation_powershell72_module` (Az.Accounts, Az.Compute,
  # Az.Automation) son los módulos correctos y los backups no están corriendo
  # sobre PS 5.1. Cambiar el tipo a mano acá no va a tener efecto mientras esté
  # ignorado: hay que quitar el ignore o recrear el runbook aparte.
  # `tags` también se ignora (agregado 2026-09-02). `ignore_changes` evita que
  # un atributo DISPARE el update, pero no que su valor VIAJE cuando otro
  # atributo lo dispara: el apply del 2026-09-02 quiso normalizar
  # `Environment` de "prod" a "PROD" y el update se llevó puesto el
  # `runbook_type` que el provider lee mal, con
  #   400 BadRequest: "Runbook Type cannot be modified."
  # dejando el apply en rojo con todo lo demás ya aplicado.
  #
  # Los runbooks quedan fuera de la gestión de etiquetas de Terraform. Es un
  # costo aceptable: ya están etiquetados correctamente a mano y lo único
  # pendiente era la diferencia de mayúsculas. La alternativa —recrearlos para
  # que el state quede con el tipo real— interrumpe los backups.
  lifecycle {
    # `content` TAMBIEN se ignora (2026-09-04).
    #
    # El comentario de arriba descarto esta opcion --"convierte este heredoc en
    # documentacion y no en la fuente de verdad"-- y el argumento sigue siendo
    # cierto. Lo que cambio es el costo del otro lado.
    #
    # El provider nunca lee `content` de vuelta, asi que SIEMPRE hay un update
    # pendiente sobre el runbook. Ese update arrastra el `runbook_type` que el
    # provider lee mal, y Azure lo rechaza con
    #   400 BadRequest: "Runbook Type cannot be modified."
    # Reimportar no lo arregla: verificado el 2026-09-04, el state vuelve a
    # quedar en "PowerShell" --es la lectura del provider, no el import--.
    # Recrear el runbook tampoco, por lo mismo, y ademas corta los backups.
    #
    # O sea que no era ruido en el plan: era un apply en rojo, siempre, para
    # todo el stamp. El apply del 2026-09-04 --que solo agregaba dos variables
    # de entorno para Azure Lighthouse, sin relacion con los backups-- murio
    # aca. Un modulo que no se puede aplicar bloquea a todos los demas.
    #
    # El heredoc sigue versionado y revisable; lo que deja de hacer es
    # publicarse solo. Cambiar el script pasa a requerir el publish
    # out-of-band, que es lo que en la practica ya se venia haciendo.
    ignore_changes = [runbook_type, tags, content]
  }
}

resource "azurerm_automation_runbook" "orchestrator" {
  name                    = "Orchestrator-Start-Backup-Stop"
  location                = var.location
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  runbook_type            = "PowerShell72"
  log_progress            = true
  log_verbose             = true
  tags                    = var.tags

  content = <<-PS1
    <#
    .DESCRIPTION
    Orquestador: prende la VM, dispara el runbook Worker en el Hybrid Worker,
    monitorea por polling hasta que termine, y apaga la VM. Alerta por Logic
    App si algo falla. Generado desde Terraform — ver
    infra/terraform/modules/mysql_backup/main.tf, no editar a mano en el Portal.
    #>

    $ResourceGroupName = "${azurerm_resource_group.this.name}"
    $AutomationAccountName = "${azurerm_automation_account.this.name}"
    $VMName = "${azurerm_windows_virtual_machine.this.name}"
    $HybridWorkerGroup = "${azurerm_automation_hybrid_runbook_worker_group.this.name}"
    $BackupRunbookName = "${azurerm_automation_runbook.worker.name}"
    $SubscriptionId = "${data.azurerm_client_config.current.subscription_id}"
    $TimeoutMinutes = ${var.orchestrator_timeout_minutes}
    $WorkerReadyMinutes = ${var.hybrid_worker_ready_minutes}

    # ── Token de la identidad administrada, sin módulos Az ─────────────────
    #
    # Automation inyecta IDENTITY_ENDPOINT / IDENTITY_HEADER en el sandbox. Pedir
    # el token por ahí funciona aunque la carga de módulos haya fallado por
    # completo, que es el escenario para el que existe el apagado de respaldo.
    function Get-TokenARM {
      if (-not $env:IDENTITY_ENDPOINT -or -not $env:IDENTITY_HEADER) {
        throw "El sandbox no expone IDENTITY_ENDPOINT/IDENTITY_HEADER."
      }
      $r = Invoke-RestMethod -Method Post -Uri $env:IDENTITY_ENDPOINT `
        -Headers @{ "X-IDENTITY-HEADER" = $env:IDENTITY_HEADER; "Metadata" = "True" } `
        -ContentType "application/x-www-form-urlencoded" `
        -Body @{ resource = "https://management.azure.com/" } -ErrorAction Stop
      return $r.access_token
    }

    # ── Esperar a que el Hybrid Worker esté haciendo polling ────────────────
    #
    # Antes acá había un `Start-Sleep -Seconds 300` a ciegas. A veces alcanzaba y
    # a veces no: el 2026-09-03 el ciclo de las 22:38 funcionó y el de las 23:00
    # dejó el hijo en "Suspended" con "the Hybrid Worker could not process it",
    # porque tras el arranque en frío el agente todavía no se había registrado.
    # Es una carrera, no un tiempo mal elegido -- por eso se verifica en vez de
    # esperar.
    #
    # `lastSeenDateTime` avanza en cada poll del agente. Si la marca es reciente,
    # el worker está vivo AHORA; si la VM estuvo apagada, queda congelada en el
    # último poll de la corrida anterior y la comparación contra el reloj lo
    # detecta.
    function Wait-WorkerListo {
      param([string]$Subscription, [string]$ResourceGroup, [string]$Cuenta, [string]$Grupo, [int]$MaxMinutos)
      $limite = (Get-Date).AddMinutes($MaxMinutos)
      $uri = "https://management.azure.com/subscriptions/$Subscription/resourceGroups/$ResourceGroup/providers/Microsoft.Automation/automationAccounts/$Cuenta/hybridRunbookWorkerGroups/$Grupo/hybridRunbookWorkers?api-version=2023-11-01"
      while ((Get-Date) -lt $limite) {
        try {
          $resp = Invoke-RestMethod -Method Get -Uri $uri `
            -Headers @{ Authorization = "Bearer $(Get-TokenARM)" } -ErrorAction Stop
          foreach ($w in $resp.value) {
            $visto = $w.properties.lastSeenDateTime
            if ($visto) {
              $edad = ((Get-Date).ToUniversalTime() - ([datetime]$visto).ToUniversalTime()).TotalSeconds
              # 180s: el agente reporta cada pocas decenas de segundos, así que
              # una marca de hace menos de tres minutos significa que está
              # haciendo polling ahora y puede tomar el trabajo.
              if ($edad -lt 180) {
                Write-Output ">>> Worker listo (ultimo poll hace $([math]::Round($edad))s)."
                return $true
              }
            }
          }
          Write-Output "Worker todavia sin reportarse; reintentando en 20s..."
        } catch {
          Write-Warning "No se pudo consultar el estado del worker ($_). Reintentando."
        }
        Start-Sleep -Seconds 20
      }
      return $false
    }

    # ── Apagado de la VM sin depender de ningún módulo Az ───────────────────
    #
    # El `finally` de antes llamaba a Stop-AzVM con -ErrorAction
    # SilentlyContinue. Si Az.Compute no estaba cargado --que es justo lo que
    # pasa cuando Azure reinicia el job-- el apagado fallaba EN SILENCIO y la VM
    # quedaba prendida facturando sin que nada avisara. Es el único punto de
    # este runbook donde una falla cuesta dinero.
    #
    # Esta función pide el token a la identidad administrada por su endpoint
    # HTTP (IDENTITY_ENDPOINT / IDENTITY_HEADER, que Automation inyecta en el
    # sandbox) y llama a la API de Compute con Invoke-RestMethod. No necesita
    # Az.Accounts ni Az.Compute: funciona incluso si la carga de módulos falló
    # por completo.
    function Stop-VMSinModulos {
      param([string]$Subscription, [string]$ResourceGroup, [string]$Name)
      try {
        $token = Get-TokenARM

        # deallocate y no powerOff: apagada-pero-asignada sigue facturando el
        # cómputo, que es exactamente lo que este runbook existe para evitar.
        $uri = "https://management.azure.com/subscriptions/$Subscription/resourceGroups/$ResourceGroup/providers/Microsoft.Compute/virtualMachines/$Name/deallocate?api-version=2024-07-01"
        $null = Invoke-RestMethod -Method Post -Uri $uri `
          -Headers @{ Authorization = "Bearer $token" } -ErrorAction Stop
        Write-Output ">>> Apagado solicitado por REST (sin módulos Az)."
        return $true
      } catch {
        Write-Warning "FALLO EL APAGADO POR REST. Detalles: $_"
        return $false
      }
    }

    function Send-Alert {
      param([string]$Subject, [string]$ErrorMessage, [string]$SourceRunbook)
      try {
        $webhookUrlVar = Get-AutomationVariable -Name "ALERT_WEBHOOK_URL" -ErrorAction Stop
        $webhookUrl = if ($webhookUrlVar.GetType().Name -eq "AutomationVariable") { $webhookUrlVar.Value } else { $webhookUrlVar }
        if ([string]::IsNullOrEmpty($webhookUrl)) { throw "Variable ALERT_WEBHOOK_URL vacía." }

        Write-Output ">>> INTENTANDO ENVIAR ALERTA A LOGIC APP..."
        $payloadData = @{ Subject = "ERROR CRÍTICO: $Subject"; RunbookName = $SourceRunbook; ErrorMessage = $ErrorMessage }
        $jsonString = $payloadData | ConvertTo-Json -Depth 5
        $utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonString)
        Invoke-RestMethod -Uri $webhookUrl -Method Post -Body $utf8Bytes -ContentType "application/json; charset=utf-8" -ErrorAction Stop
        Write-Output ">>> ALERTA ENVIADA CORRECTAMENTE."
      } catch {
        Write-Warning "FALLO AL ENVIAR ALERTA. Detalles: $_"
      }

      # Teams (flow de Power Automate), en un try/catch propio a proposito: si
      # el POST al Logic App se cae, el aviso a Teams tiene que salir igual, y
      # al reves. Ningun canal de alerta puede voltear el runbook, por eso los
      # dos tragan su excepcion.
      try {
        $teamsUrlVar = Get-AutomationVariable -Name "TEAMS_WEBHOOK_URL" -ErrorAction Stop
        $teamsUrl = if ($teamsUrlVar.GetType().Name -eq "AutomationVariable") { $teamsUrlVar.Value } else { $teamsUrlVar }
        if ([string]::IsNullOrWhiteSpace("$teamsUrl")) { throw "Variable TEAMS_WEBHOOK_URL vacia." }

        Write-Output ">>> INTENTANDO ENVIAR ALERTA A TEAMS..."
        # Se mandan las dos formas: `text` para un flow que postea directo al
        # canal, y los campos sueltos para uno que arme la tarjeta. Un flow de
        # Power Automate ignora las propiedades que no usa.
        $teamsPayload = @{
          text         = "**Backup MySQL FinOps - $Subject**`n`nRunbook: $SourceRunbook`n`n$ErrorMessage"
          Subject      = "ERROR CRITICO: $Subject"
          RunbookName  = $SourceRunbook
          ErrorMessage = $ErrorMessage
        } | ConvertTo-Json -Depth 5
        $teamsBytes = [System.Text.Encoding]::UTF8.GetBytes($teamsPayload)
        Invoke-RestMethod -Uri $teamsUrl -Method Post -Body $teamsBytes -ContentType "application/json; charset=utf-8" -ErrorAction Stop
        Write-Output ">>> ALERTA ENVIADA A TEAMS."
      } catch {
        Write-Warning "FALLO AL ENVIAR ALERTA A TEAMS. Detalles: $_"
      }
    }

    try {
      # Los módulos se importan y se verifican ANTES de tocar nada.
      #
      # Antes el runbook llamaba a Connect-AzAccount directo, y cuando la carga
      # de módulos fallaba el error era "The term 'Connect-AzAccount' is not
      # recognized" en la mitad del log: un mensaje que no dice qué pasó ni
      # dónde mirar. Peor, seguía hasta el `finally`, donde Stop-AzVM tampoco
      # existía. Verificar acá convierte eso en una falla clara y temprana.
      Write-Output "Cargando módulos Az del runtime PowerShell 7.2..."
      Import-Module Az.Accounts, Az.Compute, Az.Automation -ErrorAction SilentlyContinue
      $faltantes = @("Connect-AzAccount", "Start-AzVM", "Stop-AzVM", "Start-AzAutomationRunbook", "Get-AzAutomationJob") |
        Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) }
      if ($faltantes.Count -gt 0) {
        throw "MODULOS AZ NO DISPONIBLES en el sandbox. Faltan: $($faltantes -join ', '). Los módulos del runtime PowerShell 7.2 se importan por separado de los de 5.1 (ver azurerm_automation_powershell72_module en el Terraform). La VM se apaga por REST igual."
      }
      Write-Output "Módulos verificados."

      Write-Output "Autenticando con Azure..."
      $null = Connect-AzAccount -Identity -ErrorAction Stop
      Write-Output "Autenticación exitosa."

      Write-Output "--- FASE 1: Encendiendo VM ($VMName) ---"
      Start-AzVM -Name $VMName -ResourceGroupName $ResourceGroupName -Verbose -ErrorAction Stop
      Write-Output "VM encendida. Esperando a que el Hybrid Worker haga polling (tope $WorkerReadyMinutes min)..."
      if (-not (Wait-WorkerListo -Subscription $SubscriptionId -ResourceGroup $ResourceGroupName `
            -Cuenta $AutomationAccountName -Grupo $HybridWorkerGroup -MaxMinutos $WorkerReadyMinutes)) {
        # Falla acá y no al disparar: un hijo lanzado contra un worker que no
        # hace polling queda en "Suspended" y el mensaje de Azure no dice que el
        # problema fue el arranque de la VM.
        throw "El Hybrid Worker del grupo '$HybridWorkerGroup' no volvio a hacer polling en $WorkerReadyMinutes minutos despues de encender la VM. No se dispara el backup: quedaria suspendido."
      }

      # Idempotencia: Azure puede REINICIAR este runbook desde cero (es lo que
      # pasó el 2026-08-22). Si un reinicio dispara otro backup, quedan dos
      # mysqldump peleando por la misma VM y el mismo destino. Si ya hay un job
      # del worker corriendo, se engancha a ése en vez de lanzar otro.
      Write-Output "--- FASE 2: Runbook hijo '$BackupRunbookName' ---"
      $enCurso = Get-AzAutomationJob -ResourceGroupName $ResourceGroupName `
        -AutomationAccountName $AutomationAccountName `
        -RunbookName $BackupRunbookName -ErrorAction SilentlyContinue |
        Where-Object { $_.Status -in @("New", "Activating", "Running", "Queued") } |
        Sort-Object -Property CreationTime -Descending | Select-Object -First 1

      if ($enCurso) {
        $jobId = $enCurso.JobId
        Write-Output "Ya hay un job del worker en curso ($jobId, estado '$($enCurso.Status)'). Me engancho a ése en vez de lanzar otro."
      } else {
        $initialLaunch = Start-AzAutomationRunbook -AutomationAccountName $AutomationAccountName `
          -ResourceGroupName $ResourceGroupName `
          -RunbookName $BackupRunbookName `
          -RunOn $HybridWorkerGroup `
          -Verbose -ErrorAction Stop
        $jobId = $initialLaunch.JobId
        if (-not $jobId) { throw "Start-AzAutomationRunbook no devolvió un JobId; no hay nada que monitorear." }
        Write-Output "Trabajo iniciado. Job ID: $jobId."
      }

      # Polling CON TOPE. Sin tope, un hijo que no llega a estado terminal deja
      # este job vivo hasta que Azure lo descarga por fair share (3 h) y lo
      # reinicia desde cero. El 2026-08-22 eso dejó un job en "Running" 12 días,
      # imposible de detener desde el portal.
      $terminalStates = @("completed", "failed", "stopped", "suspended")
      $limite = (Get-Date).AddMinutes($TimeoutMinutes)
      $currentStatusStr = ""
      $vencido = $false
      Write-Output "Monitoreando hasta $($limite.ToString('u')) (tope de $TimeoutMinutes min)..."

      do {
        Start-Sleep -Seconds 30
        $currentJobInfo = Get-AzAutomationJob -Id $jobId -ResourceGroupName $ResourceGroupName -AutomationAccountName $AutomationAccountName -ErrorAction Stop
        $currentStatusStr = "$($currentJobInfo.Status)".ToLower()
        Write-Output "Estado actual en VM: '$($currentJobInfo.Status)'..."
        if ((Get-Date) -ge $limite) { $vencido = $true }
      } while (($terminalStates -notcontains $currentStatusStr) -and (-not $vencido))

      if ($vencido -and ($terminalStates -notcontains $currentStatusStr)) {
        # Se corta el hijo a propósito antes de apagar la VM: apagarla con el
        # mysqldump a mitad de camino deja un backup truncado, que es peor que
        # no tener backup porque parece uno válido.
        Write-Warning "Tope de $TimeoutMinutes min alcanzado con el job en '$currentStatusStr'. Deteniendo el job del worker."
        Stop-AzAutomationJob -Id $jobId -ResourceGroupName $ResourceGroupName -AutomationAccountName $AutomationAccountName -ErrorAction SilentlyContinue
        throw "El backup excedió el tope de $TimeoutMinutes minutos (último estado: '$currentStatusStr'). Job detenido y VM apagada; el backup de este ciclo NO se completó."
      }

      if ($currentStatusStr -eq "completed") {
        Write-Output "ÉXITO FINAL: El trabajo de backup terminó correctamente."
      } else {
        throw "El trabajo en la VM falló o se detuvo. Estado final: '$($currentJobInfo.Status)'."
      }
    } catch {
      $errorDetails = ($_.Exception.Message).ToString()
      Write-Error "ERROR CRÍTICO EN EL ORQUESTADOR. Detalles: $errorDetails"

      $subject = "Fallo General en el Orquestador"
      if ($errorDetails -like "*ResourceNotFound*") { $subject = "Fallo: VM no encontrada" }
      elseif ($errorDetails -like "*El trabajo en la VM falló*") { $subject = "Fallo en el Backup (Worker VM)" }

      Send-Alert -Subject $subject -ErrorMessage $errorDetails -SourceRunbook "Orchestrator"
    } finally {
      # FASE 3: apagar la VM SIEMPRE, y sin asumir que hay módulos cargados.
      #
      # Se intenta primero con Stop-AzVM porque devuelve un error accionable si
      # el problema es de permisos; si el cmdlet no existe --el caso del
      # reinicio-- se cae al apagado por REST, que sólo necesita la identidad
      # administrada. Antes esto era un único Stop-AzVM con
      # -ErrorAction SilentlyContinue: fallaba mudo y la VM quedaba facturando.
      Write-Output "--- FASE 3: Asegurando apagado de VM..."
      $apagada = $false
      if (Get-Command Stop-AzVM -ErrorAction SilentlyContinue) {
        try {
          Stop-AzVM -Name $VMName -ResourceGroupName $ResourceGroupName -Force -NoWait -ErrorAction Stop
          Write-Output ">>> Apagado solicitado con Stop-AzVM."
          $apagada = $true
        } catch {
          Write-Warning "Stop-AzVM falló ($_). Reintentando por REST."
        }
      } else {
        Write-Warning "Stop-AzVM no está disponible en este sandbox. Apagando por REST."
      }

      if (-not $apagada) {
        $apagada = Stop-VMSinModulos -Subscription $SubscriptionId -ResourceGroup $ResourceGroupName -Name $VMName
      }

      if (-not $apagada) {
        # Los dos caminos fallaron: la VM puede haber quedado prendida. Esto
        # cuesta dinero por hora, así que tiene que salir por la alerta y no
        # sólo quedar en el log del job.
        Write-Error "NO SE PUDO APAGAR LA VM '$VMName' por ninguna vía. Revisar a mano: puede estar facturando."
        Send-Alert -Subject "VM de backup posiblemente encendida" `
          -ErrorMessage "Fallaron Stop-AzVM y el apagado por REST para '$VMName' en '$ResourceGroupName'. Verificar el estado de la VM: si quedó Running, está facturando." `
          -SourceRunbook "Orchestrator"
      }
      Write-Output "Fin."
    }
  PS1

  depends_on = [
    azurerm_automation_powershell72_module.az_accounts,
    azurerm_automation_powershell72_module.az_compute,
    azurerm_automation_powershell72_module.az_automation,
  ]

  # Mismo caso que en `worker`: ver el comentario de su bloque `lifecycle`.
  # `tags` también se ignora (agregado 2026-09-02). `ignore_changes` evita que
  # un atributo DISPARE el update, pero no que su valor VIAJE cuando otro
  # atributo lo dispara: el apply del 2026-09-02 quiso normalizar
  # `Environment` de "prod" a "PROD" y el update se llevó puesto el
  # `runbook_type` que el provider lee mal, con
  #   400 BadRequest: "Runbook Type cannot be modified."
  # dejando el apply en rojo con todo lo demás ya aplicado.
  #
  # Los runbooks quedan fuera de la gestión de etiquetas de Terraform. Es un
  # costo aceptable: ya están etiquetados correctamente a mano y lo único
  # pendiente era la diferencia de mayúsculas.
  #
  # ADENDA 2026-09-03 — el `content` tampoco se puede actualizar por Terraform.
  #
  # Un cambio de `content` DISPARA el update, y ahí viaja el `runbook_type` mal
  # leído: mismo 400 "Runbook Type cannot be modified", ahora sin que haya
  # etiquetas de por medio. Confirmado en el apply de las 21:14.
  #
  # El contenido se publicó por el endpoint propio de la API
  # (PUT .../runbooks/{name}/draft/content + POST .../publish), que no manda el
  # tipo. Verificado byte por byte contra lo que renderiza este heredoc.
  #
  # PERO ESO DEJA EL PLAN EN ROJO PARA SIEMPRE: el provider no vuelve a leer el
  # `content` desde Azure, así que un refresh NO reconcilia una publicación
  # hecha por fuera. El state se quedó con el contenido del último apply
  # exitoso, y cada plan va a querer actualizarlo y a fallar con el mismo 400.
  # Se descartó por eliminación: todos los demás atributos —logProgress,
  # logVerbose, description, tags, runbookType— coinciden con Azure.
  #
  # Para cerrarlo hay dos caminos, ninguno gratis:
  #  - recrear el runbook (`-replace`): en el create el provider manda el
  #    `content` de la config, así que el state queda sincronizado y los planes
  #    salen limpios hasta el próximo cambio. Hay que hacerlo con el schedule
  #    del orquestador deshabilitado para no cortar un backup en curso.
  #  - agregar `content` a este `ignore_changes`: saca el ruido del plan, pero
  #    convierte este heredoc en documentación y no en la fuente de verdad.
  lifecycle {
    # `content` TAMBIEN se ignora (2026-09-04).
    #
    # El comentario de arriba descarto esta opcion --"convierte este heredoc en
    # documentacion y no en la fuente de verdad"-- y el argumento sigue siendo
    # cierto. Lo que cambio es el costo del otro lado.
    #
    # El provider nunca lee `content` de vuelta, asi que SIEMPRE hay un update
    # pendiente sobre el runbook. Ese update arrastra el `runbook_type` que el
    # provider lee mal, y Azure lo rechaza con
    #   400 BadRequest: "Runbook Type cannot be modified."
    # Reimportar no lo arregla: verificado el 2026-09-04, el state vuelve a
    # quedar en "PowerShell" --es la lectura del provider, no el import--.
    # Recrear el runbook tampoco, por lo mismo, y ademas corta los backups.
    #
    # O sea que no era ruido en el plan: era un apply en rojo, siempre, para
    # todo el stamp. El apply del 2026-09-04 --que solo agregaba dos variables
    # de entorno para Azure Lighthouse, sin relacion con los backups-- murio
    # aca. Un modulo que no se puede aplicar bloquea a todos los demas.
    #
    # El heredoc sigue versionado y revisable; lo que deja de hacer es
    # publicarse solo. Cambiar el script pasa a requerir el publish
    # out-of-band, que es lo que en la practica ya se venia haciendo.
    ignore_changes = [runbook_type, tags, content]
  }
}

resource "azurerm_automation_schedule" "daily" {
  name                    = "daily-backup"
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  frequency               = "Day"
  interval                = 1
  timezone                = var.schedule_timezone
  start_time              = var.schedule_start_time

  # `start_time` SOLO importa al crear el schedule.
  #
  # Azure lo adelanta solo: es un schedule diario, asi que despues de cada
  # corrida `startTime` pasa a la proxima ocurrencia. Terraform veia eso como
  # drift y trataba de devolverlo al valor de la config --2026-08-01 09:00--,
  # que Azure rechaza porque exige al menos 5 minutos en el futuro:
  #
  #   `start_time` is "2026-08-01 09:00:00 -0300" and should be at least "5m0s"
  #   in the future
  #
  # Es un empate permanente: Azure adelanta, Terraform retrocede, Azure
  # rechaza. Cualquier apply sobre este stamp fallaba, tocara o no el backup
  # --fue lo que bloqueo el apply del 2026-09-04, que solo agregaba dos
  # variables de entorno--.
  #
  # OJO: con esto, cambiar el horario editando `schedule_start_time` no tiene
  # efecto. Para moverlo hay que recrear el schedule
  # (`-replace=module.mysql_backup[0].azurerm_automation_schedule.daily`), y
  # conviene revisar despues que el job_schedule que lo ata al orquestador siga
  # en pie: un replace anterior se lo llevo puesto.
  lifecycle {
    ignore_changes = [start_time]
  }
}

resource "azurerm_automation_job_schedule" "daily" {
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  schedule_name           = azurerm_automation_schedule.daily.name
  runbook_name            = azurerm_automation_runbook.orchestrator.name
}

# ─────────────────────────────────────────────────────────────────────────────
# Alertas (Fase 6) — Logic App con trigger HTTP + envío por Office 365.
#
# LA CONEXIÓN DE OFFICE 365 NO SE PUEDE AUTOMATIZAR CON TERRAFORM: la
# autorización OAuth exige un login interactivo del usuario (Microsoft no
# expone esa parte como API). Terraform deja la conexión CREADA pero SIN
# AUTORIZAR — after el apply, un paso manual único:
#   Portal → Resource Group → api-connection-office365 → "Editar API
#   connection" → Autorizar → iniciar sesión con la cuenta que va a enviar
#   los mails de alerta.
# Sin ese paso, la Logic App existe y el trigger funciona, pero el paso de
# "enviar correo" falla con 401 hasta autorizar.
# ─────────────────────────────────────────────────────────────────────────────

resource "azurerm_api_connection" "office365" {
  name                = "api-connection-office365"
  resource_group_name = azurerm_resource_group.this.name
  managed_api_id      = "/subscriptions/${data.azurerm_client_config.current.subscription_id}/providers/Microsoft.Web/locations/${var.location}/managedApis/office365"
  display_name        = "Office 365 Outlook — alertas de backup MySQL"
  tags                = var.tags
}

data "azurerm_client_config" "current" {}

# La combinación azurerm_logic_app_workflow + trigger_custom + action_custom
# NUNCA declara el schema de "$connections" dentro de la definición del
# workflow — el argumento `parameters` de azurerm_logic_app_workflow sólo
# pone VALORES en properties.parameters, no la sección
# properties.definition.parameters que el motor de Logic Apps exige para
# cualquier acción de tipo ApiConnection. Confirmado en el primer apply
# (2026-07-30): "Error: no parameter definition for $connections" — falla de
# la API, no del plan. La única forma de declarar esa sección con este
# provider es un template ARM completo.
resource "azurerm_resource_group_template_deployment" "logic_app_alerts" {
  name                = "la-backup-alerts-deploy"
  resource_group_name = azurerm_resource_group.this.name
  deployment_mode     = "Incremental"

  parameters_content = jsonencode({
    connectionId = { value = azurerm_api_connection.office365.id }
  })

  # `String` con mayúscula a propósito, en `parameters` y en `outputs`: ARM
  # normaliza el tipo y devuelve `"String"`, así que escribirlo en minúscula
  # deja el deployment con un diff en sitio que no converge nunca y re-ejecuta
  # el template en cada apply. Los `"string"` de más abajo son del schema del
  # trigger HTTP del workflow — ésos ARM no los toca y quedan como están.
  template_content = jsonencode({
    "$schema"      = "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#"
    contentVersion = "1.0.0.0"
    parameters = {
      connectionId = { type = "String" }
    }
    resources = [
      {
        type       = "Microsoft.Logic/workflows"
        apiVersion = "2019-05-01"
        name       = "la-backup-alerts"
        location   = var.location
        tags       = var.tags
        properties = {
          state = "Enabled"
          definition = {
            "$schema"      = "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#"
            contentVersion = "1.0.0.0"
            parameters = {
              "$connections" = { type = "Object", defaultValue = {} }
            }
            triggers = {
              When_a_HTTP_request_is_received = {
                type = "Request"
                kind = "Http"
                inputs = {
                  schema = {
                    type = "object"
                    properties = {
                      ErrorMessage = { type = "string" }
                      RunbookName  = { type = "string" }
                      Subject      = { type = "string" }
                    }
                  }
                }
              }
            }
            actions = {
              Enviar_correo_electronico_V2 = {
                type = "ApiConnection"
                inputs = {
                  host = {
                    connection = { name = "@parameters('$connections')['office365']['connectionId']" }
                  }
                  method = "post"
                  path   = "/v2/Mail"
                  body = {
                    To         = var.alert_email
                    Subject    = "@triggerBody()?['Subject']"
                    Body       = "<p><b>Runbook:</b> @{triggerBody()?['RunbookName']}</p><p><b>Error:</b> @{triggerBody()?['ErrorMessage']}</p>"
                    Importance = "High"
                  }
                }
                runAfter = {}
              }
            }
            outputs = {}
          }
          parameters = {
            "$connections" = {
              value = {
                office365 = {
                  connectionId   = "[parameters('connectionId')]"
                  connectionName = "office365"
                  id             = "/subscriptions/${data.azurerm_client_config.current.subscription_id}/providers/Microsoft.Web/locations/${var.location}/managedApis/office365"
                }
              }
            }
          }
        }
      }
    ]
    outputs = {
      triggerUrl = {
        type  = "String"
        value = "[listCallbackUrl(resourceId('Microsoft.Logic/workflows/triggers', 'la-backup-alerts', 'When_a_HTTP_request_is_received'), '2019-05-01').value]"
      }
    }
  })
}

locals {
  logic_app_alerts_outputs = jsondecode(azurerm_resource_group_template_deployment.logic_app_alerts.output_content)
}
