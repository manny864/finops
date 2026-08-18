# SOP: Cockpit FinOps de Redes Básicas (VNets, Private Endpoints, DNS, NSG & UDR)

## 1. Propósito y Alcance
Establecer el procedimiento estándar determinista para la gobernanza, observabilidad de costos, análisis de topología (Virtual Networks, Private Endpoints, Private DNS Zones, NSGs y Route Tables), detección de desperdicio administrativo / recursos huérfanos y remediación resolutiva en la plataforma FinOps de CSCloudSolutions.

---

## 2. Arquitectura de Red Básica y Modelo Económico
1. **Virtual Networks (`Microsoft.Network/virtualNetworks`):**
   - No tienen costo base de existencia en Azure, pero generan costos atribuibles por **VNet Peering Ingress/Egress**, Flow Logs y Gateways vinculados.
   - **Desperdicio Principal:** VNets vacías sin subredes ni recursos conectados (Desperdicio administrativo / higiene).

2. **Private Endpoints (`Microsoft.Network/privateEndpoints`):**
   - Facturación: Costo fijo base de **$0.01 USD/hora (~$7.30 USD/mes)** por enlace privado aprovisionado + costo por GB procesado ($0.01/GB).
   - **Optimización Principal:** Detección de Private Endpoints en entornos no productivos (Dev/QA/Test) con tráfico nulo o insignificante (<0.5 GB/mes), donde los Service Endpoints (gratuitos) o reglas de firewall de servicio son más costo-eficientes.

3. **Private DNS Zones (`Microsoft.Network/privateDnsZones`):**
   - Facturación: Costo fijo de **$0.50 USD/mes** por zona hospedada (primeras 25 zonas) + consultas DNS ($0.40 por millón de queries).
   - Monitoreo de cantidad de vínculos (`virtualNetworkLinks`).

4. **Network Security Groups (`Microsoft.Network/networkSecurityGroups`):**
   - Servicio gratuito en Azure.
   - **Higiene:** Detección de NSGs huérfanos sin asociación a subredes ni interfaces de red (`networkInterfaces`) tras la eliminación de VMs o balanceadores.

5. **Route Tables / UDRs (`Microsoft.Network/routeTables`):**
   - Servicio gratuito en Azure.
   - **Higiene:** Detección de tablas de ruteo personalizadas (UDRs) sin subredes asignadas.

---

## 3. Política de Autenticación y Zero-Fallback
1. **Tenants de Demostración (Mock/Demo):**
   - `isMockTenant(tenantId) === true` o prefijo `demo-` / `mock-` o query `mock=true`.
   - Servir datos sintéticos inmediatamente sin exigir token OAuth.
   - Dataset base representativo: 40 recursos (14 VNets, 6 PEs, 8 DNS, 12 NSG/UDR), ~$28.89 USD MTD, badges de recursos huérfanos.

2. **Tenants Reales / Conectados:**
   - Exigir validación estricta de RBAC mediante `requireTenantAccess(req, tenantId)`.
   - **TOLERANCIA CERO A FALLBACKS MOCK:** Si la consulta a Azure devuelve `$0.00` o `[]`, la UI renderiza el estado real ($0.00 / Empty State legítimo).

---

## 4. Estándar de Diseño y Componentes UI
1. **Iconografía Oficial (Tabler Icons):**
   - Librería exclusiva `@tabler/icons-react` (`IconNetwork`, `IconTopologyStarRing3`, `IconWorldWww`, `IconShieldCheck`, `IconRoute`).
   - Color azul corporativo (`text-[#0078D4]` / `text-[#0054A6]`), trazo limpio (stroke 1.5), **ESTRICTAMENTE SIN FONDO** (`bg-transparent`).
2. **Paleta de Gráfica Donut (Tonos de Azul Estrictos):**
   - Virtual Networks: `#0078D4`
   - Private Endpoints: `#2563EB`
   - Private DNS Zones: `#38BDF8`
   - Network Security Group: `#93C5FD`
   - Route Table: `#60A5FA`
3. **Gestión de Capas (Z-Index):**
   - Modales y Drawers: backdrop `fixed inset-0 bg-black/50 z-50`, contenedor en `z-50` o `z-[100]`.
4. **Estándar de Tablas CMP:**
   - Filtros superiores limpios: `SERVICIO`, `GRUPO DE RECURSOS`, `SUSCRIPCIÓN`.
   - Ordenamiento multicriterio (A-Z, Z-A, Costo asc/desc).
   - Paginación 15/30/45/60.
   - Columnas redimensionables con `ResizableTh`.
   - Botones corporativos con fondo blanco puro (`bg-white dark:bg-slate-900`) y borde/texto coincidente.

---

## 5. Reglas de Remediación Resolutivas
1. **`ORPHAN_NSG`:** Eliminación de NSG sin subredes ni NICs con `az network nsg delete` y `Remove-AzNetworkSecurityGroup`.
2. **`UNUSED_UDR`:** Eliminación de Route Table sin subredes con `az network route-table delete` y `Remove-AzRouteTable`.
3. **`EMPTY_VNET`:** Baja de VNet sin subredes/dispositivos con `az network vnet delete` y `Remove-AzVirtualNetwork`.
4. **`PE_OPTIMIZATION`:** Migración a Service Endpoints / baja de PE ocioso en Dev con `az network private-endpoint delete`.
