variable "targets" {
  description = "nombre => resource id del recurso a diagnosticar."
  type        = map(string)
}

variable "metrics_only_targets" {
  description = <<-DESC
    Igual que targets, pero sin bloque de logs. Es para los recursos que no
    publican NINGUNA categoría de log: Azure responde 400 "CategoryGroup
    'allLogs' is not supported, supported ones are: ''" y el apply se cae.
    Managed Redis es uno de esos. Las métricas sí funcionan, y en un cache son
    lo que importa (memoria, evictions, conexiones).
  DESC
  type        = map(string)
  default     = {}
}

variable "name_base" {
  type = string
}

variable "log_category_group" {
  description = <<-DESC
    Grupo de categorías de log de los targets. "audit" deja sólo la
    auditoría de acceso. Lo usa Azure AI: con "allLogs" sumaría
    RequestResponse y Trace, una fila por cada llamada al modelo; el uso por
    llamada ya lo registra la app y el consumo está en las métricas.
  DESC
  type        = string
  default     = "allLogs"
}

variable "workspace_id" {
  type = string
}
