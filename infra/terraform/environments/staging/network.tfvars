# INFRA-06: segmentación de red de STAGING, versionada en git. Se pasa como -var-file después del
# secret (terraform.yml), así que los clientes autorizados a PE y MySQL se cambian por PR, no en el secret.
#
# Staging va primero: verificar health, token a Key Vault, Redis (rate limit), cron y migraciones
# antes de encender prod. Ver infra/docs/network-segmentation.md.
network_segmentation = {
  us = {
    enabled = true
  }

  keyvault_runner_subnet_ids = {
    us = ["/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/cscs-finops-staging-runner-rg/providers/Microsoft.Network/virtualNetworks/cscs-finops-staging-runner-vnet/subnets/runner"]
  }
}
