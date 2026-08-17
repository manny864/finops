# SOP: Conversión de Instancias a Spot en Virtual Machine Scale Sets (VMSS)

## Objetivo
Procedimiento operativo y consideraciones de arquitectura para la conversión o despliegue de conjuntos de escalado de máquinas virtuales (VMSS) en Azure Spot para cargas tolerantes a fallos (Dev, Test, QA, Staging, Batch Processing), evitando errores de sintaxis y restricciones de Azure ARM.

---

## ⚠️ Restricciones y Trampas Conocidas (Gotchas)

### ❌ Error Detectado 1: `Couldn't find 'billingProfile'`
```
Couldn't find 'billingProfile' in 'virtualMachineProfile'. Available options: ['diagnosticsProfile', 'evictionPolicy', 'extensionProfile', 'networkProfile', 'osProfile', 'priority', 'securityProfile', 'storageProfile', 'timeCreated']
```

### 🧠 Causa Raíz
Cuando un VMSS se crea con prioridad regular (`Regular`), el objeto `billingProfile` está inicializado como `null` en la plantilla JSON de Azure. La sintaxis `--set virtualMachineProfile.billingProfile.maxPrice=-1` de Azure CLI intenta acceder a una clave anidada inexistente.

### ❌ Error Detectado 2: `PropertyChangeNotAllowed` en Prioridad Spot
En ciertos modos de orquestación (Uniform y algunos perfiles Flexible), Azure ARM marca la propiedad `priority` como inmutable después de la creación del scale set.

---

## ✅ Protocolo de Remediación y Solución

### Opción A: Actualización vía Azure CLI con Dict JSON Completo
Si el modo de orquestación admite actualización en caliente:
```bash
az vmss update \
  --resource-group <resourceGroup> \
  --name <vmssName> \
  --set virtualMachineProfile.priority=Spot \
        virtualMachineProfile.evictionPolicy=Deallocate \
        virtualMachineProfile.billingProfile='{"maxPrice":-1}'
```

### Opción B: Despliegue de Nuevo Pool Spot & Drenado de Tráfico (Recomendado)
En entornos de producción, staging o clústeres donde la prioridad es inmutable:
1. Desplegar un nuevo Scale Set o pool Spot con capacidad inicial:
   ```bash
   az vmss create \
     --resource-group <resourceGroup> \
     --name <vmssName>-spot \
     --image <imageUrn> \
     --vm-sku <sku> \
     --priority Spot \
     --eviction-policy Deallocate \
     --max-price -1 \
     --instance-count <count>
   ```
2. Asociar el nuevo VMSS al Application Gateway / Load Balancer.
3. Reducir instancias del pool anterior a 0 y eliminarlo una vez estabilizado el tráfico.

---

## Checklist de Verificación
- [ ] Confirmar que la carga de trabajo sea tolerante a interrupciones (desalojo con notificación de 30 segundos vía Azure Scheduled Events).
- [ ] Establecer la política de desalojo en `Deallocate` (no `Delete`) para retener discos y configuraciones.
- [ ] Fijar `maxPrice=-1` para garantizar que el scale set solo se desaloje si la capacidad física de Azure se satura, sin límite de precio de corte.
