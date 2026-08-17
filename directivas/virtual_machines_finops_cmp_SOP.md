# SOP: Cockpit FinOps y Optimización de Cómputo en Azure Virtual Machines

## Objetivo
Procedimiento operativo determinista para auditar, redimensionar, optimizar y controlar los costos de **Azure Virtual Machines (`Microsoft.Compute/virtualMachines`)**, identificando fugas de almacenamiento persistente en VMs apagadas (`PowerState/deallocated`), optimizando licenciamiento híbrido (AHUB), mitigando sobredimensionamiento de cómputo hacia Serie B Burstable y aplicando calendarios de apagado automático.

---

## 1. Arquitectura de Costos y Vectores de Gasto en Azure VMs

El costo total de una máquina virtual en Azure se compone de:
1. **Costo de Cómputo (Compute Running Cost)**:
   - Facturado por segundo únicamente cuando la máquina está en estado `PowerState/running`.
   - Si la máquina se desasigna (`PowerState/deallocated`), el costo de cómputo se reduce a **$0.00 USD/hora**.
2. **Costo de Almacenamiento Persistente (Storage Managed Disks)**:
   - **Disco OS (Sistema)**: Discos Premium SSD (`Premium_LRS`), Standard SSD (`StandardSSD_LRS`) o Standard HDD (`Standard_LRS`).
   - **Discos de Datos Adicionales (Data Disks)**.
   - ⚠️ **La Mayor Fuga Oculta FinOps**: En estado `PowerState/deallocated`, los discos administrados **siguen facturándose al 100% de la tarifa mensual**. Una VM apagada con disco Premium SSD de 128 GiB y Data Disk de 256 GiB sigue costando ~$32.80 USD/mes de almacenamiento estático.
3. **Licenciamiento de Sistema Operativo (OS Licensing & AHUB)**:
   - En Windows Server, el licenciamiento Pay-As-You-Go añade un recargo de ~40% sobre el costo de cómputo.
   - Con **Azure Hybrid Benefit (AHUB)** (`licenseType: 'Windows_Server'`), los clientes con Software Assurance ahorran ese 40%.
4. **Networking e IP Pública (Public IP Cost)**:
   - Las direcciones IP públicas estáticas o dinámicas asociadas a la NIC de la VM generan costo fijo mensual incluso con la VM apagada.

---

## 2. Reglas de Remediación Resolutivas

### 1. Rightsizing Inteligente hacia Serie B (Burstable) o Menor SKU
- **Gatillo**: VM en familias de propósito general o memoria (D, E o F) con CPU promedio sostenido $< 10\%$ y RAM en uso $< 30\%$ durante 14 a 30 días.
- **Acción**: Migrar a `Standard_B2s` (2 vCPU / 4 GB) o `Standard_D2s_v5`.
- **Ahorro Estimado**: ~70% a 76% en costo de cómputo (~$24.80 a $145.00 USD/mes).
- **Comando Azure CLI**:
  ```bash
  az vm resize --resource-group <resourceGroup> --name <vmName> --size Standard_B2s
  ```

### 2. Mitigación de Fuga de Disco en VM Desasignada (Deallocated Waste)
- **Gatillo**: VM en estado `PowerState/deallocated` con disco OS configurado en `Premium_LRS`.
- **Acción**: Degradar storage tier a Standard HDD (`Standard_LRS`) mientras permanezca apagada.
- **Ahorro Estimado**: ~$14.00 a $18.00 USD/mes por disco de 128 GiB.
- **Comando Azure CLI**:
  ```bash
  OS_DISK=$(az vm show -g <resourceGroup> -n <vmName> --query "storageProfile.osDisk.managedDisk.id" -o tsv)
  az disk update --ids $OS_DISK --sku Standard_LRS
  ```

### 3. Programación de Apagado (Dev/Test Schedule 8x5)
- **Gatillo**: VMs en suscripciones o grupos de recursos de desarrollo/pruebas (`dev`, `test`, `qa`, `staging`) con uptime del 100% (24/7).
- **Acción**: Configurar auto-shutdown diario a las 19:00 horas y encendido automático 08:00 L-V.
- **Ahorro Estimado**: 65% del costo mensual de cómputo.
- **Comando Azure CLI**:
  ```bash
  az vm auto-shutdown --resource-group <resourceGroup> --name <vmName> --time 1900 --email-alert false
  ```

### 4. Activación de Azure Hybrid Benefit (AHUB Windows Server)
- **Gatillo**: VM con Windows Server pagando tarifa completa en Pay-As-You-Go (`licenseType: 'None'`).
- **Acción**: Aplicar licencia propia on-premises con Software Assurance (`licenseType: 'Windows_Server'`).
- **Ahorro Estimado**: 40% del costo de cómputo.
- **Comando Azure CLI**:
  ```bash
  az vm update --resource-group <resourceGroup> --name <vmName> --set licenseType=Windows_Server
  ```

### 5. Descarte / Snapshot de VM Abandonada
- **Gatillo**: VM desasignada hace más de 60 días sin actividad de red ni cambios de estado.
- **Acción**: Crear snapshot administrado del disco OS para archivo histórico y eliminar la VM junto a sus recursos asociados.
- **Ahorro Estimado**: 100% del costo mensual de discos e IP pública.
- **Comando Azure CLI**:
  ```bash
  az snapshot create --resource-group <resourceGroup> --name snap-<vmName> --source $(az vm show -g <resourceGroup> -n <vmName> --query "storageProfile.osDisk.managedDisk.id" -o tsv)
  az vm delete --resource-group <resourceGroup> --name <vmName> --yes
  ```

---

## ⚠️ Restricciones y Trampas Conocidas (Gotchas)

### ❌ Reinicio Obligatorio al Cambiar de Tamaño (Resize Downtime)
- Cambiar el SKU de una máquina virtual requiere reiniciar la instancia. Si el nuevo tamaño está en un clúster físico de hardware diferente, Azure moverá la VM y causará un reinicio de ~1 a 3 minutos. Siempre coordinar ventanas de mantenimiento para entornos productivos.

### ❌ Créditos de CPU en Serie B (Burstable Performance)
- Las instancias Serie B no garantizan CPU constante al 100%. Si una aplicación satura la CPU por periodos prolongados, agotará los créditos y el rendimiento se limitará al valor base (ej. 20% en B2s). No usar Serie B para bases de datos de alta concurrencia o procesos batch pesados.

### ❌ Discos Premium Degradados a Standard HDD
- Degradar un disco de `Premium_LRS` a `Standard_LRS` reduce los IOPS de 3,500 a 500 ops/s. Antes de volver a encender la VM para producción, se debe restaurar el tier a `Premium_LRS` o `StandardSSD_LRS`.
