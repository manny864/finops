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
  # público (ingress[0].fqdn), sólo con "https://" pegado adelante. Confirmado
  # en prod: un Container App Job pegándole al FQDN público de OTRO recurso
  # DENTRO del mismo entorno managed hace NAT hairpin y cuelga — el polling de
  # cron-sync fallaba el 100% de las veces (timeout de 30s en cada intento,
  # incluso con el servidor de brazos cruzados) mientras un curl externo
  # respondía en 0.6s. Mismo problema que ya estaba documentado y resuelto para
  # el self-fetch DENTRO del propio proceso (ver src/lib/internalBaseUrl.ts) —
  # pero ese usa loopback 127.0.0.1, que no sirve acá porque el job y la app
  # son contenedores distintos, no el mismo proceso.
  #
  # El FQDN interno real de Container Apps sigue el patrón
  # <app-name>.internal.<default_domain del entorno> — resuelve por DNS interno
  # del entorno managed y nunca sale a internet, evitando el hairpin.
  description = "URL interna real (<app>.internal.<default_domain>) para llamadas dentro del mismo Container Apps Environment — usada por los cron jobs."
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
