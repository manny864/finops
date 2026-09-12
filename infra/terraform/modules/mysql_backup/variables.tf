# Sistema de Backup Automatizado para MySQL Flexible Server.
#
# Adaptado del manual "Manual de Implementación Sistema de Backup Automatizado
# para MySQL Flexible Server (Cross-Subscription)" (v1.0, 09/12/2025) a este
# proyecto. Dos diferencias deliberadas respecto al manual original:
#
#   1. El manual asume que el MySQL objetivo vive en OTRA suscripción (de ahí
#      "Cross-Subscription" en el título) y por eso despliega un Private
#      Endpoint nuevo. Acá el MySQL del SaaS está en la MISMA suscripción y
#      la MISMA VNet que el resto de este proyecto, y esa VNet ya tiene la
#      zona DNS privada de mysql.database.azure.com vinculada — así que no
#      hace falta ningún Private Endpoint nuevo, sólo una subred nueva en la
#      VNet existente. Se sigue usando un Resource Group separado (decisión
#      del usuario, 2026-07-30) para aislar el ciclo de vida de esta solución
#      del resto del stamp.
#   2. El contenedor de destino no es nuevo: `db-backups`, en el Storage
#      Account que ya usa la app, ya estaba reservado para esto — ver el
#      comentario en modules/storage/main.tf.

variable "location" {
  type = string
}

variable "resource_group_name" {
  description = "RG nuevo y dedicado para esta solución (aislado del RG del stamp)."
  type        = string
}

variable "tags" {
  type = map(string)
}

# --- Red: reusa la VNet existente del stamp, agrega 2 subredes nuevas ---

variable "existing_vnet_name" {
  type = string
}

variable "existing_vnet_resource_group_name" {
  description = "Las subredes nuevas se crean acá — Azure exige que vivan en el RG de la VNet, no en resource_group_name de este módulo."
  type        = string
}

variable "vm_subnet_prefix" {
  type = string
}

# Azure Bastion cuesta ~USD 140/mes en SKU Basic, y el presupuesto mensual del
# stamp es 250. El módulo lo declaraba sin condición "para RDP puntual de
# mantenimiento", así que el primer apply se llevaba más de la mitad del
# presupuesto por un acceso que casi no se usa. Queda opt-in y apagado.
# Para una sesión de mantenimiento: poner en true, aplicar, usar, y volver a
# false. Alternativa sin costo fijo: JIT VM access de Defender for Cloud.
variable "bastion_enabled" {
  type    = bool
  default = false
}

variable "bastion_subnet_prefix" {
  type    = string
  default = "10.50.40.0/26" # /26 es el mínimo que exige AzureBastionSubnet
}

# --- VM worker (Windows) ---

variable "vm_size" {
  type    = string
  default = "Standard_D2s_v5"
}

variable "vm_admin_username" {
  type    = string
  default = "backupadmin"
}

# --- MySQL objetivo ---

variable "mysql_fqdn" {
  type = string
}

variable "mysql_admin_login" {
  type = string
}

variable "mysql_admin_password" {
  type      = string
  sensitive = true
}

variable "mysql_database_names" {
  description = "Bases de datos a respaldar (se pasa como lista al runbook Worker)."
  type        = list(string)
}

# --- Storage destino (existente) ---

variable "storage_account_name" {
  type = string
}

variable "storage_account_primary_connection_string" {
  sensitive = true
  type      = string
}

variable "storage_container_name" {
  type    = string
  default = "db-backups"
}

variable "sas_validity_years" {
  description = "El manual original fija 5 años y deja una advertencia manual para renovarlo. Se mantiene el mismo mecanismo (Terraform no puede auto-rotar un SAS sin recrear el recurso), documentado en el output sas_expiry_warning."
  type        = number
  default     = 3
}

# --- Key Vault existente (para guardar la password del admin de la VM) ---

variable "key_vault_id" {
  type = string
}

# --- Alertas ---

variable "alert_email" {
  type = string
}

variable "teams_webhook_url" {
  # Sin `default` a proposito. Una variable de Automation encriptada que se
  # escribe vacia rompe en silencio (caso STORAGE_ACCOUNT_NAME, 2026-08-22):
  # sin default, un tfvars incompleto frena el plan en vez de publicar un
  # canal de alertas muerto.
  description = "URL del trigger HTTP del flow de Power Automate que postea en Teams. Lleva `sig=` en el query string: es un secreto, va en TF_VARS_PROD."
  type        = string
  sensitive   = true
}

# --- Rutas de herramientas DENTRO de la VM (Fase 4 del manual, manual) ---
# Defaults = lo que documenta el manual. Si al instalar a mano las rutas
# quedan distintas, se ajustan acá y se re-aplica (sólo actualiza el contenido
# del runbook, no recrea la VM).

variable "vm_tool_path_mysqldump" {
  type    = string
  default = "C:\\Program Files\\MySQL\\MySQL Workbench 8.0 CE\\mysqldump.exe"
}

variable "vm_tool_path_gzip" {
  type    = string
  default = "C:\\Program Files\\Git\\usr\\bin\\gzip.exe"
}

variable "vm_tool_path_azcopy" {
  type    = string
  default = "C:\\Tools\\AzCopy\\azcopy.exe"
}

variable "vm_local_temp_path" {
  type    = string
  default = "C:\\TempBackups"
}

# --- Programación del Orquestador ---

variable "schedule_start_time" {
  description = "RFC3339. Elegir una hora de baja carga — el runbook prende la VM, así que compite por recursos de red con el resto del sync si coincide con /api/cron/sync (06:00 UTC)."
  type        = string
}

variable "schedule_timezone" {
  type    = string
  default = "America/Argentina/Buenos_Aires"
}

variable "orchestrator_timeout_minutes" {
  description = <<-DESC
    Tope de espera del orquestador por el job de backup en la VM.

    POR QUÉ EXISTE: Azure Automation descarga los jobs de nube que pasan el
    límite de fair share (3 horas) y los REINICIA desde cero. El 2026-08-22 un
    job quedó en "Running" 12 días por eso: el loop de polling no tenía tope,
    Azure lo reinició, y en el reinicio falló la carga de módulos --de ahí los
    "Connect-AzAccount is not recognized" en la línea 1 y "Stop-AzVM" en el
    finally.

    Tiene que quedar cómodamente por debajo de esas 3 horas para que el
    orquestador termine solo antes de que Azure lo toque.
  DESC
  type        = number
  default     = 120

  validation {
    condition     = var.orchestrator_timeout_minutes > 0 && var.orchestrator_timeout_minutes <= 165
    error_message = "Tiene que ser mayor que 0 y no pasar de 165 minutos: por encima de eso Azure descarga el job (límite de fair share de 3 h) y lo reinicia desde cero."
  }
}

variable "az_module_versions" {
  description = <<-DESC
    Versiones EXACTAS de los módulos Az que se importan al runtime PowerShell 7.2.

    POR QUÉ VAN PINEADAS: el `module_link.uri` sin versión trae siempre la última
    de la PowerShell Gallery. Funcionó durante agosto y se rompió sin que nadie
    tocara nada cuando Az.Accounts saltó a la línea 5.x: el sandbox de PS 7.2 no
    tiene el shim que esa línea necesita, así que el DLL carga pero no registra
    NINGÚN cmdlet. El síntoma es "Connect-AzAccount is not recognized" con un
    warning previo de "Unable to find type AzAssemblyLoadContextInitializer".

    POR QUÉ ESTAS: es la generación del bundle `Az` 11.2.0, y es la que
    demostradamente funcionó en este sandbox --el job del 2026-08-22 16:01
    autenticó y encendió la VM con Az.Compute 7.1.1. Az.Compute 7.1.1 declara
    `Az.Accounts:[2.15.0, )`, así que el trío es consistente entre sí.

    El rango de esa dependencia es abierto arriba: 5.5.1 lo SATISFACE. Por eso no
    alcanza con confiar en la resolución de dependencias y hay que fijar la
    versión a mano.

    CUÁNDO SUBIRLAS: al migrar el runbook a un Runtime Environment de PowerShell
    7.4. Las líneas Az.Accounts 5.x / Az.Compute 11.x apuntan a ese runtime, no
    a 7.2. Subirlas antes de migrar vuelve a romper lo mismo.
  DESC
  type = object({
    accounts   = string
    compute    = string
    automation = string
  })
  default = {
    accounts   = "2.15.0"
    compute    = "7.1.1"
    automation = "1.10.0"
  }
}

variable "hybrid_worker_ready_minutes" {
  description = <<-DESC
    Cuánto espera el orquestador a que el Hybrid Worker vuelva a hacer polling
    después de encender la VM.

    POR QUÉ EXISTE: antes había un `Start-Sleep -Seconds 300` a ciegas. A veces
    alcanzaba y a veces no --el 2026-09-03 el ciclo de las 22:38 funcionó y el de
    las 23:00 dejó el job hijo en "Suspended" con el mensaje "the Hybrid Worker
    could not process it", porque el agente todavía no se había registrado. Es
    una carrera, no un tiempo mal elegido.

    Ahora se consulta `lastSeenDateTime` del worker por la API y se dispara el
    hijo recién cuando está reportándose. Este número es sólo el tope: si el
    worker levanta en 90 segundos, no se esperan 300.
  DESC
  type        = number
  default     = 10

  validation {
    condition     = var.hybrid_worker_ready_minutes > 0 && var.hybrid_worker_ready_minutes <= 30
    error_message = "Tiene que ser mayor que 0 y no pasar de 30 minutos: por encima de eso conviene revisar por qué la VM tarda tanto en registrar el worker, no seguir esperando."
  }
}
