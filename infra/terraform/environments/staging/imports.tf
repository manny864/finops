# Los crea la persona en F0 (docs/security/ejecucion-staging-copilot.md): el SP de staging sólo tiene
# roles sobre sus RG y no puede crear RG a nivel suscripción. Acá entran al state. Este archivo es
# propio de staging: prod no lo tiene.
import {
  to = azurerm_resource_group.global
  id = "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/cscs-finops-stg-global-rg"
}

import {
  to = module.stamp["us"].module.network.azurerm_resource_group.this
  id = "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/cscs-finops-stg-westus2-rg"
}

# El ACR también lo crea la persona (F0.6): las imágenes de bootstrap tienen que existir antes del
# primer apply, y se suben a este registro.
import {
  to = module.acr.azurerm_container_registry.this
  id = "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/cscs-finops-stg-global-rg/providers/Microsoft.ContainerRegistry/registries/cscsfinopsstgglobalcr"
}

# Flow Logs creados al habilitar la telemetría en staging; desde acá quedan
# administrados por el módulo compartido con producción.
import {
  to = module.stamp["us"].azurerm_user_assigned_identity.network_flow_logs[0]
  id = "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/cscs-finops-stg-westus2-rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/cscs-finops-stg-vnet-flowlogs-mi"
}

import {
  to = module.stamp["us"].azurerm_role_assignment.network_flow_logs_storage[0]
  id = "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/cscs-finops-stg-westus2-rg/providers/Microsoft.Storage/storageAccounts/cscsfinopsstgwestus2sa/providers/Microsoft.Authorization/roleAssignments/2263da6b-6bf4-454a-ab34-e9321139a229"
}

import {
  to = module.stamp["us"].azapi_resource.network_flow_log[0]
  id = "/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/NetworkWatcherRG/providers/Microsoft.Network/networkWatchers/NetworkWatcher_westus2/flowLogs/cscs-finops-stg-westus2-vnet-flowlog?api-version=2025-07-01"
}
