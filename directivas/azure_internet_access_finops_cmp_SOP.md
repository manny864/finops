# SOP: Cockpit FinOps de Acceso a Internet y Seguridad Perimetral (Public IPs, NAT Gateways, Azure Firewall & DDoS Protection)

## 1. Propósito y Alcance
Establecer el procedimiento determinista para la observabilidad financiera, detección de direcciones IP públicas huérfanas, arbitraje de planes anti-DDoS, optimización de NAT Gateways y dimensionamiento (rightsizing) de Azure Firewalls en el perímetro de Microsoft Azure.

---

## 2. Arquitectura de Salida a Internet, Perímetro y Modelo Económico
1. **Azure Public IP Addresses (`Microsoft.Network/publicIPAddresses`):**
   - Facturación: Tarifa horaria fija por dirección IPv4 estándar (~$0.005/h ≈ $3.65 USD/mes) tanto asignada como desasignada.
   - **Fuga FinOps (IPs Huérfanas):** Direcciones IP públicas estándar sin asociar a ninguna NIC, Load Balancer o Firewall (100% de desperdicio fijo acumulado).
   - **Remediación:** Eliminación administrativa con `az network public-ip delete` y `Remove-AzPublicIpAddress`.

2. **Virtual Network NAT Gateways (`Microsoft.Network/natGateways`):**
   - Facturación: Tarifa fija por hora de gateway de recursos ($0.045/h ≈ $32.85 USD/mes) + consumo por datos procesados ($0.045/GB).
   - **Fuga FinOps:** NAT Gateways desplegados en ambientes Dev/QA/Sandbox sin subredes vinculadas o con tráfico insignificante (<1 GB/mes).
   - **Remediación:** Eliminación de gateways ociosos con `az network nat gateway delete`.

3. **Azure Firewall (`Microsoft.Network/azureFirewalls`):**
   - Facturación: Tarifa base mensual por Tier (Basic ~$288.35/mes, Standard ~$912.50/mes, Premium ~$1,277.50/mes) + procesamiento e inspección de datos ($0.016/GB).
   - **Fuga FinOps:** Despliegue de firewalls Standard o Premium en suscripciones de staging o dev.
   - **Remediación:** Degradar a Azure Firewall Basic o programar apagados fuera de horario laboral para un ahorro de $600 a $1,000 USD/mes por firewall.

4. **Azure DDoS Protection (`Microsoft.Network/ddosProtectionPlans`):**
   - Facturación: DDoS Network Protection Plan ($2,944.00 USD/mes fijo para hasta 100 IPs públicas) vs. DDoS IP Protection ($199.00 USD/IP/mes).
   - **Arbitraje FinOps:** Tenants con menos de 14 IPs públicas expuestas que pagan la cuota plana de $2,944/mes. Al migrar a DDoS IP Protection (ej. 6 IPs = $1,194/mes), se genera un ahorro directo de hasta ~$1,750 a $2,500 USD/mes.
   - **Remediación:** Dar de baja el Network Plan con `az network ddos-protection delete` y habilitar DDoS IP Protection granular.

---

## 3. Política de Autenticación y Tolerancia Cero a Fallbacks
1. **Tenants de Demostración (Mock):**
   - `isMockTenant(tenantId) === true` o prefijo `demo-` / `mock-` o query `mock=true` o `tenantId === "default"`.
   - Evaluación obligatoria **PRIMERO** antes de cualquier guard de autenticación.
   - Dataset escalado por tier (Professional: base; Business: x2.5; Enterprise: x6.0).
2. **Tenants Reales / Conectados:**
   - Autenticación estricta con `requireTenantAccess(request, tenantId)`.
   - **TOLERANCIA CERO A FALLBACKS MOCK:** Si la infraestructura perimetral de un cliente real no tiene recursos o factura $0.00, se renderiza el estado real legítimo (*Empty State*).

---

## 4. Estándar de Diseño y Componentes UI
1. **Iconografía Corporativa (Tabler Icons):**
   - Librería exclusiva `@tabler/icons-react` (`IconWorld`, `IconShieldCheck`, `IconFlame`, `IconArrowsSplit`, `IconEye`).
   - Color azul corporativo (`text-[#0078D4]` / `text-[#0054A6]`), sin fondos circulares ni de color (`bg-transparent`).
2. **Paleta de Gráfica Donut (Tonos de Azul Estrictos):**
   - Azure Firewall: `#0078D4`
   - DDoS Protection: `#2563EB`
   - NAT Gateway: `#0284C7`
   - Public IP: `#38BDF8`
3. **Gestión de Capas (Z-Index):**
   - Modales (Detalles de Perímetro, Scripts de Remediación): backdrop `fixed inset-0 bg-black/50 z-50`, contenedor en `z-50`.
4. **Estándar de Tablas CMP:**
   - Filtros superiores: `SERVICIO`, `GRUPO DE RECURSOS`, `SUSCRIPCIÓN`.
   - Ordenamiento multicriterio, paginación (15/30/45/60), columnas redimensionables (`ResizableTh`).
   - Botón Detalles con fondo blanco puro (`bg-white dark:bg-slate-900`), borde `#0054A6` y texto `#0054A6`.

---

## 5. Reglas de Remediación Resolutivas
1. **`ORPHAN_IP`:** Purga de IPs públicas huérfanas con `az network public-ip delete` y `Remove-AzPublicIpAddress`.
2. **`DDOS_ARBITRAGE`:** Migración de Network Protection a IP Protection con `az network ddos-protection delete`.
3. **`FIREWALL_RIGHTSIZING`:** Reducción de SKU de Firewall a Basic con `az network firewall update --set sku.tier=Basic`.
4. **`NAT_RIGHTSIZING`:** Eliminación de NAT Gateways sin subredes con `az network nat gateway delete`.
