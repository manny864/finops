# SOP — Azure Red Hat OpenShift (ARO) FinOps & Governance Cockpit

## 1. Propósito y Alcance
Establecer el procedimiento estándar para la gobernanza, observabilidad de costos, análisis de arquitectura (Control Plane vs. Worker MachineSets), desglose de facturación tripartito (Cómputo Azure, Licencia Red Hat OpenShift y Almacenamiento Persistente) y remediación resolutiva de clústeres Azure Red Hat OpenShift (`Microsoft.RedHatOpenShift/openShiftClusters`).

---

## 2. Principios de Arquitectura ARO y Modelo Económico
1. **Control Plane / Nodos Master (Costo Ineludible de Existencia):**
   - Un clúster ARO aprovisiona obligatoriamente 3 nodos Master (típicamente `Standard_D8s_v5` o similar) para garantizar el quórum de `etcd` y la alta disponibilidad del plano de control de OpenShift.
   - Estos 3 nodos representan un costo base fijo ininterrumpido de ~$800–$1,200 USD/mes independientemente de si hay cargas de trabajo corriendo en los workers.
   - En ambientes `dev`, `test` o `qa` con baja utilización, el overhead de 3 masters fijos suele ser desproporcionado; la recomendación estándar es la consolidación de cargas no productivas en clústeres compartidos aislados mediante Namespaces y OpenShift RBAC.

2. **Nodos Worker (MachineSets y MachineAutoscaler):**
   - Los pools de workers ejecutan los pods de aplicación. Su capacidad se escala mediante MachineSets y MachineAutoscaler (`autoscaling.openshift.io/v1beta1`).
   - El rightsizing de workers analiza CPU y memoria promedio/máxima para sugerir transiciones (ej. de `Standard_D8s_v5` a `Standard_D4s_v5`) reduciendo tanto el costo de cómputo de la VM como la tarifa por vCore de Red Hat.

3. **Desglose Dual/Tripartito de Facturación:**
   - **Cómputo Azure (VMs):** Costo de la infraestructura subyacente de Azure (masters y workers).
   - **Licencia Red Hat OpenShift (ARO Service Fee):** Tarifa por hora por cada vCore asignado al clúster para el soporte y licenciamiento gestionado de Red Hat.
   - **Almacenamiento Persistente (Storage Classes / PVCs):** Managed Disks (Premium SSD / Standard SSD) aprovisionados dinámicamente en el Managed Resource Group (`aro-*`).

---

## 3. Entradas, Fuentes de Datos y APIs
1. **Azure Resource Graph (`Microsoft.RedHatOpenShift/openShiftClusters`):**
   - `properties.masterProfile.vmSize`: Tamaño de VM del plano de control.
   - `properties.workerProfiles`: Array de MachineSets con `vmSize`, `count`, `diskSizeGB`.
   - `properties.clusterProfile.version`: Versión de OpenShift desplegada.
   - `properties.clusterProfile.resourceGroupId`: ID del Managed Resource Group que contiene la infraestructura interna.
   - `properties.apiserverProfile.visibility`: Endpoint del API Server (`Public` / `Private`).
   - `properties.ingressProfiles[0].visibility`: Router default de OpenShift (`Public` / `Private`).
   - `properties.provisioningState`: Estado operativo del clúster (`Succeeded`, `Failed`, `Creating`, etc.).

2. **Azure Cost Management / FOCUS:**
   - Costo acumulado del clúster y desglose mediante cálculo del ARO Fee por vCore hora y residuo de Storage.

3. **Azure Monitor / Container Insights:**
   - Métrica de CPU promedio y percentil 95 (`CpuPercentage`, `node_cpu_utilization`).
   - Métrica de memoria en uso (`MemoryPercentage`, `node_memory_utilization`).

4. **Detección de PVCs Huérfanos en Managed RG:**
   - Detección de discos administrados en el Managed Resource Group con `managedBy == null` no adjuntos a nodos activos.

---

## 4. Reglas de Remediación y Priorización
1. **Consolidación de Clústeres Dev/Test:**
   - *Gatillo:* Clúster en grupo o nombre con tags no productivos (`dev`, `test`, `qa`, `staging`, `sandbox`) con CPU promedio < 20%.
   - *Acción:* `Analizar Fusión de Clúster ✨`. Sugerir consolidación en clúster compartido con aislamiento por Projects/Namespaces.
2. **Rightsizing de Worker MachineSets:**
   - *Gatillo:* CPU promedio < 25% y Memoria < 35% en los pools de workers.
   - *Acción:* `Redimensionar MachineSet ✨`. Transición a SKUs con menor número de vCores (ej. D4s_v5).
3. **Activación de MachineAutoscaler en Workers:**
   - *Gatillo:* Workers en capacidad fija sin MachineAutoscaler activo y baja utilización en horarios valles.
   - *Acción:* `Habilitar Autoscaler ARO ✨`. Aprovisionar manifiesto de `MachineAutoscaler` para reducir workers fuera de hora laboral.
4. **Cobertura con Compute Savings Plans:**
   - *Gatillo:* Clústeres de producción estables 24/7 en modelo Pay-As-You-Go.
   - *Acción:* `Simular Cobertura SP ✨`. Cobertura de la línea base de los 3 masters y workers fijos.
5. **Purga de PVCs Huérfanos:**
   - *Gatillo:* Managed Disks huérfanos detectados en el Managed Resource Group.
   - *Acción:* `Identificar PVCs sin Pod ✨`. Validación en OpenShift CLI (`oc get pvc`) y eliminación segura en Azure CLI.

---

## 5. Trampas Conocidas y Gotchas Técnicos
- **SKU Resolution en Azure Resource Graph:** Los clústeres OpenShift no tienen un `sku.name` plano estándar en ARM. Nunca utilizar propiedades genéricas de SKU que puedan confundirse con App Service (`P2v3`) o VMs estándar. El SKU de ARO debe componerse siempre a partir de `masterProfile.vmSize` y `workerProfiles[0].vmSize`.
- **Managed Resource Group (`aro-*`):** Azure ARO crea un grupo de recursos gestionado interno bloqueado con deny assignments. La inspección de discos huérfanos se hace mediante lectura de metadatos, no mutación directa sin antes desacoplar el PVC en la API de Kubernetes/OpenShift.
- **MachineAutoscaler vs ARM:** `MachineAutoscaler` es un objeto nativo de la API de OpenShift (`openshift-machine-api`), no un recurso directo de ARM. La verificación debe contemplar la API de OpenShift o la telemetría de conteo de nodos a lo largo del tiempo.
- **Estándar de Tablas CMP:** El módulo debe cumplir la Regla #19: filtros inmediatos (Recurso, Región, Perfil/SKU, Grupo), ordenamiento multi-criterio, paginación 15/30/45/60, columnas redimensionables con `ResizableTh` y ancho completo responsive.

---

## 6. Checklist de Verificación
- [x] SKU resuelto correctamente sin interferencias de SKUs de App Service.
- [x] Tarjeta de detalle con 3 columnas nítidas: Identidad & Red, Arquitectura & MachineSets, Métricas & FinOps.
- [x] Desglose de costos tripartito: Cómputo Azure, Licencia Red Hat (ARO Fee) y Storage.
- [x] Motor de recomendaciones resolutivas con las 5 reglas de negocio priorizadas.
- [x] Botones corporativos rectangulares suaves con fondo blanco y borde coincidente.
- [x] InfoTooltips institucionales `#1B2A41` con paridad i18n en ES, EN y PT-BR.
- [x] Mocks completos por tier en `mockData.ts`.
