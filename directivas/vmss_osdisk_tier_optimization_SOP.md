# SOP: Optimización de Tier de Disco OS en Virtual Machine Scale Sets (VMSS)

## Objetivo
Guía operativa determinista para la degradación y optimización de costos de discos de Sistema Operativo (OS Disk) en conjuntos de escalado de máquinas virtuales (VMSS) de Azure sin interrumpir la operación y evitando errores de inmutabilidad de Azure Resource Manager (ARM).

---

## ⚠️ Restricciones y Trampas Conocidas (Gotchas)

### ❌ Error Detectado: `PropertyChangeNotAllowed`
```
(PropertyChangeNotAllowed) Changing property 'osDisk.managedDisk.storageAccountType' is not allowed.
Code: PropertyChangeNotAllowed
Message: Changing property 'osDisk.managedDisk.storageAccountType' is not allowed.
Target: osDisk.managedDisk.storageAccountType
```

### 🧠 Causa Raíz
En Azure Resource Manager, la propiedad `virtualMachineProfile.storageProfile.osDisk.managedDisk.storageAccountType` del modelo base de un VMSS existente es **inmutable** vía `az vmss update --set`. Azure prohíbe la modificación directa del tipo de cuenta de almacenamiento del disco OS en el scale set en caliente.

### ✅ Protocolo Correcto de Remediación

#### Caso 1: Actualización de Discos de Instancias Existentes (Vía `az disk update`)
Para optimizar el costo de los discos existentes sin recrear el VMSS:
1. **Desasignar (Deallocate) las instancias del VMSS** para liberar el bloqueo de lectura/escritura del storage engine:
   ```bash
   az vmss deallocate --resource-group <resourceGroup> --name <vmssName>
   ```
2. **Actualizar el SKU de los discos administrados de cada instancia**:
   ```bash
   # Obtener los IDs o nombres de discos OS asociados a las instancias del VMSS y actualizar el SKU:
   for disk in $(az disk list --resource-group <resourceGroup> --query "[?contains(managedBy, '<vmssName>')].name" -o tsv); do
     az disk update --resource-group <resourceGroup> --name $disk --sku StandardSSD_LRS
   done
   ```
3. **Iniciar el VMSS nuevamente**:
   ```bash
   az vmss start --resource-group <resourceGroup> --name <vmssName>
   ```

#### Caso 2: Infraestructura como Código (Terraform / OpenTofu)
En Terraform, actualizar el bloque `os_disk` en el recurso `azurerm_orchestrated_virtual_machine_scale_set` o `azurerm_linux_virtual_machine_scale_set`:
```hcl
os_disk {
  caching              = "ReadWrite"
  storage_account_type = "StandardSSD_LRS"
}
```
Terraform gestionará la actualización según la directiva `rolling_upgrade_policy` o el reemplazo controlado de instancias.

---

## Checklist de Verificación
- [ ] Validar que las IOPS requeridas por la carga sean $< 500$ IOPS sostenidas antes de degradar a `StandardSSD_LRS`.
- [ ] Ejecutar `az vmss deallocate` previo a `az disk update`.
- [ ] Confirmar que el SKU de todos los discos administrados figure como `StandardSSD_LRS`.
- [ ] Iniciar el Scale Set y verificar métricas de latencia de disco en Azure Monitor.
