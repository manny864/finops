output "account_name" {
  value = azurerm_storage_account.this.name
}

output "id" {
  value = azurerm_storage_account.this.id
}

output "backups_container_resource_manager_id" {
  description = "ID de Resource Manager del contenedor db-backups: scope del rol de datos de la VM de backups."
  # Armado a mano y no con azurerm_storage_container.backups.resource_manager_id: ese atributo está
  # deprecado en el provider 4.81 (validate avisa) y se elimina en la 5.0. Referenciar el nombre del
  # contenedor mantiene la dependencia: el rol no se crea antes que el contenedor.
  value = "${azurerm_storage_account.this.id}/blobServices/default/containers/${azurerm_storage_container.backups.name}"
}

output "blob_endpoint" {
  value = azurerm_storage_account.this.primary_blob_endpoint
}
