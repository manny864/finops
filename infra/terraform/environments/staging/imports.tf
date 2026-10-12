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
