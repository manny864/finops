output "app_id" {
  value = azurerm_container_app.this.id
}

output "app_name" {
  value = azurerm_container_app.this.name
}

output "default_hostname" {
  value = azurerm_container_app.this.ingress[0].fqdn
}

output "internal_url" {
  # NO era interno de verdad hasta el 2026-07-30: apuntaba al MISMO FQDN
  # público (ingress[0].fqdn), sólo con "https://" pegado adelante. El FQDN
  # interno real de Container Apps sigue el patrón
  # <app-name>.internal.<default_domain del entorno>: resuelve por DNS interno
  # del entorno managed y no sale a internet, así que el tráfico entre jobs y
  # app se queda adentro. Se mantiene por eso — camino más corto y sin egress.
  #
  # OJO CON LA HISTORIA DE ESTE COMENTARIO: este cambio se hizo culpando al NAT
  # hairpin del cuelgue del polling de cron-sync, y ESE DIAGNÓSTICO ERA
  # INCORRECTO. La causa real era un bug de JavaScript en el runner (un
  # AbortSignal.timeout reusado entre requests, ver el comentario largo en
  # modules/cronjobs/main.tf). El FQDN público funcionaba: el request de
  # trigger, que salía por el mismo camino, llegaba siempre. No volver a
  # atribuirle a la red un fallo sin antes mirar los intervalos entre
  # reintentos — ahí estaba la pista (fallaban en 0ms, no a los 30s).
  description = "URL interna (<app>.internal.<default_domain>) para llamadas dentro del mismo Container Apps Environment — usada por los cron jobs."
  value       = "https://${azurerm_container_app.this.name}.internal.${var.environment_default_domain}"
}

output "custom_domain_verification_id" {
  description = "Va en el TXT asuid.<subdominio> para que Azure valide ownership del dominio propio."
  value       = azurerm_container_app.this.custom_domain_verification_id
  # El provider lo marca sensitive por defecto — no es un secreto real (su
  # único uso es publicarse en un TXT público), pero Terraform exige
  # propagar la marca hasta la raíz. Ver custom_domain_dns_instructions.
  sensitive = true
}
