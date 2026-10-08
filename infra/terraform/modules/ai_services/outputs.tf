# depends_on: la revisión de la app que recibe estos valores (junto con
# AZURE_OPENAI_AUTH=entra) tiene que crearse después del rol y del private
# endpoint con sus A records; si no, las llamadas salen por la IP pública
# (403) o sin permiso (401). El rol igual tarda unos minutos en propagar.
output "resource_name" {
  value      = azurerm_cognitive_account.this.custom_subdomain_name
  depends_on = [azurerm_role_assignment.app, azurerm_private_endpoint.this]
}

output "deployment_name" {
  value      = azurerm_cognitive_deployment.chat.name
  depends_on = [azurerm_role_assignment.app, azurerm_private_endpoint.this]
}
