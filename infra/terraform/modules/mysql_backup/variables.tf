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
