# SOP: Cockpit FinOps de Conectividad Híbrida (ExpressRoute, Virtual WAN, VPN Gateway, Conexiones & Local Gateways)

## 1. Propósito y Alcance
Establecer el procedimiento determinista para la observabilidad financiera, detección de fugas de costos fijos, auditoría de túneles caídos, arbitraje de planes de ExpressRoute y rightsizing de puertas de enlace de red en Azure (VPN & ExpressRoute Gateways, Virtual WAN, IPSec Connections y Local Network Gateways).

---

## 2. Arquitectura de Conectividad Híbrida y Modelo Económico
1. **ExpressRoute Circuits (`Microsoft.Network/expressRouteCircuits`):**
   - Facturación: Costo fijo de puerto (ej. 1 Gbps ~$450-$1,800/mes; 10 Gbps ~$1,200-$7,200/mes) + familia de tarificación (`MeteredData` vs `UnlimitedData`).
   - **Arbitraje FinOps:** Los circuitos con plan `UnlimitedData` pero con tráfico de salida < 20 TB/mes deben convertirse a `MeteredData` para un ahorro directo de ~$1,200 a $4,500 USD/mes por circuito.

2. **Virtual WAN & Hubs (`Microsoft.Network/virtualWans`, `Microsoft.Network/virtualHubs`):**
   - Facturación: $0.25 USD/hora por unidad de escalado de Virtual Hub (~$182.50 USD/mes/unidad) + tarifas de enrutamiento y procesamiento de datos.

3. **Virtual Network Gateways (`Microsoft.Network/virtualNetworkGateways`):**
   - Facturación: Tarifa base por hora de aprovisionamiento según SKU (`VpnGw1` ~$138.70/mes, `VpnGw2` ~$262.80/mes, `VpnGw3` ~$511/mes, `VpnGw4` ~$1,022/mes, `VpnGw5` ~$1,606/mes; `ErGw1AZ` ~$438/mes, `ErGw2AZ` ~$876/mes, `ErGw3AZ` ~$1,752/mes).
   - **Fuga Principal (Huérfanos):** Gateways sin conexiones asociadas (`Microsoft.Network/connections`), facturando de $140 a $1,750 USD/mes de costo fijo sin uso real.
   - **Rightsizing:** Gateways `VpnGw3/4/5` con throughput promedio < 100 Mbps deben degradarse a `VpnGw2`.

4. **Conexiones de Red e IPSec (`Microsoft.Network/connections`):**
   - Facturación: Cargos adicionales por túnel + egress data transfer ($0.035 - $0.087/GB).
   - **Higiene:** Detección de túneles en estado `NotConnected` o `Connecting` sostenido para purga administrativa o remediación con el extremo on-premises.

5. **Local Network Gateways (`Microsoft.Network/localNetworkGateways`):**
   - **Costo Base: $0.00 USD (Metadatos de configuración en Azure).**

---

## 3. Política de Autenticación y Tolerancia Cero a Fallbacks
1. **Tenants de Demostración (Mock):**
   - `isMockTenant(tenantId) === true` o prefijo `demo-` / `mock-` o query `mock=true`.
   - Evaluación obligatoria **PRIMERO** antes de cualquier guard de autenticación.
   - Dataset escalado por tier (Professional: ~$12,874.99 MTD base; Business: x2.5; Enterprise: x6.0).
2. **Tenants Reales / Conectados:**
   - Autenticación estricta con `requireTenantAccess(request, tenantId)`.
   - **TOLERANCIA CERO A FALLBACKS MOCK:** Si la infraestructura híbrida de un cliente real no tiene recursos o factura $0.00, se renderiza el estado real legítimo (*Empty State*).

---

## 4. Estándar de Diseño y Componentes UI
1. **Iconografía Corporativa (Tabler Icons):**
   - Librería exclusiva `@tabler/icons-react` (`IconTopologyStarRing3`, `IconArrowsSplit`, `IconNetwork`, `IconLayersLinked`, `IconServer`, `IconEye`).
   - Color azul corporativo (`text-[#0078D4]` / `text-[#0054A6]`), sin fondos circulares ni de color (`bg-transparent`).
2. **Paleta de Gráfica Donut (Tonos de Azul Estrictos):**
   - ExpressRoute: `#0078D4`
   - Virtual WAN: `#2563EB`
   - VPN Gateway: `#0284C7`
   - Conexiones / Peering Híbrido: `#38BDF8`
   - Local Network Gateways: `#94A3B8` ($0.00)
3. **Gestión de Capas (Z-Index):**
   - Modales (Topología, Scripts de Remediación): backdrop `fixed inset-0 bg-black/50 z-50`, contenedor en `z-50`.
4. **Estándar de Tablas CMP:**
   - Filtros superiores: `SERVICIO`, `GRUPO DE RECURSOS`, `SUSCRIPCIÓN`.
   - Ordenamiento multicriterio, paginación (15/30/45/60), columnas redimensionables (`ResizableTh`).
   - Botón Detalles con fondo blanco puro (`bg-white dark:bg-slate-900`), borde `#0054A6` y texto `#0054A6`.

---

## 5. Reglas de Remediación Resolutivas
1. **`ORPHAN_GATEWAY`:** Baja de gateway sin conexiones con `az network vnet-gateway delete` y `Remove-AzVirtualNetworkGateway`.
2. **`EXPRESSROUTE_ARBITRAGE`:** Conversión de Unlimited a Metered con `az network express-route update --sku-family MeteredData`.
3. **`GATEWAY_RIGHTSIZING`:** Reducción de SKU sobredimensionado con `az network vnet-gateway update --sku VpnGw2`.
4. **`DISCONNECTED_TUNNEL`:** Purga de conexión caída con `az network vpn-connection delete` y `Remove-AzVirtualNetworkGatewayConnection`.
