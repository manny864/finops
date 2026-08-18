# SOP: Cockpit FinOps de Balanceo y Publicación (Application Gateway / WAF, Azure Front Door, Load Balancer & Traffic Manager)

## 1. Propósito y Alcance
Establecer el procedimiento determinista para la observabilidad financiera, detección de balanceadores huérfanos, optimización de reglas de autoscale, arbitraje de perfiles Front Door y calibración de métricas de ingress en Azure (Application Gateway, Azure Front Door, Load Balancer y Traffic Manager).

---

## 2. Arquitectura de Balanceo, Ingress y Modelo Económico
1. **Application Gateway / WAF (`Microsoft.Network/applicationGateways`):**
   - Facturación: Tarifa fija por hora de gateway (~$0.26/h ≈ $189.80 USD/mes) + consumo de Capacity Units (CU a $0.008/CU/h) + recargo por reglas administradas de WAF.
   - **Fuga FinOps (Autoscale sobredimensionado):** Gateways en entornos no productivos (Dev/QA/Staging) configurados con `minCapacity > 2`, devengando cargos por capacidad ociosa 24/7.
   - **Remediación:** Reducir `minCapacity=1` en ambientes no productivos.

2. **Azure Front Door (`Microsoft.Cdn/profiles` / `Microsoft.Network/frontdoors`):**
   - Facturación: Tarifa base mensual por perfil (Standard $35.00 USD/mes vs. Premium $330.00 USD/mes) + transferencia de salida (Egress Edge CDN) + peticiones de enrutamiento.
   - **Arbitraje FinOps:** Perfiles Premium desplegados en entornos de desarrollo sin políticas avanzadas de WAF/Bot Protection que justifiquen la tarifa de $330/mes.
   - **Remediación:** Migración a `Standard_AzureFrontDoor` para un ahorro directo de $295.00 USD/mes por perfil.

3. **Azure Load Balancer (`Microsoft.Network/loadBalancers`):**
   - Facturación: Tarifa fija por reglas de balanceo ($18.25 USD/mes por las primeras 5 reglas + $3.65/regla adicional) + procesamiento de datos (Data processed).
   - **Fuga Principal (Orphan Load Balancer):** Standard LBs sin VMs ni interfaces de red asociadas en sus `backendAddressPools` (100% de desperdicio fijo).
   - **Remediación:** Eliminación administrativa del recurso con `az network lb delete`.

4. **Traffic Manager (`Microsoft.Network/trafficManagerProfiles`):**
   - **Calibración FinOps:** Facturación basada en volumen de consultas DNS ($0.54 USD por millón de consultas para los primeros 1,000 millones) + monitoreo de endpoints (Health Probes a $0.75 - $1.50/mes/endpoint).
   - Se evitan estimaciones infladas irreales reflejando costos reales del orden de $5 a $35 USD/mes.

---

## 3. Política de Autenticación y Tolerancia Cero a Fallbacks
1. **Tenants de Demostración (Mock):**
   - `isMockTenant(tenantId) === true` o prefijo `demo-` / `mock-` o query `mock=true` o `tenantId === "default"`.
   - Evaluación obligatoria **PRIMERO** antes de cualquier guard de autenticación.
   - Dataset escalado por tier (Professional: base; Business: x2.5; Enterprise: x6.0).
2. **Tenants Reales / Conectados:**
   - Autenticación estricta con `requireTenantAccess(request, tenantId)`.
   - **TOLERANCIA CERO A FALLBACKS MOCK:** Si la infraestructura de balanceo de un cliente real no tiene recursos o factura $0.00, se renderiza el estado real legítimo (*Empty State*).

---

## 4. Estándar de Diseño y Componentes UI
1. **Iconografía Corporativa (Tabler Icons):**
   - Librería exclusiva `@tabler/icons-react` (`IconScale`, `IconDoor`, `IconGlobe`, `IconSwitchHorizontal`, `IconEye`).
   - Color azul corporativo (`text-[#0078D4]` / `text-[#0054A6]`), sin fondos circulares ni de color (`bg-transparent`).
2. **Paleta de Gráfica Donut (Tonos de Azul Estrictos):**
   - Application Gateway (WAF): `#0078D4`
   - Azure Front Door: `#2563EB`
   - Load Balancer: `#0284C7`
   - Traffic Manager: `#38BDF8`
3. **Gestión de Capas (Z-Index):**
   - Modales (Detalles de Ingress, Scripts de Remediación): backdrop `fixed inset-0 bg-black/50 z-50`, contenedor en `z-50`.
4. **Estándar de Tablas CMP:**
   - Filtros superiores: `SERVICIO`, `GRUPO DE RECURSOS`, `SUSCRIPCIÓN`.
   - Ordenamiento multicriterio, paginación (15/30/45/60), columnas redimensionables (`ResizableTh`).
   - Botón Detalles con fondo blanco puro (`bg-white dark:bg-slate-900`), borde `#0054A6` y texto `#0054A6`.

---

## 5. Reglas de Remediación Resolutivas
1. **`ORPHAN_LB`:** Baja de Load Balancers sin backend con `az network lb delete` y `Remove-AzLoadBalancer`.
2. **`FRONTDOOR_SKU_DOWNGRADE`:** Migración de Premium a Standard con `az afd profile update --sku Standard_AzureFrontDoor`.
3. **`APP_GATEWAY_AUTOSCALE`:** Reducción de minCapacity con `az network application-gateway update --set autoscaleConfiguration.minCapacity=1`.
4. **`IDLE_INGRESS`:** Auditoría y purga de reglas de enrutamiento y listeners inactivos.
