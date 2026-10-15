# INFRA-06: segmentación de red de STAGING, versionada en git. Se pasa como -var-file después del
# secret (terraform.yml), así que los clientes autorizados a PE y MySQL se cambian por PR, no en el secret.
#
# Staging va primero: verificar health, token a Key Vault, Redis (rate limit), cron y migraciones
# antes de encender prod. Ver infra/docs/network-segmentation.md.
network_segmentation = {
  us = {
    enabled = true
  }
}
