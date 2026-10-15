# Segmentación de red y salida controlada (INFRA-06)

## Qué se cerró

Las subredes de private endpoints (`snet-pe`) y de MySQL (`snet-mysql`) no tenían NSG: cualquier
recurso de la VNet llegaba a Key Vault, Redis, AI Services y MySQL. Ninguna era pública (MySQL va por
VNet injection; Redis y KV por PE), así que no había intrusión inicial, pero sí una ruta lateral y de
exfiltración tras comprometer cualquier cosa dentro de la VNet.

Con `network_segmentation.<stamp>.enabled = true` (`modules/network/main.tf`):

| Subred | Entra | Puertos | Resto |
|---|---|---|---|
| `snet-pe` | subred de apps + `pe_extra_client_prefixes` | 443 (KV, AI), 10000 (Managed Redis) | Deny |
| `snet-mysql` | subred de apps + `mysql_extra_client_prefixes` | 3306 | Deny |
| `snet-mysql` | la propia subred (HA, 3306/33062) y `AzureLoadBalancer` | todos | — |

- La subred de PE pasa a `private_endpoint_network_policies = "NetworkSecurityGroupEnabled"`: sin eso
  Azure ignora el NSG en el tráfico a los PE.
- Sólo se filtra la entrada. La salida de MySQL (Storage para backups y logs, HA, DNS
  168.63.129.16) usa las reglas por defecto.
- Los puertos son los verificados en Azure (2026-10-15): Managed Redis escucha en **10000** con
  clustering `EnterpriseCluster`, no en 6379. Si se pasa a OSS clustering también hacen falta los
  85xx (`pe_allowed_ports`).

## Clientes autorizados

Se declaran en `environments/<env>/network.tfvars`, **versionado** y pasado como `-var-file` después
del secret, así que se revisan por PR.

| Entorno | Cliente | Prefijo | Destino | Origen |
|---|---|---|---|---|
| ambos | Container Apps (web, cron, migraciones) | subred de apps | PE, MySQL | automático |
| prod | VM de backup (`mysql_backup`) | `mysql_backup_vm_subnet_prefix` (10.50.30.0/24) | MySQL | automático si `mysql_backup_enabled` |
| prod | Web corporativa `cscloudsolutions` (App Service `cscs-asp-wus2-prod`, VNet integration en `cscs-webpage-snet-appservice`, fuera de Terraform) | 10.50.40.0/24 | MySQL | `network.tfvars` |

Una subred nueva que necesite MySQL o un PE **no tiene acceso** hasta sumarla a `network.tfvars`.

## Despliegue

1. Staging (`enabled = true`): `terraform` workflow, ambiente staging, `APPLY-STAGING`.
2. Verificar en staging: `/api/health`, lectura de Key Vault (token y secreto), Redis (rate limit),
   un cron (`status-snapshot`), un deploy con migraciones, y que una subred no autorizada **no**
   llega a 3306, 10000 ni 443 (prueba con una instancia temporal en una subred de prueba).
3. Prod: `enabled = true` en `environments/prod/network.tfvars`, PR, `APPLY-PROD`. Verificar además
   la web corporativa y el próximo backup de la VM.

Rollback: `enabled = false` y apply. Se borran los dos NSG y la subred de PE vuelve a `Disabled`.

## Salida (egress)

El NAT Gateway fija la IP de salida pero **no filtra destinos**. El módulo admite una UDR
`0.0.0.0/0 → firewall` (`egress_firewall_private_ip`), que hoy está **inactiva** porque no hay Azure
Firewall/NVA desplegado.

**Riesgo aceptado (2026-10-15).** Dueño: plataforma (manny864). Revisión: 2027-01-15 o antes de
sumar integraciones salientes nuevas. Un contenedor comprometido puede salir a cualquier destino
de internet. Lo mitigan:

- el bloqueo de IMDS (AISEC-03);
- identidades separadas y con permisos mínimos (INFRA-03);
- el aislamiento de Chromium (AISEC-03).

Antes de activar la UDR:

- confirmar que el entorno de Container Apps es de workload profiles (lo es, por el NAT Gateway);
- desplegar el firewall con una política que permita:
  - ACA, ACR, Entra ID, DNS y las APIs de Azure;
  - los proveedores de IA, pagos (Paddle) e integraciones de clientes;
  - Cloudflare y Sentry;
- con la ruta activa, la salida deja de usar el NAT Gateway: la IP fija pasa a ser la del firewall,
  así que hay que actualizar `origin_extra_allowed_ip_ranges`;
- no agregar `DenyAllOutbound` en NSG sin esa lista aprobada.
