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

resource "azurerm_public_ip" "bastion" {
  name                = "${var.resource_group_name}-pip-bastion"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = var.tags
}

resource "azurerm_bastion_host" "this" {
  name                = "${var.resource_group_name}-bastion"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  # Basic alcanza: sólo se usa para RDP puntual de mantenimiento/setup inicial
  # (Fase 4), no para acceso frecuente.
  sku  = "Basic"
  tags = var.tags

  ip_configuration {
    name                 = "bastion-ipconfig"
    subnet_id            = azurerm_subnet.bastion.id
    public_ip_address_id = azurerm_public_ip.bastion.id
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
}

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

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
  }

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
# Start-AzAutomationRunbook, Get-AzAutomationJob). El runtime de PS 7.2 no los
# trae preinstalados como el de PS 5.1 legacy — sin esto el Orquestador falla
# en el primer cmdlet.
resource "azurerm_automation_module" "az_accounts" {
  name                    = "Az.Accounts"
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  module_link {
    uri = "https://www.powershellgallery.com/api/v2/package/Az.Accounts"
  }
}

resource "azurerm_automation_module" "az_compute" {
  name                    = "Az.Compute"
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  module_link {
    uri = "https://www.powershellgallery.com/api/v2/package/Az.Compute"
  }
  depends_on = [azurerm_automation_module.az_accounts]
}

resource "azurerm_automation_module" "az_automation" {
  name                    = "Az.Automation"
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  module_link {
    uri = "https://www.powershellgallery.com/api/v2/package/Az.Automation"
  }
  depends_on = [azurerm_automation_module.az_accounts]
}

resource "azurerm_automation_hybrid_runbook_worker_group" "this" {
  name                    = "hwg-mysql-worker"
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
}

# El registro (esta entrada) es sólo METADATA — lo que realmente convierte a
# la VM en worker es la extensión de abajo. Sin la extensión, esta entrada
# existe pero el runbook Worker nunca tiene dónde ejecutarse ("no hay workers
# disponibles").
resource "azurerm_automation_hybrid_runbook_worker" "this" {
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  worker_group_name       = azurerm_automation_hybrid_runbook_worker_group.this.name
  vm_resource_id          = azurerm_windows_virtual_machine.this.id
  worker_id               = random_uuid.hybrid_worker.result
}

resource "random_uuid" "hybrid_worker" {}

# Patrón "extension-based hybrid worker" (el que usa el asistente del Portal
# desde 2024) — instala el agente en la VM y lo conecta a esta Automation
# Account. PIEZA DE MENOR CONFIANZA DE ESTE MÓDULO: es la combinación de
# recursos menos común de las usadas acá; verificar en el primer apply que la
# extensión llegue a "Succeeded" y que la VM aparezca como worker activo en
# Automation Account → Hybrid Worker Groups.
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

  depends_on = [azurerm_automation_hybrid_runbook_worker_group.this]
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
}

resource "azurerm_automation_variable_string" "mysql_user" {
  name                    = "MYSQL_USER"
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  value                   = var.mysql_admin_login
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
}

resource "azurerm_automation_variable_string" "storage_sas_token" {
  name                    = "STORAGE_SAS_TOKEN"
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  value                   = data.azurerm_storage_account_blob_container_sas.backups.sas
  encrypted               = true
}

resource "azurerm_automation_variable_string" "alert_webhook_url" {
  name                    = "ALERT_WEBHOOK_URL"
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  # El trigger HTTP de la Logic App expone su URL de invocación como atributo
  # del recurso — no hace falta copiarla a mano desde el Portal (Fase 6.2).
  value     = azurerm_logic_app_trigger_custom.alert_http.callback_url
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
  runbook_type            = "PowerShell"
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

    $$toolPath_MysqlDump = "${var.vm_tool_path_mysqldump}"
    $$toolPath_Gzip = "${var.vm_tool_path_gzip}"
    $$toolPath_AzCopy = "${var.vm_tool_path_azcopy}"
    $$localTempPath = "${var.vm_local_temp_path}"

    $$mysqlHost = Get-AutomationVariable -Name "MYSQL_HOST"
    $$mysqlUser = Get-AutomationVariable -Name "MYSQL_USER"
    $$mysqlPass = Get-AutomationVariable -Name "MYSQL_PASS"
    $$storageAccount = Get-AutomationVariable -Name "STORAGE_ACCOUNT_NAME"
    $$sasToken = Get-AutomationVariable -Name "STORAGE_SAS_TOKEN"
    $$containerName = "${var.storage_container_name}"

    $$databases = @(${join(", ", [for db in var.mysql_database_names : "\"${db}\""])})

    $$now = Get-Date
    $$dateStr = $$now.ToString("yyyy-MM-dd_HHmm")
    $$dayOfMonth = $$now.Day
    $$monthOfYear = $$now.Month

    if (!(Test-Path $$localTempPath)) { New-Item -ItemType Directory -Path $$localTempPath | Out-Null }

    Write-Output "Configurando entorno seguro para MySQL..."
    $$env:MYSQL_PWD = $$mysqlPass

    foreach ($$db in $$databases) {
      Write-Output "--- Iniciando backup para base de datos: $$db ---"
      $$fileName = "$${db}_$${dateStr}.sql.gz"
      $$localFilePath = Join-Path $$localTempPath $$fileName

      $$dumpCommand = "`"$$toolPath_MysqlDump`" -h $$mysqlHost -u $$mysqlUser --single-transaction --quick --routines --triggers --ssl-mode=REQUIRED $$db | `"$$toolPath_Gzip`" > `"$$localFilePath`""
      Write-Output "Ejecutando dump y compresión..."
      cmd /c $$dumpCommand

      if (!(Test-Path $$localFilePath) -or (Get-Item $$localFilePath).Length -eq 0) {
        Write-Error "FALLO: El archivo de backup no se generó correctamente para $$db."
        if (Test-Path $$localFilePath) { Remove-Item $$localFilePath -Force }
        continue
      }

      $$fileSize = (Get-Item $$localFilePath).Length / 1MB
      Write-Output "Dump generado exitosamente: $$fileName ($([math]::Round($$fileSize, 2)) MB)"

      $$destinations = @()
      $$dbBaseUrl = "https://$$storageAccount.blob.core.windows.net/$$containerName/$$db"
      $$destinations += "$$dbBaseUrl/daily/$$fileName$$sasToken"
      if ($$dayOfMonth -eq 1) { $$destinations += "$$dbBaseUrl/monthly/$$fileName$$sasToken" }
      if ($$dayOfMonth -eq 1 -and $$monthOfYear -eq 1) { $$destinations += "$$dbBaseUrl/yearly/$$fileName$$sasToken" }

      foreach ($$destUrl in $$destinations) {
        $$logUrl = $$destUrl.Substring(0, $$destUrl.IndexOf('?'))
        Write-Output "Iniciando subida con AzCopy (SAS) a: $$logUrl"
        $$azCopyArgs = "copy `"$$localFilePath`" `"$$destUrl`" --overwrite=true --log-level=ERROR"
        $$uploadProcess = Start-Process -FilePath $$toolPath_AzCopy -ArgumentList $$azCopyArgs -Wait -PassThru -NoNewWindow

        if ($$uploadProcess.ExitCode -ne 0) {
          Write-Error "Error subiendo a Blob Storage. Exit Code: $$($$uploadProcess.ExitCode). Verifica el SAS Token."
        } else {
          Write-Output "Subida completada OK."
        }
      }

      Remove-Item $$localFilePath -Force
      Write-Output "Finalizado para $$db."
      Write-Output "------------------------------------"
    }

    $$env:MYSQL_PWD = $$null
    Write-Output "Ciclo finalizado."
  PS1
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

    $$ResourceGroupName = "${azurerm_resource_group.this.name}"
    $$AutomationAccountName = "${azurerm_automation_account.this.name}"
    $$VMName = "${azurerm_windows_virtual_machine.this.name}"
    $$HybridWorkerGroup = "${azurerm_automation_hybrid_runbook_worker_group.this.name}"
    $$BackupRunbookName = "${azurerm_automation_runbook.worker.name}"

    function Send-Alert {
      param([string]$$Subject, [string]$$ErrorMessage, [string]$$SourceRunbook)
      try {
        $$webhookUrlVar = Get-AutomationVariable -Name "ALERT_WEBHOOK_URL" -ErrorAction Stop
        $$webhookUrl = if ($$webhookUrlVar.GetType().Name -eq "AutomationVariable") { $$webhookUrlVar.Value } else { $$webhookUrlVar }
        if ([string]::IsNullOrEmpty($$webhookUrl)) { throw "Variable ALERT_WEBHOOK_URL vacía." }

        Write-Output ">>> INTENTANDO ENVIAR ALERTA A LOGIC APP..."
        $$payloadData = @{ Subject = "ERROR CRÍTICO: $$Subject"; RunbookName = $$SourceRunbook; ErrorMessage = $$ErrorMessage }
        $$jsonString = $$payloadData | ConvertTo-Json -Depth 5
        $$utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($$jsonString)
        Invoke-RestMethod -Uri $$webhookUrl -Method Post -Body $$utf8Bytes -ContentType "application/json; charset=utf-8" -ErrorAction Stop
        Write-Output ">>> ALERTA ENVIADA CORRECTAMENTE."
      } catch {
        Write-Warning "FALLO AL ENVIAR ALERTA. Detalles: $$_"
      }
    }

    try {
      Write-Output "Autenticando con Azure..."
      $$null = Connect-AzAccount -Identity -ErrorAction Stop
      Write-Output "Autenticación exitosa."

      Write-Output "--- FASE 1: Encendiendo VM ($$VMName) ---"
      Start-AzVM -Name $$VMName -ResourceGroupName $$ResourceGroupName -Verbose -ErrorAction Stop
      Write-Output "VM encendida. Esperando 120s para servicios..."
      Start-Sleep -Seconds 120

      Write-Output "--- FASE 2: Disparando Runbook hijo '$$BackupRunbookName' ---"
      Write-Output "Iniciando trabajo en la VM..."
      $$initialLaunch = Start-AzAutomationRunbook -AutomationAccountName $$AutomationAccountName `
        -ResourceGroupName $$ResourceGroupName `
        -RunbookName $$BackupRunbookName `
        -RunOn $$HybridWorkerGroup `
        -Verbose -ErrorAction Stop

      $$jobId = $$initialLaunch.JobId
      Write-Output "Trabajo iniciado. Job ID: $$jobId. Monitoreando..."

      $$terminalStates = @("completed", "failed", "stopped", "suspended")
      do {
        Start-Sleep -Seconds 30
        $$currentJobInfo = Get-AzAutomationJob -Id $$jobId -ResourceGroupName $$ResourceGroupName -AutomationAccountName $$AutomationAccountName -ErrorAction Stop
        $$currentStatusStr = "$$($$currentJobInfo.Status)".ToLower()
        Write-Output "Estado actual en VM: '$$($$currentJobInfo.Status)'..."
      } while ($$terminalStates -notcontains $$currentStatusStr)

      if ($$currentStatusStr -eq "completed") {
        Write-Output "ÉXITO FINAL: El trabajo de backup terminó correctamente."
      } else {
        throw "El trabajo en la VM falló o se detuvo. Estado final: '$$($$currentJobInfo.Status)'."
      }
    } catch {
      $$errorDetails = ($$_.Exception.Message).ToString()
      Write-Error "ERROR CRÍTICO EN EL ORQUESTADOR. Detalles: $$errorDetails"

      $$subject = "Fallo General en el Orquestador"
      if ($$errorDetails -like "*ResourceNotFound*") { $$subject = "Fallo: VM no encontrada" }
      elseif ($$errorDetails -like "*El trabajo en la VM falló*") { $$subject = "Fallo en el Backup (Worker VM)" }

      Send-Alert -Subject $$subject -ErrorMessage $$errorDetails -SourceRunbook "Orchestrator"
    } finally {
      Write-Output "--- FASE 3: Asegurando apagado de VM..."
      Stop-AzVM -Name $$VMName -ResourceGroupName $$ResourceGroupName -Force -NoWait -ErrorAction SilentlyContinue
      Write-Output "Orden de apagado enviada. Fin."
    }
  PS1

  depends_on = [
    azurerm_automation_module.az_accounts,
    azurerm_automation_module.az_compute,
    azurerm_automation_module.az_automation,
  ]
}

resource "azurerm_automation_schedule" "daily" {
  name                    = "daily-backup"
  resource_group_name     = azurerm_resource_group.this.name
  automation_account_name = azurerm_automation_account.this.name
  frequency               = "Day"
  interval                = 1
  timezone                = var.schedule_timezone
  start_time              = var.schedule_start_time
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

resource "azurerm_logic_app_workflow" "alerts" {
  name                = "la-backup-alerts"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = var.tags

  parameters = {
    "$connections" = jsonencode({
      office365 = {
        connectionId   = azurerm_api_connection.office365.id
        connectionName = azurerm_api_connection.office365.name
        id             = "/subscriptions/${data.azurerm_client_config.current.subscription_id}/providers/Microsoft.Web/locations/${var.location}/managedApis/office365"
      }
    })
  }
}

resource "azurerm_logic_app_trigger_custom" "alert_http" {
  name         = "When_a_HTTP_request_is_received"
  logic_app_id = azurerm_logic_app_workflow.alerts.id

  body = jsonencode({
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
  })
}

resource "azurerm_logic_app_action_custom" "send_alert_email" {
  name         = "Enviar_correo_electronico_V2"
  logic_app_id = azurerm_logic_app_workflow.alerts.id

  body = jsonencode({
    type = "ApiConnection"
    inputs = {
      host = {
        connection = {
          name = "@parameters('$connections')['office365']['connectionId']"
        }
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
  })

  depends_on = [azurerm_logic_app_trigger_custom.alert_http]
}
