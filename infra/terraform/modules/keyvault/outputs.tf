output "id" {
  value = local.vault_id
}

# Lo consume el workflow de Terraform para abrir y cerrar el firewall
# alrededor del plan/apply (az keyvault network-rule add/remove).
output "name" {
  value = local.vault_name
}

output "vault_uri" {
  value = local.vault_uri
}

# Se consume como depends_on: garantiza que el RBAC de escritura ya propagó
# antes de que alguien intente guardar un secret en este vault.
output "ready" {
  value = var.create ? time_sleep.rbac_propagation[0].id : local.vault_id
}
