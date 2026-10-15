# INFRA-06: segmentación de red de PROD, versionada en git. Se pasa como -var-file después del
# secret (terraform.yml), así que los clientes autorizados a PE y MySQL se cambian por PR, no en el secret.
#
# La subred de la VM de backup (mysql_backup_vm_subnet_prefix) se suma sola: no listarla acá.
network_segmentation = {
  us = {
    # Apagado hasta verificarlo en staging (environments/staging/network.tfvars).
    enabled = false

    mysql_extra_client_prefixes = [
      # Web corporativa cscloudsolutions (App Service cscs-asp-wus2-prod, RG cscs-webpage-wus2-prod):
      # VNet integration en cscs-webpage-snet-appservice, fuera de Terraform, y usa este MySQL.
      "10.50.40.0/24",
    ]
  }
}
