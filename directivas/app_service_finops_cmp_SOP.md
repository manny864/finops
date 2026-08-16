# SOP: Cockpit FinOps y Densidad de Aplicaciones en App Services (Web Apps & Plans)

## Objetivo
Procedimiento operativo determinista para auditar, consolidar y optimizar costos de **App Service Plans (`Microsoft.Web/serverfarms`)** y **Web Apps / Deployment Slots (`Microsoft.Web/sites`)** en Azure, erradicando planes huérfanos/zombies y maximizando la densidad de aplicaciones por worker.

---

## 1. Arquitectura de Costos en Azure App Services

En Azure, el costo computacional no lo generan las Web Apps individuales, sino el **App Service Plan (ASP)**:
- **Facturación**: Se cobra por la capacidad asignada (`numberOfWorkers` / `sku.capacity`), el SKU/Tier (ej. Standard S1, Premium v3 P1v3) y el sistema operativo (`reserved: true` = Linux, `false` = Windows).
- **Relación 1:N**: Un solo App Service Plan puede alojar múltiples Web Apps y Deployment Slots que comparten la CPU y RAM de los workers.
- **Desperdicio Principal**:
  1. **Planes Huérfanos / Vacíos**: Planes activos con `numberOfSites == 0` que siguen facturando mensualmente.
  2. **Subutilización / Dispersión (Baja Densidad)**: Múltiples planes con una sola app al 5-10% de CPU en lugar de consolidarlas en un plan compartido (App Packing).
  3. **SKUs Antiguos**: Planes Standard S1 ($79.51 USD) cuando Premium v3 P0v3 ($54.75 USD) ofrece mejor CPU/RAM a menor precio.
  4. **Deployment Slots Inactivos**: Slots de staging/test olvidados consumiendo RAM y CPU del plan dedicado.

---

## 2. Reglas de Remediación Resolutivas

### 1. Plan Huérfano / Vacío (Zombie ASP)
- **Gatillo**: `numberOfSites == 0` (0 Web Apps alojadas).
- **Ahorro**: 100% del costo del plan ($79.51/mes en S1).
- **Comando Azure CLI**:
  ```bash
  az appservice plan delete --resource-group <resourceGroup> --name <planName> --yes
  ```

### 2. Consolidación de Aplicaciones (App Packing)
- **Gatillo**: Múltiples planes en la misma región y grupo de recursos con CPU promedio $< 15\%$ y memoria $< 40\%$.
- **Ahorro**: Costo del plan que se da de baja ($79.51/mes).
- **Comando Azure CLI**:
  ```bash
  # Mover Web App al plan compartido destino:
  az webapp update --resource-group <resourceGroup> --name <appName> --plan <targetSharedPlanName>
  # Eliminar el plan origen desocupado:
  az appservice plan delete --resource-group <resourceGroup> --name <sourcePlanName> --yes
  ```

### 3. Modernización a Premium v3 / Downgrade a Basic
- **Gatillo**: Planes Standard (S1/S2) subutilizados.
- **Ahorro**: $35 a $50 USD/mes por plan.
- **Comando Azure CLI**:
  ```bash
  # Migrar a Premium v3 P0v3 (1 vCPU, 4GB RAM, SSD NVMe):
  az appservice plan update --resource-group <resourceGroup> --name <planName> --sku P0v3
  # O para entornos de Dev/QA sin requerir SLA:
  az appservice plan update --resource-group <resourceGroup> --name <planName> --sku B1
  ```

### 4. Escalado a 1 Instancia / Autoscale Dinámico
- **Gatillo**: `numberOfWorkers > 1` fijo con baja utilización sostenida.
- **Ahorro**: 50% del costo de workers.
- **Comando Azure CLI**:
  ```bash
  az appservice plan update --resource-group <resourceGroup> --name <planName> --number-of-workers 1
  ```

### 5. Limpieza de Deployment Slots Inactivos
- **Gatillo**: Slots de staging sin tráfico HTTP en $> 14$ días.
- **Comando Azure CLI**:
  ```bash
  # Detener slot:
  az webapp deployment slot stop --resource-group <resourceGroup> --name <appName> --slot <slotName>
  # Eliminar slot:
  az webapp deployment slot delete --resource-group <resourceGroup> --name <appName> --slot <slotName>
  ```

---

## ⚠️ Restricciones y Trampas Conocidas (Gotchas)

### ❌ Requisito de Webspace al Mover Web Apps
- Azure no permite mover una Web App entre App Service Plans que residan en diferentes grupos de recursos o regiones si los planes no pertenecen a la misma unidad de despliegue (Webspace).
- **Solución**: Asegurar que ambos planes residan en el mismo Resource Group y Región geográfica antes de ejecutar `az webapp update --plan`.
