# Evaluación de seguridad y endurecimiento de infraestructura SaaS

| **Fecha** | 9 de octubre de 2026 |
| **Alcance** | revisión de configuración versionada de Azure, Terraform y GitHub Actions, más consultas de sólo lectura a GitHub y Azure (sección 1.1) |
| **Actualizado** | 10 de octubre de 2026 (noche): verificación en vivo, cambios en el repositorio, estado de cierre por ítem (sección 6), destino A elegido para el origen y MySQL 8.4 validado en local |
| **Estado** | lo verificable está cerrado; los cambios de infraestructura quedaron preparados y apagados; lo que exige a una persona (Entra, GitHub, Azure, Cloudflare) está en la sección 7 |

## Resumen ejecutivo

La infraestructura ya aplica controles importantes: MySQL privado con TLS obligatorio, Redis privado con protocolo cifrado, secretos en Key Vault con identidades administradas, contenedores Blob privados, ACR sin usuario administrador, Defender for Cloud con siete planes en Standard y dos locks contra borrado. Los riesgos prioritarios eran la exposición directa del origen de Container Apps, la amplitud de la autenticación OIDC del workflow de Terraform (el principal tiene `Contributor` y `User Access Administrator` sobre toda la suscripción) y la dependencia de Storage en acceso de red público y claves compartidas.

**Estado al cierre del 10 de octubre de 2026** (detalle por ítem en la sección 6):

- **Cerrado con evidencia:** Defender for Cloud, diagnósticos y logs (P1), y el TLS de MySQL y Redis (P2, salvo la rotación de claves de Redis).
- **Preparado y apagado** (interruptor en Terraform, sin efecto hasta activarlo): el cierre del origen por el destino A (NAT Gateway, certificado propio y filtro a Cloudflare; Front Door se evaluó y se descartó el 10 de octubre), Blob por identidad administrada, alertas de Activity Log y Azure Policy en modo auditoría.
- **Hecho en CI:** `id-token` sólo en los jobs que hacen login (los tres workflows), las 25 referencias a Actions fijadas por SHA con Dependabot, `drift` con el mismo sujeto OIDC que el resto, y un health check de deploy que tolera un origen filtrado.
- **Abierto, con motivo:** ejecutar el destino A del origen (7.3; es también lo que resuelve el certificado gestionado del dominio, que vence el 29 de enero de 2027), identidades y usuario de MySQL (hay DDL en runtime), recuperación (el script de backup no comprueba a `mysqldump`) y la actualización de MySQL 8.0 a 8.4 (preparada y validada en local; falta ensayarla en una copia de producción y ejecutarla antes del 31 de enero de 2027, cuando Azure empieza a cobrar Extended Support).

Todo lo que cambia la seguridad de Entra, GitHub o Azure (credenciales federadas, roles, protección de ramas) lo ejecuta una persona: los comandos están en la sección 7. Los valores de producción se generan en el runner desde el secreto `TF_VARS_PROD`; los valores predeterminados de Terraform no prueban qué valores contiene ese secreto, y su contenido no se inspeccionó.

### Validación de las sugerencias recibidas

| Sugerencia | Resultado al contrastarla con el código y con Azure | Precisión importante |
|---|---|---|
| Cerrar el origen web | **Confirmada con prueba externa (10-oct-2026).** Ingress externo y 0 restricciones de IP; un GET directo a `/api/health` del FQDN de Azure desde una red externa responde 200. | El dominio propio ya pasa por Cloudflare. Cerrar el origen exige resolver antes los cron jobs, el certificado gestionado y el health check del deploy (P0). Front Door nunca se desplegó (no hay perfiles en la suscripción) y se eliminó del Terraform el 10 de octubre al elegir el destino A. |
| Revisar OIDC y tfstate | **Confirmada y más grave de lo estimado.** El principal `cscs-finops-terraform` tiene `Contributor` y `User Access Administrator` sobre la suscripción, 5 credenciales federadas, y es **el mismo** que usa el workflow de despliegue. | El job de plan usa `environment: prod` también en PR, así que su sujeto OIDC es `environment:prod`. El bootstrap no declara red privada ni firewall para tfstate. |
| Privatizar Storage y retirar claves | **Confirmada, y medida.** Shared Key activa, red pública abierta, connection string en la app. En 14 días hubo 74 accesos de la app con clave de cuenta, 360 de AzCopy con SAS (los backups) y 26 de Terraform con clave. | Apagar Shared Key rompe a esos tres clientes; la secuencia está en la sección 7. |
| Separar identidades y reducir privilegios | **Confirmada.** Web, cron y migraciones comparten la identidad asignada; la app usa el login administrador de MySQL y recibe `Key Vault Secrets Officer`. | Reducir el usuario de MySQL no es un cambio de configuración: la app ejecuta DDL en runtime (P1). El rol de Key Vault responde a la función actual de escribir y borrar credenciales de tenants. |
| Desactivar auth local de Azure AI | **Confirmada, si el recurso está habilitado.** La cuenta `ai_services` hereda `local_auth_enabled = true`; Document Intelligence sí lo fija en `false`. | `ai_services_enabled` tiene default `false`: no implica que exista una cuenta AI desplegada. |
| Defender, backups, políticas y supply chain | **Matizada.** Defender **sí está activo** en producción (7 planes) aunque el default del módulo sea `false`; los locks existen; el Backup Vault de MySQL no protege nada (`count = 0`). | `security_policy` administraba locks y una alerta de salud; ahora también puede crear alertas de Activity Log y Azure Policy en auditoría, apagadas. Las Actions pasaron a SHA fijados. |

## 1. Alcance, supuestos y limitaciones

- Se revisó configuración y documentación del repositorio. El 10 de octubre se añadieron consultas de sólo lectura a GitHub y Azure (sección 1.1); no se inspeccionaron los valores de `TF_VARS_PROD`. El archivo `infra/terraform/environments/prod/terraform.tfvars` no está versionado: `.github/workflows/terraform.yml` lo materializa desde el secreto de GitHub durante el plan y el apply.
- Los valores opcionales predeterminados en `infra/terraform/environments/prod/variables.tf` describen el comportamiento si no se proporciona un valor. No prueban la configuración de producción, que puede sobrescribirlos; por eso lo que importa se contrastó con Azure.
- `infra/docs/keyvault-network-hardening.md` documenta el endurecimiento del Key Vault como aplicado el 7 de septiembre de 2026. El 10 de octubre se confirmó en Azure: ACL `Deny`, Private Endpoint, RBAC y purge protection.
- **Visibilidad del repositorio:** es privado (`gh repo view` devuelve `visibility: PRIVATE`). Ese documento lo describía como público y se actualizó. El repositorio fue público al menos hasta el 7 de septiembre: volver a privado no retira lo que se publicó, y no se revisó el historial en busca de secretos.
- Es una revisión de configuración, no una prueba de penetración, evaluación de vulnerabilidades en ejecución ni certificación de cumplimiento. Salvo lo indicado en 1.1, no se verificaron las reglas activas de Cloudflare, la atención operativa de las alertas ni la capacidad real de restauración.
- Los hallazgos reflejan el código, la documentación y las consultas de 1.1; no se infieren valores secretos. Lo que se infiere sin haberlo medido está marcado como tal.

### 1.1 Verificación en vivo (10 de octubre de 2026)

Consultas de sólo lectura con `gh`, `az`, `curl`, `dig`, KQL contra Log Analytics y la Retail Prices API. Hubo GET a `/api/health` por el dominio propio y directo al FQDN de Azure, y un apretón TLS al origen. No se modificó nada en GitHub ni en Azure.

| Área | Resultado |
|---|---|
| Repositorio | Privado, un colaborador (administrador), workflows de forks desactivados. La cuenta tiene plan **Pro** y autenticación en dos pasos activa. |
| Protección de `main` | Disponible (la API responde "Branch not protected"), sin reglas ni rulesets. El environment `prod` no tiene reglas ni restricción de ramas. |
| Secrets de GitHub | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `TFSTATE_RG`, `TFSTATE_STORAGE` y `TF_VARS_PROD` son del repositorio, no del environment: Terraform y el deploy usan **el mismo principal**. |
| Drift semanal | De las últimas 5 corridas, 3 pasaron y 2 fallaron. La del 5 de octubre cayó en el plan de `plan-apply` (que corría también por schedule) por `ForbiddenByFirewall` del Key Vault; el job `drift` pasó. |
| Origen web | `cscs-finops-prod-westus2-web`: ingress externo, 0 restricciones de IP. GET directo a `/api/health` → 200. `ca-linkedin-mcp` también es externo y sin restricciones; no se verificó si lo gestiona este repositorio. |
| Dominio propio | `finops.cscloudsolutions.com.ar` resuelve a IP de Cloudflare y responde `server: cloudflare`: el proxy está activo. |
| Entorno de Container Apps | Workload profiles (perfil Consumption) en una VNet, **sin NAT Gateway, sin UDR y sin NSG**. IP de entrada pública `20.112.42.44`. El app lista unas 190 IPs de salida del pool regional. Su resource group gestionado (`ME_...`) sólo tiene esa IP de entrada y su load balancer: no hay IP fija de salida. El `groupId` de Private Link es `managedEnvironments` y la zona requerida `privatelink.westus2.azurecontainerapps.io`. `Microsoft.Cdn` está registrado en la suscripción. |
| Jobs | 29: 27 cron, `sync-azure-ai` y la migración. `CRON_URL` es `https://<app>.internal.<dominio del entorno>/api/cron/<job>`, que por DNS público resuelve a la **misma IP pública** que el FQDN externo. |
| Certificado del dominio | Gestionado por Azure, validación CNAME, emitido el 29-jul-2026, **vence el 29-ene-2027** (leído del certificado que sirve el origen). |
| Credenciales federadas de `cscs-finops-terraform` | Cinco, del emisor de GitHub Actions: `gh-env-prod` (`environment:prod`), `gh-pr` (`pull_request`), `gh-main` (`ref:refs/heads/main`), `gh-actions-finops-env-staging` y `gh-actions-finops-staging`. Ningún workflow ni entorno de Terraform usa `staging`. |
| Roles de ese principal | `Contributor` y `User Access Administrator` sobre la suscripción; `Storage Blob Data Contributor` sobre la cuenta de tfstate; `Key Vault Secrets User` y `Key Vault Secrets Officer` sobre el vault de producción. |
| Defender for Cloud | En Standard: StorageAccounts (DefenderForStorageV2), KeyVaults, Arm, OpenSourceRelationalDatabases, Containers, Discovery y FoundationalCspm. Contacto de seguridad con alertas y notificación a administradores activas (un correo). |
| Diagnósticos | Key Vault, MySQL, Blob y ACR envían todos los logs (`allLogs`) a Log Analytics; Redis sólo métricas; el entorno de Container Apps envía sus logs a Log Analytics. |
| Log Analytics | Retención 30 días, tope de 1 GB por día. Ingesta de 0,08 a 0,11 GB por día en los últimos 14 días y ningún evento de tope alcanzado. |
| Alertas | Una sola alerta de Activity Log en la suscripción (Service Health), ninguna regla de alerta de log y un action group con un receptor de correo. |
| MySQL | Privado, `require_secure_transport = ON`, TLS 1.2 y 1.3, HA y backup geo-redundante desactivados, retención 14 días, `Standard_B2s` (Burstable), versión 8.0.21, 64 GB aprovisionados y 0,82 GB usados. `sql_mode`: `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO`. |
| Redis | Acceso público deshabilitado, TLS mínimo 1.2, protocolo cifrado, autenticación por access key habilitada. |
| Storage de la app | ZRS, TLS 1.2, HTTPS obligatorio, **Shared Key activa**, **red pública abierta (default Allow)**, acceso anónimo a blobs desactivado, soft delete de 30 días, versionado activo; el módulo no declara retención inmutable. |
| Acceso a Blob (`StorageBlobLogs`, 14 días) | `TrustedAccessSas` 440 (servicios de Azure), `SAS` 360 (AzCopy 10.32.4: los backups), `TrustedAccess` 292 (Storage Resource Provider), `AccountKey` 74 (la app, `azsdk-js-azure-storage-blob`) y 28 más (Terraform: `HashiCorp/go-azure-sdk`, y una herramienta con `python-requests`), `OAuth` 2. |
| ACR | Basic, admin deshabilitado, pull anónimo deshabilitado, acceso público habilitado, sin retención ni cuarentena. |
| Key Vault | ACL `Deny`, un Private Endpoint, RBAC, purge protection, soft delete de 30 días; `publicNetworkAccess` habilitado a propósito para el firewall efímero del runner. |
| Precios (Retail Prices API, West US 2) | ACR: Basic 0,1666, Standard 0,6666 y Premium 1,6666 USD/día (≈ USD 5, 20 y 50 al mes; cada región replicada suma ≈ USD 50). Front Door (destino descartado): base de USD 35 (Standard) y USD 330 (Premium) al mes. NAT Gateway: USD 0,045/hora (≈ USD 33/mes) más USD 0,005/hora de IP pública Standard (≈ USD 3,65/mes) y USD 0,045/GB procesado. Endpoint privado de un entorno de Container Apps (destino descartado): USD 0,10/hora (≈ USD 73/mes). MySQL Extended Support: USD 0,07 por vCore-hora. Reglas de Activity Log y Azure Policy en auditoría: sin medidor facturable. |
| MySQL 8.0 | Según learn.microsoft.com (versión de la página del 16-sep-2026): retiro de la comunidad el 30-abr-2026, **fin del soporte estándar de Azure el 31-ene-2027**, Extended Support con cargo automático desde el 1-feb-2027. Con 2 vCores son ≈ USD 102 al mes. |
| Cloudflare | Los 15 rangos IPv4 y los 7 IPv6 del catálogo del repositorio son idénticos a las listas oficiales de cloudflare.com/ips-v4 y /ips-v6. |

### 1.2 Cambios de la jornada

- **Otra sesión (Copilot)** publicó el PR #117 y varios commits en `main` (`c88a9ac` a `0512540`), que arrastraron los tres commits previos de esta evaluación. Trajo: Checkov fijado por SHA, HTTPS obligatorio en Storage, el catálogo de rangos de Cloudflare, soporte de identidad administrada en `azureBlobStorage.ts`, dos locks `CanNotDelete` (flag `enable_delete_lock`), `concurrency` en el workflow de Terraform, `scripts/validate-terraform-apply-plan.mjs` (frena el apply ante destrucciones no pedidas o checks que no pasan) y el cierre del firewall del Key Vault que falla el job. El apply de producción (run 38087177000) terminó en success.
- **Esta sesión, primera tanda** (publicada por el usuario con el push de `58af917`; el deploy y CI terminaron en success, la revisión `--0000315` está sana y `/api/status` informa la versión `58af917`; el PR #118 de Dependabot, con 7 actualizaciones de Actions, queda sin mergear a la espera de revisión): `id-token` sólo en los jobs que hacen login en los tres workflows; las 24 referencias a Actions que quedaban por tag, fijadas por SHA, y `dependabot.yml`; health check del deploy que tolera un origen filtrado; validación de IPv4 antes de escribir en el firewall del vault; por schedule corre sólo `drift`, y `drift` usa `environment:prod`; interruptores de Terraform (origen, Blob por identidad administrada, alertas de Activity Log, Azure Policy en auditoría) con sus tests; corrección de `azureBlobStorage.ts` (ver P1 Storage); TLS explícito en el cliente de Redis; y la corrección de costos de ACR y de la premisa de repo público en `keyvault-network-hardening.md`.
- **Esta sesión, segunda tanda** (commits locales `979582f` y `2d13e9f` hasta su publicación): NAT Gateway, certificado propio, la versión de MySQL como variable y, en ese momento, también Front Door Premium con Private Link y acceso privado al entorno (todo apagado; ver P0 origen y P1 MySQL), con tests y planes contra el state real de producción.
- **Esta sesión, tercera tanda** (decisión del 10 de octubre): se eligió el destino A y se **eliminó Front Door del Terraform**, tanto lo agregado ese día como el módulo apagado que existía desde julio (el último estado está en `979582f`). El plan contra el state real quedó igual: sólo el reemplazo conocido de `deployer_secrets_officer`. MySQL 8.4 se validó en local (P1 MySQL) y el runbook del certificado pasó a generar la clave en la máquina de la persona (7.3).

### 1.3 Sigue sin verificar

El contenido de `TF_VARS_PROD`; la configuración de Cloudflare (modo SSL, reglas WAF, rate limiting, y si el CNAME estuvo en modo proxy cuando se emitió el certificado); a qué URL apuntan los webhooks de Paddle y cualquier monitor externo; qué IP de origen ve el ingress cuando un job llama al FQDN interno (la documentación no lo dice: con el NAT Gateway es la IP fija, y es lo primero que hay que medir al activar el filtro); si el servicio acepta la actualización de MySQL en Burstable por CLI o sólo por el portal; el estado actual del HTTP 406 de Azure Backup para MySQL; el comportamiento real de la condición RBAC propuesta en la sección 7 (se tomó del ejemplo oficial, no se probó contra la suscripción); y la atención operativa del correo de alertas.

## 2. Controles existentes identificados en el repositorio

Estos controles están declarados en Terraform o documentados. Los que se contrastaron con Azure el 10 de octubre figuran en 1.1.

| Área | Control identificado | Referencias |
|---|---|---|
| MySQL | Flexible Server con VNet injection (`delegated_subnet_id`) y acceso de red privado; `require_secure_transport = ON`. El cliente valida el certificado (`rejectUnauthorized: true` explícito en `src/modules/storage/db.ts`). | [`modules/mysql/main.tf`](../../infra/terraform/modules/mysql/main.tf), [`modules/stamp/main.tf`](../../infra/terraform/modules/stamp/main.tf) |
| Redis | Azure Managed Redis con acceso público deshabilitado, Private Endpoint y protocolo `Encrypted`. La autenticación por access key está habilitada. El cliente valida el certificado y exige TLS 1.2 de forma explícita. | [`modules/redis/main.tf`](../../infra/terraform/modules/redis/main.tf), [`src/lib/redis.ts`](../../src/lib/redis.ts) |
| Key Vault | El módulo declara RBAC, soft delete de 30 días y purge protection. En producción: firewall `Deny`, Private Endpoint y apertura temporal de la IP del runner durante Terraform. | [`modules/keyvault/main.tf`](../../infra/terraform/modules/keyvault/main.tf), [`keyvault-network-hardening.md`](../../infra/docs/keyvault-network-hardening.md), [workflow de Terraform](../../.github/workflows/terraform.yml) |
| Blob Storage | Los contenedores de adjuntos, logos, exportaciones y backups son privados; no se permite acceso público anidado; HTTPS obligatorio. | [`modules/storage/main.tf`](../../infra/terraform/modules/storage/main.tf) |
| ACR | `admin_enabled = false`; la identidad de la aplicación recibe `AcrPull`. | [`modules/acr/main.tf`](../../infra/terraform/modules/acr/main.tf), [`modules/stamp/main.tf`](../../infra/terraform/modules/stamp/main.tf) |
| Identidades de cargas | Una identidad administrada asignada por el usuario para Container Apps y jobs, pull desde ACR y acceso a recursos. La aplicación recibe roles de datos para Blob y Secrets Officer en Key Vault. | [`modules/stamp/main.tf`](../../infra/terraform/modules/stamp/main.tf), [`modules/containerapp/main.tf`](../../infra/terraform/modules/containerapp/main.tf), [`modules/cronjobs/main.tf`](../../infra/terraform/modules/cronjobs/main.tf) |
| Estado Terraform | El bootstrap declara TLS 1.2, bloqueo del acceso público a contenedores, Shared Key deshabilitada y acceso de datos mediante RBAC. No declara firewall, Private Endpoint ni `public_network_access_enabled = false`. También concede `Storage Blob Data Contributor` al operador mientras `grant_bootstrap_operator_access = true` (default). | [`bootstrap/main.tf`](../../infra/terraform/bootstrap/main.tf) |
| Pipeline | Locks `CanNotDelete` en MySQL y Key Vault, `concurrency` en el workflow de Terraform y una guarda que frena el apply ante destrucciones no pedidas. | [workflow de Terraform](../../.github/workflows/terraform.yml), [`validate-terraform-apply-plan.mjs`](../../scripts/validate-terraform-apply-plan.mjs) |

## 3. Recomendaciones priorizadas

### P0 — Cerrar el acceso directo al origen y reforzar la entrega web

**Estado: destino A elegido el 10 de octubre; implementado como interruptores de Terraform, apagados. El origen sigue abierto hasta que una persona los encienda (runbook 7.3).**

Lo verificado el 10 de octubre:

- El ingress es externo y no tiene restricciones; un GET directo al FQDN de Azure desde fuera responde 200. El comentario del código describe el vacío como transitorio ("sólo mientras se valida el certificado del dominio propio").
- Con cualquier regla `Allow`, el resto del tráfico entrante recibe 403 "RBAC: Access Denied", y `ipAddressRange` sólo acepta IPv4 (learn.microsoft.com, "Set up IP ingress restrictions in Azure Container Apps"). Por eso el catálogo usa los rangos IPv4 de Cloudflare y nunca la lista combinada.
- El resource group gestionado del entorno (`ME_...`) contiene una sola IP pública, la de **entrada** (`capp-svc-lb-ip`, `20.112.42.44`), y su load balancer. **No existe una IP fija de salida**: el output `outbound_ip` del stamp, que decía lo contrario, muestra la de entrada (la descripción ya está corregida).
- Hay **tres consumidores del origen que no vienen de Cloudflare**:
  1. **Los 28 jobs de cron** (27 más `sync-azure-ai`; la migración no pasa por el ingress). Llaman a `https://<app>.internal.<dominio>/api/cron/<job>`, que resuelve a la IP pública del entorno. La documentación no dice si las reglas de IP aplican a llamadas del mismo entorno ni qué IP de origen ve el ingress; lo más probable es la IP de salida de Azure del job, que no es de Cloudflare y cambia (Microsoft advierte que las IP de salida pueden cambiar; el entorno no tenía NAT Gateway). Con sólo Cloudflare en la lista, cada cron podría recibir 403 y las sincronizaciones se pararían.
  2. **El health check del deploy**, que pega al FQDN de Azure desde un runner de GitHub. Ya está resuelto: ante un 403 comprueba que la revisión nueva esté `Healthy` y `Running`.
  3. **La validación del certificado gestionado.** Microsoft exige que el app sea accesible desde las IP de DigiCert y que el CNAME apunte directo al dominio generado del app; un valor intermedio, y la página cita a Cloudflare como ejemplo, bloquea la emisión y la renovación (learn.microsoft.com, "Custom domain names and free managed certificates in Container Apps"). El dominio hoy está detrás del proxy de Cloudflare y el certificado vigente **vence el 29 de enero de 2027**.
- Permitir sólo los rangos de Cloudflare no identifica a *este* sitio: según el comportamiento conocido de Cloudflare, otra cuenta de Cloudflare puede apuntar al FQDN del origen y llegar desde esos mismos rangos. `src/proxy.ts` excluye `/api` de su matcher a propósito, así que un secreto compartido validado en la aplicación no es un cambio de una línea.
- Además, definir si `ca-linkedin-mcp` debe seguir expuesto.

**Decisión (10 de octubre): destino A, Cloudflare + NAT Gateway + certificado propio.** Se evaluó también Front Door Premium con Private Link, que exige apagar el acceso público del entorno (learn.microsoft.com, "Create a private link to an Azure Container App with Azure Front Door") y con eso Cloudflare deja de llegar al origen. Costaba ≈ USD 403 al mes (Front Door Premium USD 330 y endpoint privado del entorno USD 73) contra ≈ USD 36,5 del destino A, y obligaba a dejar Cloudflare como borde. Se construyó, se probó con planes contra el state real y se **eliminó** del Terraform; si algún día se quiere que el origen no exista en internet, el último estado del módulo está en el commit `979582f` (`git show 979582f:infra/terraform/modules/frontdoor/main.tf`).

El destino A: el ingress sigue público pero sólo acepta IPv4 de Cloudflare más la IP fija de salida del entorno (para los cron), y Cloudflare sigue como borde (WAF, CDN y DNS). Interruptores: `nat_gateway_enabled`, `custom_domain_certificate_source` (`byo_staged`, después `byo`), `origin_cloudflare_only` y `origin_extra_allowed_ip_ranges`. Costo fijo ≈ USD 36,5 al mes (NAT Gateway ≈ USD 33 y su IP ≈ USD 3,65) más USD 0,045/GB de salida. **Cierra el origen a medias:** sigue público y filtrado por IP, y no impide que otra cuenta de Cloudflare apunte a él (ver arriba). Riesgos: qué IP ve el ingress en las llamadas del mismo entorno (el NAT la fija, pero hay que medirlo) y que el NAT cambia la salida de TODO el entorno. Antes de filtrar hay que resolver la renovación del certificado de enero (P1).

Lo que quedó hecho (en `infra/terraform`), todo apagado por defecto:

- **Origen:** `origin_cloudflare_only` y `origin_extra_allowed_ip_ranges` arman `allowed_ip_ranges` con el catálogo de Cloudflare más los CIDR extra; un check impide encender el filtro sin declarar a los llamadores internos.
- **NAT Gateway** (`modules/network`): IP pública fija de salida en la subred de apps, SKU Standard (Container Apps no admite StandardV2). Output `stamp_nat_gateway_ips`.
- **Certificado propio** (`modules/custom_domain`): `certificate_source` = `managed` | `byo_staged` | `byo`, con el `.pfx` y su contraseña en dos secretos de Key Vault.
- El health check del deploy tolera el 403.

Verificación contra el state real de producción (plan sin refresh y sin lock, sólo lectura): con todo apagado, el único cambio es el reemplazo de `deployer_secrets_officer` que ya se conocía (el principal cambia entre CI y una máquina local), también después de eliminar Front Door (sin checks en rojo); con el destino A encendido, 5 recursos a crear y 1 cambio en el ingress del app; y la condición del filtro de origen se evaluó con `terraform console` en sus cuatro combinaciones.

**Aceptación:** ningún origen público permite omitir el borde, o la excepción queda aceptada por escrito; sólo se aceptan orígenes autorizados; las pruebas de acceso directo y reglas WAF/rate limit quedan registradas; el proceso de actualización de rangos tiene responsable y alerta; los cron y el certificado siguen funcionando después del cambio.

### P0 — Reducir el riesgo de OIDC y de los planes de Terraform

**Estado: parcial. Lo que es código está hecho; lo que cambia Entra o GitHub lo hace una persona (sección 7).**

Lo verificado:

- El principal `cscs-finops-terraform` tiene `Contributor` y `User Access Administrator` sobre toda la suscripción: quien obtenga un token de cualquiera de sus credenciales puede crear recursos y asignarse roles, incluido `Owner`, en toda la suscripción. **El workflow de despliegue usa el mismo principal** (ambos leen `secrets.AZURE_CLIENT_ID`, que es un secret del repositorio).
- Sus cinco credenciales federadas incluían `pull_request` y `ref:refs/heads/main`, que no llevan environment. Con los cambios de esta jornada, los tres jobs que hacen login (`plan-apply`, `drift` y `deploy`) usan `environment: prod`: la única credencial que hace falta es `gh-env-prod`.
- **Cadenas de ataque cerradas.** (a) El job `scan` heredaba `id-token: write` y ejecuta `bridgecrewio/checkov-action`; esa Action podía pedir un token con sujeto `pull_request` o `ref:refs/heads/main`. (b) El job `verificacion` del deploy (`npm ci` y la suite de tests, código de cientos de dependencias de npm, en cada push a `main`) también heredaba `id-token: write` y podía pedir un token con sujeto `ref:refs/heads/main`. Ahora `id-token` sólo está en los jobs que hacen `azure/login`.
- El repositorio es privado, los workflows de forks están desactivados y hay un único colaborador. El modelo de amenaza realista no es un PR externo sino (a) el compromiso de la cuenta propietaria y (b) una Action o una dependencia comprometida. La cuenta tiene autenticación en dos pasos activa; falta confirmar si usa llave de seguridad o passkey y revisar tokens personales.
- Se hace push directo a `main` (así lo documenta `deploy-azure.yml`), de modo que exigir un PR para todo rompería el flujo. Y con un único colaborador, un PR sin revisor distinto no agrega aprobación de nadie.
- El job de PR no es de sólo lectura: `az keyvault network-rule add/remove` corre también en `pull_request` y escribe en Azure. Separar un plan de sólo lectura obliga a resolver antes cómo se abre ese firewall.

Hecho en el repositorio:

1. `id-token: write` sólo en los jobs que hacen login; `contents: read` a nivel de workflow en los tres archivos; `scan` con `contents`, `actions` y `security-events`.
2. Las 25 referencias a Actions por SHA completo con la versión en un comentario (la de Checkov la había fijado la otra sesión; la imagen que ejecuta esa Action sigue por tag de versión, `3.3.26`, no por digest). `dependabot.yml` abre un PR semanal agrupado para actualizarlos.
3. `inputs.confirm` por `env`; los pasos "Cerrar el Key Vault" ya pasaban sus salidas por `env`; la IP que devuelve `api.ipify.org` se valida como IPv4 antes de escribirla en el firewall del vault y en `GITHUB_OUTPUT`.
4. Por schedule corre sólo `drift` (antes corría también `plan-apply`, o sea dos planes de producción por lunes), y `drift` usa `environment: prod`.
5. Probado en CI: plan en PR (run 38058662398) y plan y apply por `workflow_dispatch` (38086902781 y 38087177000), los tres en success con los permisos por job. Los cambios de `drift` y del deploy de esta jornada todavía no corrieron en CI: observar el primer lunes y el primer deploy.

Pendiente, por quien tenga acceso a Entra y GitHub (comandos en 7.1 y 7.2):

6. Borrar las credenciales federadas que ningún job usa: `gh-pr` y las dos de `staging` ya; `gh-main` después del primer `drift` con el workflow nuevo en `main`.
7. Reducir `User Access Administrator`: se puede dejar en el mismo ámbito pero con una condición que sólo permita asignar y quitar los 9 roles que Terraform realmente asigna (no `Owner`, ni `User Access Administrator`, ni `Role Based Access Control Administrator`). La condición no afecta a otras acciones de `Microsoft.Authorization/*`, como los locks. `Contributor` necesita ámbito de suscripción mientras Terraform cree el resource group (`modules/network`).
8. Activar `sha_pinning_required` en el repositorio y proteger `main` contra force-push y borrado (compatible con el push directo).
9. Separar la identidad del plan de PR (principal de sólo lectura con credencial `pull_request`, sin acceso al Key Vault) y entonces restringir el environment `prod` a la rama `main`. Hoy no se puede restringir el environment: los planes de PR corren con `environment: prod` desde la rama del PR. Cuando exista el principal de plan, el workflow se parte en un job de PR sin firewall del vault (`-refresh=false`) y uno de apply.
10. Los required reviewers y el wait timer del environment no los ofrece GitHub Pro en repositorios privados (según la documentación de GitHub, consultada el 10 de octubre de 2026, sólo Enterprise): el gate manual seguirá siendo el texto `APPLY-PROD`. No tratarlo como sustituto de una aprobación protegida.
11. Tratar el plan binario, los logs y cualquier artefacto relacionado como sensibles: reducir su contenido, controlar quién puede leerlo, limitar la retención y no publicar secretos, valores de estado ni planes sin protección.

**Aceptación:** inventario de federaciones y roles aprobado y reducido; el plan de PR no puede aplicar cambios y su único write sobre Azure (el firewall del Key Vault) está acotado y documentado, o ya no existe; el apply requiere una identidad y condiciones protegidas, o la decisión de aceptar el riesgo por no contar con required reviewers queda registrada; las Actions externas están fijadas por SHA y se actualizan por Dependabot; planes y logs sensibles tienen acceso y retención controlados.

### P1 — Eliminar claves compartidas de Storage y restringir su red

**Estado: preparado. La app puede pasar a identidad administrada con un interruptor; apagar Shared Key todavía rompe a dos clientes más.**

`modules/storage/main.tf` declara acceso de red público y una variable `shared_access_key_enabled`; `modules/stamp/main.tf` la fija en `true`. La aplicación recibe `AZURE_STORAGE_CONNECTION_STRING`. La identidad tiene `Storage Blob Data Contributor` en el scope de toda la cuenta. Los contenedores son privados, pero eso no elimina el riesgo de la clave compartida.

**Clientes de la cuenta, medidos con `StorageBlobLogs` en 14 días:**

| Cliente | Cómo se autentica | Solicitudes | Qué pasa al apagar Shared Key |
|---|---|---|---|
| La aplicación (`azsdk-js-azure-storage-blob`) | Clave de cuenta (connection string) | 74 | Se rompe, salvo que ya use identidad administrada: **migrable hoy** con `blob_managed_identity_enabled`. |
| Backups lógicos (AzCopy 10.32.4, en la VM del Hybrid Worker) | SAS firmada con la clave de la cuenta (`data.azurerm_storage_account_blob_container_sas`) | 360 | Se rompe: una SAS firmada con la clave deja de valer. Hay que pasar el runbook a AzCopy con identidad de la VM o a una SAS de delegación de usuario. |
| Terraform (`HashiCorp/go-azure-sdk`, `GetBlobServiceProperties`) | Clave de cuenta | 26 | Se rompe el refresh de `azurerm_storage_account`: hace falta `storage_use_azuread = true` en el provider y un rol de datos para el principal de Terraform sobre la cuenta. El provider de producción no lo tiene (sólo el bootstrap). |
| Servicios de Azure (`TrustedAccess`, `TrustedAccessSas`) | Acceso de confianza de servicios de Azure | 732 | No se sabe: `TrustedAccessSas` es un servicio de Azure leyendo con una SAS que este repositorio no emite. Confirmar el efecto con Azure antes de apagar la clave. |

1. **La migración de la app tenía un defecto latente**, corregido en esta jornada: `azureBlobStorage.ts` usaba `DefaultAzureCredential` cuando hay `AZURE_STORAGE_ACCOUNT_NAME`. En Container Apps esa cadena prueba primero `EnvironmentCredential` con el app registration de CSCS (`AZURE_CLIENT_ID` y `AZURE_CLIENT_SECRET`) y nunca llega a la identidad administrada; es el mismo problema, verificado el 28 de julio de 2026, que ya resolvieron `src/lib/secrets/keyvault.ts` y `src/lib/azureAiCredential.ts`. Ahora usa `ManagedIdentityCredential` con `AZURE_KEYVAULT_MI_CLIENT_ID` y cae a la cadena por defecto sólo sin esa variable (desarrollo local). El test de la credencial falla contra el código anterior.
2. `blob_managed_identity_enabled` (default `false`) agrega `AZURE_STORAGE_ACCOUNT_NAME` al app y deja la connection string: apagar el flag es el rollback.
3. Deshabilitar Shared Key sólo después de migrar los tres clientes de la tabla; retirar la connection string de los secretos del app, reiniciar y rotar las claves de la cuenta. Con la migración, `CKV2_AZURE_40` sale de las exclusiones de Checkov. Hoy `shared_access_key_enabled` está fijo en `true` en el stamp: habrá que exponerlo como variable cuando llegue ese paso.
4. Incorporar Private Endpoint para Blob y DNS privado, y deshabilitar el acceso público, una vez que aplicación, backups, despliegue y Terraform tengan rutas privadas funcionales. La VM de backups ya está en la VNet (`snet-backup-vm`); los runners de GitHub no.
5. La cuenta de **tfstate** queda con acceso público y Shared Key apagada (acceso sólo por Entra ID). Mientras el pipeline corra en runners hospedados por GitHub (IP dinámica), un Private Endpoint o un firewall por IP no es viable, como ya documenta el workflow; los *larger runners* con red privada exigen, según `keyvault-network-hardening.md`, GitHub Team o Enterprise sobre una organización, y este repositorio es de una cuenta personal (sin re-verificar). Confirmar además que el acceso humano temporal (`grant_bootstrap_operator_access`) se retire.

**Aceptación:** aplicación y procesos autorizados operan sin connection string ni Shared Key; los blobs no aceptan tráfico desde redes no autorizadas; identidad y permisos se prueban; el pipeline puede leer y escribir el state únicamente con la identidad prevista y por la ruta aprobada.

### P1 — Separar identidades de runtime y reducir privilegios de secretos

**Estado: abierto. No es un cambio de configuración: la aplicación necesita privilegios de esquema en runtime.**

La identidad administrada compartida aparece en Container Apps y cron jobs; revisar también la ruta de migraciones. El módulo de Key Vault asigna a la identidad de aplicación `Key Vault Secrets Officer`: la aplicación puede escribir y eliminar secretos, incluidas las credenciales de tenants. No es un permiso de solo lectura y amplía el impacto potencial de un compromiso.

Lo que bloquea el usuario de MySQL con privilegios mínimos (`DB_USER` es el administrador de aprovisionamiento):

- La aplicación ejecuta `CREATE TABLE IF NOT EXISTS` en runtime en `src/services/tenantAddons.service.ts` (`ensureTableExists`) y en `src/services/superAdminAiConfig.service.ts` (`GlobalSettings`). MySQL comprueba el privilegio `CREATE` antes de saber si la tabla existe, así que un usuario sin él falla aunque la tabla esté.
- `initializeDatabase()` (`src/modules/storage/db.ts`) ejecuta `runMigrations()` dentro del proceso web, y la llaman 87 archivos, entre ellos `tierLimitsGuard`. Además existe el endpoint `/api/admin/migrations/run`.

Plan sugerido, en orden: (1) mover esos dos `CREATE TABLE` a migraciones; (2) que `initializeDatabase()` no migre en producción y que las migraciones sólo corran en el job `migrate` (el endpoint administrativo usaría credenciales aparte); (3) crear el usuario de aplicación en una migración, con `SELECT`, `INSERT`, `UPDATE`, `DELETE` sobre el esquema y su contraseña como secreto de Terraform; (4) cambiar `DB_USER` y `DB_PASSWORD` del app (no de la migración); (5) prueba en el MySQL local (puerto 3307) y luego en producción.

1. Separar identidades para web, cron, migraciones y Terraform, con roles y ámbitos mínimos por función. Los cron y la migración no necesitan `Storage Blob Data Contributor` ni escribir secretos. Es un cambio de Terraform sobre unos 30 jobs: planificarlo con el paso anterior, no suelto.
2. Revisar el acceso de tenant credentials: limitar qué proceso puede escribir o borrar secretos y con qué alcance; considerar separación de vaults o asignaciones de alcance reducido donde el modelo lo permita. Documentar el impacto de `Secrets Officer` y los controles compensatorios para evitar acceso cruzado entre tenants.

**Aceptación:** matriz identidad→recurso→rol→propósito aprobada; web, cron, migración y Terraform usan principales separados; las pruebas negativas confirman que cada principal no puede leer ni escribir fuera de su función; las credenciales de base de datos de runtime no son administrativas.

### P1 — Confirmar Defender, auditoría, diagnósticos y alertas

**Estado: lo verificable está cerrado; las alertas quedaron preparadas y apagadas.**

Verificado el 10 de octubre (1.1): Defender for Cloud en Standard para Storage, Key Vault, ARM, bases de datos relacionales de código abierto y contenedores, con contacto de seguridad; diagnósticos de Key Vault, MySQL, Blob y ACR con `allLogs`; el entorno de Container Apps en Log Analytics; retención de 30 días; y una ingesta de 0,11 GB por día contra un tope de 1 GB, sin eventos de tope (los logs de seguridad no se están perdiendo). Eso también sostiene la exclusión `CKV_AZURE_163` de Checkov (el escaneo de imágenes lo cubre Defender for Containers).

Lo que faltaba, y era el hueco real: **no había alertas sobre cambios del plano de control**. La única alerta de Activity Log era la de Service Health y no había reglas de log.

- `modules/security_policy/audit.tf` crea, con `security_activity_alerts_enabled` (default `false`, por stamp), 7 alertas de Activity Log a nivel de suscripción: altas y bajas de role assignments, escritura de role definitions, y borrado de locks, de Key Vault, de MySQL y de Storage. Los nombres de operación se verificaron contra `az provider operation show`; un nombre equivocado no da error, la alerta simplemente nunca salta. Sólo status `Succeeded`, para no recibir un aviso por cada fase. No se alerta sobre `Microsoft.KeyVault/vaults/write` a propósito: el workflow abre y cierra el firewall del vault en cada plan, apply y drift.
- Un plan aislado contra la suscripción real con los dos interruptores encendidos da 17 recursos a crear, 0 a cambiar y 0 a destruir.
- Las reglas son de la suscripción: encenderlas en **un solo** stamp.

Falta: encenderlas, designar quién lee el correo del action group (hoy un solo receptor) y la prueba de extremo a extremo, creando y borrando un lock de prueba y viendo llegar el aviso. Las alertas de Entra (credenciales federadas, credenciales de service principals) viven en los logs de auditoría de Entra, no en el Activity Log, y quedan fuera de este cambio.

**Aceptación:** inventario de cobertura y licencias vigente (hecho); un evento de prueba visible para cada control crítico; alertas entregadas y atendidas por responsables designados; la retención cumple los objetivos operativos y regulatorios aplicables.

### P1 — Asegurar capacidad de recuperación, no sólo existencia de backups

**Estado: abierto.** Verificado en vivo: MySQL con retención nativa de 14 días, HA y backup geo-redundante desactivados; Storage con soft delete de 30 días y versionado, pero sin retención inmutable declarada en el módulo; dos locks `CanNotDelete` (MySQL y Key Vault) por `enable_delete_lock`, distinto de `resource_lock_enabled` de `security_policy`, que sigue en `false`.

- El módulo opcional `mysql_backup` usa `mysql_backup_enabled` (default `false`); aunque se habilite `mysql_backup_vault_enabled`, la instancia de backup de ese vault tiene `count = 0` fijo y no protege nada. El comentario de `modules/stamp/main.tf` lo atribuye a que la API de Azure Data Protection respondía HTTP 406 para MySQL Flexible Server (observado el 30 de julio de 2026; no se re-verificó). Habilitar el vault sin esa instancia crea el vault, la política y los permisos sin proteger nada.
- **El script de backup no comprueba a `mysqldump`.** El runbook de la VM ejecuta `cmd /c "mysqldump … | gzip > archivo"` y sólo verifica que el archivo exista y no esté vacío. Si `mysqldump` muere a mitad de camino, `gzip` cierra un archivo comprimido válido pero truncado y el ciclo lo sube como bueno. Corrección propuesta, sin probar en la VM (por eso no se cambió el código): volcar a un `.sql` con `--result-file`, comprobar el código de salida de `mysqldump`, comprimir en un segundo paso y comprobar el de `gzip`. El `content` del runbook tiene `ignore_changes`: editar el HCL no lo publica, hace falta el input `replace` del workflow, y hay que ensayar en la VM antes. Un gzip no vacío no valida un backup.
- Los backups lógicos dependen de Shared Key (ver Storage): migrarlos y hacer la prueba de restauración van juntos.

1. Ejecutar restauraciones de prueba de base de datos (point-in-time a un servidor nuevo, y desde un dump lógico) y de Blob; medir tiempo de recuperación e integridad, y registrar pasos, responsables y dependencias (claves, DNS, identidades, red). Crean recursos con costo: las ejecuta una persona (7.5).
2. Decidir explícitamente si se necesita HA de zona, backup geo-redundante y retención inmutable de blobs. Azure Backup Vault queda bloqueado por el HTTP 406 hasta confirmar en learn.microsoft.com que MySQL Flexible Server sea hoy una carga de trabajo soportada; mientras tanto, la vía de respaldo adicional es `mysql_backup`. Validar compatibilidad y costo por región y SKU; habilitar por etapas.
3. Mantener los locks sólo en recursos con datos y probar antes el ciclo de mantenimiento y recuperación.

**Aceptación:** RPO y RTO aprobados y alcanzables; restauraciones recientes exitosas documentadas; la política de retención y redundancia verificada contra la configuración en vivo; eliminaciones accidentales prevenidas según el riesgo sin bloquear operaciones legítimas; el backup lógico falla de forma visible si `mysqldump` falla.

### P1 — MySQL 8.0 sale del soporte estándar el 31 de enero de 2027

**Estado: preparado y validado en local contra un MySQL 8.4 real. Falta ensayar en una copia de producción y que una persona ejecute la actualización.** Hallazgo nuevo de esta jornada. El servidor de producción corre MySQL 8.0 (`8.0.21`, `Standard_B2s` Burstable, 2 vCores, 64 GB aprovisionados y 0,82 GB usados). Según la política de versiones de Azure Database for MySQL (learn.microsoft.com, página actualizada el 16 de septiembre de 2026): la comunidad retiró 8.0 el 30 de abril de 2026; el soporte estándar de Azure termina el 31 de enero de 2027; desde el 1 de febrero de 2027 el servidor se inscribe solo en Extended Support, que se factura por vCore-hora (USD 0,07 en West US 2: ≈ USD 102 al mes con 2 vCores, hoy sin cargo) y sólo recibe actualizaciones críticas de seguridad. 8.4 está en GA.

La actualización de versión mayor en el lugar (Major Version Upgrade) no cambia la cadena de conexión. Lo que dice la documentación de Microsoft y condiciona el plan:

- Es **irreversible**; el rollback es restaurar el backup a demanda previo en un servidor nuevo (con otra FQDN).
- El downtime depende del tamaño de la base y del número de tablas. Aquí la base es chica (0,82 GB), pero no hay una medición: por eso se ensaya antes en una copia.
- En un servidor **Burstable** el flujo es propio: el servicio sube temporalmente el compute tier a General Purpose (por defecto el más básico; se cobra sólo el uso real) y después se queda ahí o vuelve a `B2s`, según la elección previa. La documentación describe este flujo en el portal.
- Prerrequisitos: backup a demanda; ninguna transacción XA pendiente (`XA RECOVER;`); sin los valores de `sql_mode` retirados (`NO_AUTO_CREATE_USER`, `NO_FIELD_OPTIONS`, `NO_KEY_OPTIONS`, `NO_TABLE_OPTIONS`); y el verificador oficial de Oracle (MySQL Shell, `util.checkForServerUpgrade`), porque la **validación en línea no está disponible para 8.0 a 8.4**. Microsoft recomienda ensayar primero en una copia restaurada por punto en el tiempo.

Lo ya verificado (10 de octubre):

- `sql_mode` de producción: `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO`. Ninguno de los cuatro valores retirados. Los parámetros sobreescritos no incluyen nada obsoleto.
- Revisión estática de las 156 migraciones (6.147 líneas): sin sentencias de replicación removidas en 8.4 (`SHOW MASTER STATUS`, `CHANGE MASTER`, `START SLAVE`...), sin `mysql_native_password`, `SQL_CALC_FOUND_ROWS`, `FLOAT(M,D)`, `ZEROFILL` ni alias `utf8`; las palabras reservadas nuevas de 8.4 (`MANUAL`, `PARALLEL`, `QUALIFY`, `TABLESAMPLE`) sólo aparecen como valores entre comillas. Una revisión heurística de las claves foráneas (8.4 exige que referencien una clave única o primaria completa, `restrict_fk_on_non_standard_key`) analizó 133 y las 133 cumplen. Es un cribado, no reemplaza correr las migraciones en 8.4 (hecho, abajo).
- **Validación contra un MySQL 8.4 real** (10 de octubre; contenedores efímeros `mysql:8.4` = 8.4.11 y `mysql:8.0` = 8.0.46, con la base creada en `utf8mb4_unicode_ci` como hace Terraform en producción; no se tocó ninguna base existente):
  - Las 156 migraciones aplican sin fallas en 8.4.11 y en 8.0.46, y el esquema resultante (tablas, columnas, índices, claves foráneas, checks, rutinas, triggers, eventos y vistas: 2.616 filas de metadatos) es **idéntico** en las dos versiones. Aparte, un detalle que no depende de la versión: la cadena sólo se reproduce desde cero si la base nace con `utf8mb4_unicode_ci`; con el default del servidor, `20260823-003` falla por `ER_FK_INCOMPATIBLE_COLUMNS`, igual en 8.0 que en 8.4. No afecta a producción, pero sí a quien monte una base nueva.
  - El verificador de Oracle (MySQL Shell 8.4.10, `util.checkForServerUpgrade`, destino 8.4.10) sobre el 8.0 con el esquema completo: **0 errores**, 20 advertencias y 2 avisos. Las 20 son del chequeo `sysVarsNewDefaults`: variables de servidor con otro valor por defecto en 8.4 (por ejemplo `innodb_adaptive_hash_index` pasa a OFF e `innodb_change_buffering` a `none`); conviene comparar la latencia después de actualizar. Los 2 avisos son el privilegio `SET_USER_ID` del root del contenedor local. Los chequeos de claves foráneas, métodos de autenticación, definiciones de columna y particiones con claves con prefijo salieron limpios.
  - Prueba diferencial: las 709 sentencias SQL estáticas de `src/` (las que no llevan interpolación) se prepararon en las dos versiones. 676 pasan en ambas, 33 fallan en ambas con el mismo error (preexistentes, no de 8.4; no se analizaron) y **ninguna falla sólo en 8.4**.
  - La suite de vitest contra el 8.4: 4.992 pasan, 49 saltadas y ninguna falla. **Pesa poco como prueba de la base:** sólo `egressSqlReal.test.ts` habla con un MySQL real (1 de 5.041 pruebas); el resto usa mocks. Las pruebas que sí valen son las tres anteriores. Quedan sin cubrir las consultas dinámicas (con interpolación) y el rendimiento.
  - Ningún objeto del esquema ni SQL de `src/` usa como identificador las palabras nuevas de 8.4 (`QUALIFY`, `TABLESAMPLE`), y no hay `mysql_native_password` ni `IDENTIFIED WITH` en el repositorio.
- El driver (`mysql2` ^3.22.4) admite `caching_sha2_password`; Microsoft mantiene habilitado `mysql_native_password` en todas las versiones, así que el usuario administrador existente sigue entrando.
- Terraform no puede dispararla: `mysql_version` es una variable que sólo manda al **crear** un servidor, y el recurso ignora cambios de `version` (un plan con `mysql_version = "8.4"` contra el state real no toca MySQL). Si al terminar se conserva General Purpose, hay que actualizar `mysql_sku_name` o el plan propondrá volver a Burstable.

Falta: la copia de ensayo (7.7), que es lo único que ve la base real (usuarios, objetos fuera de las migraciones, tiempos), y elegir una ventana. Los pasos, con el rollback, están en 7.7.

**Aceptación:** el servidor corre una versión dentro de soporte estándar antes del 31 de enero de 2027, con el rollback (restauración del backup previo) probado.

### P2 — Verificar autenticación y cifrado de MySQL y Redis

**Estado: cerrado, salvo la rotación de claves de Redis.** Verificado en Azure el 10 de octubre (1.1): MySQL con `require_secure_transport = ON`, TLS 1.2 y 1.3, acceso público deshabilitado; Redis con acceso público deshabilitado, TLS mínimo 1.2 y protocolo cifrado. Del lado del cliente: MySQL fija `rejectUnauthorized: true` y TLS 1.2 mínimo (`src/modules/storage/db.ts`); el cliente de Redis pasaba sólo `{ servername }` y ahora también fija `minVersion: 'TLSv1.2'` y `rejectUnauthorized: true` (es el default de Node, pero la validación es un límite de confianza y no se deja librada a un default); el test falla contra el código anterior. Se buscaron logs que volcaran contraseñas, connection strings o el entorno completo en `src/`: no hay; los resultados nombran a la variable, no a su valor.

Falta: un ciclo de rotación de las claves de Redis probado, y evaluar la autenticación por Entra ID (Azure Managed Redis la admite; exige un cliente compatible y un cambio en `src/lib/redis.ts`, que hoy usa `REDIS_PASSWORD`).

**Aceptación:** pruebas de conexión insegura fallan; TLS y versiones negociadas comprobados (hecho); las claves de Redis no aparecen en logs ni telemetría (hecho en el código) y existe un ciclo de rotación probado (falta).

### P2 — ACR: integridad de imágenes y decisión de SKU

**Estado: recomendación de SKU hecha (mantener Basic); digest y firma abiertos.** ACR es Basic, con admin y pull anónimo deshabilitados, y Defender for Containers en Standard (escanea las imágenes que se suben, en cualquier SKU). La diferencia entre Basic y Premium es de unos USD 45 al mes (≈ USD 5 contra ≈ USD 50; cada región replicada suma otros ≈ USD 50), no los "~USD 500" que decían los comentarios de `terraform.yml` y `modules/acr/main.tf`, corregidos el 10 de octubre. Premium agregaría Private Link, retención automática, zona redundante y content trust, y con un solo stamp no hay geo-replicación que aprovechar: mantener Basic, y revisar la decisión si se necesita acceso privado al registry.

El workflow de despliegue publica `latest` y un tag con `github.sha`, y actualiza Container Apps al tag SHA: mejora la trazabilidad pero no equivale a fijar el digest. **Desplegar por digest no es un cambio de una línea:** el paso "Restaurar APP_VERSION" de `terraform.yml` deriva el SHA de Git del tag de la imagen (`${IMG##*:}`); con una referencia `repo@sha256:…` ese comando devolvería el hash del digest y escribiría un `APP_VERSION` que miente. Hay que cambiarlo a la vez.

1. Desplegar por digest, y generar y verificar procedencia y firma antes del despliegue.
2. Documentar la política de remediación de las imágenes con vulnerabilidades (Defender escanea, pero nada bloquea hoy un despliegue).

**Aceptación:** despliegues identificados por digest verificable; los escaneos bloquean o gestionan hallazgos según la severidad; la decisión de SKU y sus excepciones tienen responsable y fecha de revisión.

### P2 — Mantener al día las exclusiones de Checkov

**Estado: parcial.** La lista `skip_check` del job `scan` en `terraform.yml` refleja decisiones de julio y agosto de 2026:

- `CKV_AZURE_163` (escaneo de imágenes): vigente, Defender for Containers está en Standard (verificado el 10 de octubre).
- `CKV_AZURE_109`, `CKV_AZURE_189` y `CKV2_AZURE_32` (Key Vault con acceso público): el vault se endureció el 7 de septiembre (ACL `Deny` y Private Endpoint, confirmado en Azure). Mientras sigan excluidas, CI no detecta una regresión de esa red. Con ACL `Deny` el módulo deja `public_network_access_enabled = true`, que algunos checks siguen marcando: sin poder ejecutar Checkov localmente no se puede decidir si retirarlas, así que se mantienen. La política de Azure `keyvault-firewall` (audit.tf) cubre la regresión del lado de Azure.
- `CKV2_AZURE_40` y `CKV_AZURE_236` tienen su salida prevista en la migración de Storage y en el paso 2 de AI Services.

**Aceptación:** cada exclusión tiene un motivo vigente y una fecha de revisión; las que dependen de un control no verificado quedan marcadas hasta verificarlo.

### P2 — Introducir Azure Policy de forma gradual

**Estado: preparado.** `modules/security_policy/audit.tf` asigna, con `policy_audit_enabled` (default `false`), 10 políticas integradas con `enforce = false` sobre el resource group del stamp: red restringida, Shared Key, HTTPS y acceso anónimo de Storage; deletion protection, firewall, modelo RBAC y logs de Key Vault; red privada de MySQL; y HTTPS de Container Apps. Todas tienen efecto por defecto `Audit` o `AuditIfNotExists`; los GUID y nombres se verificaron con `az policy definition list`. `enforce = false` mide el cumplimiento y no deniega ni modifica nada. Quedan fuera el ACR (vive en el resource group global) y Redis (las definiciones integradas son del Azure Cache for Redis clásico, no de Azure Managed Redis).

Los resultados esperables, por lo medido: no cumplirían las de red y Shared Key de Storage (hoy abiertas); cumplirían las del Key Vault y MySQL.

1. Encenderlo y esperar la primera evaluación de cumplimiento (`az policy state summarize`, o el portal).
2. Corregir desviaciones, validar efectos sobre los pipelines y formalizar exclusiones con responsable y vencimiento.
3. Pasar a `Deny` o remediación sólo para requisitos probados, con despliegue progresivo y procedimiento de rollback.

**Aceptación:** resultados de auditoría revisados; excepciones justificadas y con vencimiento; pipeline probado con políticas; las políticas de enforcement no bloquean recursos existentes ni recuperación.

### P1 — Certificado gestionado del dominio (hallazgo nuevo)

**Estado: preparado; falta que una persona cargue el certificado propio y lo asocie.** El certificado del dominio propio lo emite y renueva Azure (validación CNAME), vence el 29 de enero de 2027 y el dominio está detrás del proxy de Cloudflare. Microsoft documenta que un CNAME intermedio (cita a Cloudflare como ejemplo) impide la emisión y la renovación. No se sabe si el proxy estaba activo cuando se emitió (julio) ni qué modo SSL usa Cloudflare. Si la renovación falla y Cloudflare usa "Full (strict)", los usuarios verían errores 526 a partir del vencimiento; con "Full" no se enteraría nadie, pero el origen quedaría con un certificado vencido.

Salida implementada (`modules/custom_domain`): `certificate_source` con tres valores. `managed` es el de hoy. `byo_staged` crea en el entorno un certificado propio (por ejemplo un Origin CA de Cloudflare, de hasta 15 años, con modo SSL "Full (strict)") y mantiene el gestionado. `byo` deja sólo el propio y borra el gestionado. El `.pfx` y su contraseña salen de dos secretos de Key Vault que carga una persona: la clave privada no está en el repositorio ni en ninguna variable (un test lo vigila). Terraform la lee con un data source de Key Vault, así que **queda en el state** (que vive en un storage con Shared Key deshabilitada y acceso por RBAC, ver 2). Si se quiere sacarla del state, el provider tiene el bloque `certificate_key_vault` (Container Apps importa el certificado desde el vault con la identidad del entorno); habría que comprobar antes que el servicio alcance el vault con su firewall en `Deny`. Terraform **no** cambia el binding del dominio (ignora el id del certificado: recrearlo es downtime): lo asocia una persona con `az containerapp hostname bind --certificate`, y recién después `byo` borra el gestionado, que Azure no deja borrar en uso. Verificado contra el state real: `byo_staged` crea un solo recurso (el certificado); `byo` además destruye el gestionado. La secuencia con comandos está en 7.3.

Sin esto, la alternativa es poner el registro en modo "sólo DNS" durante la ventana de renovación (desde diciembre) y recordarlo con fecha antes del 1 de diciembre de 2026.

## 4. Plan de implementación por fases

| Fase | Horizonte orientativo | Trabajo y salida requerida |
|---|---|---|
| 0 — Confirmación | Inmediata | **Hecha el 10 de octubre** (1.1), salvo lo listado en 1.3. |
| 1 — P0 | Antes del próximo despliegue relevante | **Hecho en el repositorio:** permisos por job, Actions por SHA, Dependabot, health check del deploy. **Por una persona (7.1 y 7.2):** borrar credenciales sobrantes, condicionar `User Access Administrator`, proteger `main`, `sha_pinning_required`. **Decisión tomada (10 de octubre):** destino A. Falta ejecutarlo (7.3) y resolver el certificado del dominio antes de diciembre; el código ya está, apagado. |
| 2 — P1 | Siguiente ciclo de cambio planificado | Activar alertas de Activity Log y Azure Policy en auditoría (7.4); activar Blob por identidad administrada y migrar los backups antes de apagar Shared Key (7.6); corregir el backup lógico y probar la restauración (7.5); actualizar MySQL a 8.4 antes del 31 de enero de 2027 (ensayo en una copia, validación contra un 8.4 real, ventana; 7.7); refactor del DDL en runtime y usuario de MySQL con privilegios mínimos. |
| 3 — P2 | 30–90 días, según riesgo y costo | Rotación de claves de Redis o Entra ID; despliegue por digest y firma de imágenes; pasar Azure Policy a enforcement escalonado. |

El orden y las fechas deben ajustarse al riesgo, dependencia de cambios y presupuesto. Mantener un plan Terraform revisado, aplicar en ventana controlada y disponer de rollback probado para cambios de red, identidad y políticas.

## 5. Criterios de cierre de la evaluación

La evaluación se considera atendida cuando:

- Los valores relevantes del despliegue productivo se verificaron desde fuentes autorizadas, sin incluir secretos en el documento, los logs o los artefactos (hecho salvo 1.3).
- Se cerró o aceptó formalmente cada P0 con evidencia de prueba y responsable.
- Los P1 tienen propietario, fecha objetivo y criterios de aceptación completados; las excepciones remanentes son explícitas.
- Las pruebas de acceso, restauración, telemetría y alertas se repitieron después de los cambios.
- El estado de Azure y la documentación de este repositorio coinciden, incluidos los controles de red.

## 6. Estado de cierre por ítem (10 de octubre de 2026)

| Ítem | Estado | Hecho | Falta |
|---|---|---|---|
| P0 Origen | **Destino A elegido; preparado, no cerrado** | NAT Gateway, certificado propio y filtro a Cloudflare (con un check que exige declarar a los cron); Front Door descartado y eliminado; health check del deploy; planes contra el state real | Ejecutar 7.3 (NAT, certificado, filtro) |
| P0 OIDC y planes | **Parcial** | `id-token` por job en 3 workflows; 25 Actions por SHA y Dependabot; `drift` con `environment:prod`; sin plan duplicado por schedule; IPv4 validada; 2FA verificado | Borrar credenciales, condicionar UAA, proteger `main`, `sha_pinning_required`, principal de plan separado (7.1 y 7.2) |
| P1 Storage | **Preparado** | Credencial de identidad administrada corregida; interruptor; clientes de la cuenta medidos | Activar el interruptor; migrar backups y Terraform; apagar Shared Key (7.6) |
| P1 Identidades y usuario MySQL | **Abierto** | Bloqueos identificados (DDL en runtime, migraciones en proceso) | Refactor en la aplicación; después, identidades separadas |
| P1 Defender, auditoría y alertas | **Cerrado en lo verificable; alertas preparadas** | Defender, diagnósticos y logs verificados; alertas de Activity Log (7 reglas) listas | Encenderlas, designar responsable y probar de extremo a extremo (7.4) |
| P1 Recuperación | **Abierto** | Configuración real medida; defecto del backup lógico identificado | Corregir el script y ensayarlo en la VM; restauración de prueba; decisión de HA y geo |
| P1 MySQL 8.0 | **Validado en local; con fecha** | Fechas, costo y procedimiento verificados; `sql_mode` sin valores retirados; las 156 migraciones aplican en 8.4.11 y el esquema es idéntico al de 8.0; verificador de Oracle sin errores; prueba diferencial de SQL sin regresiones; Terraform no puede dispararla | Ensayar en una copia PITR (verificador y usuarios de la base real) y ejecutar antes del 31 de enero de 2027 (7.7) |
| P1 Certificado del dominio | **Preparado, con fecha** | Vencimiento y requisitos verificados; `managed` / `byo_staged` / `byo` con planes contra el state real | Generar y cargar el certificado, asociarlo y pasar a `byo` (7.3), antes de diciembre |
| P2 MySQL y Redis | **Cerrado, salvo rotación** | TLS verificado en Azure; cliente de Redis explícito, con test | Rotación de claves de Redis o Entra ID |
| P2 ACR | **Recomendación hecha; digest abierto** | Basic confirmado y costo corregido | Despliegue por digest (con el cambio de `APP_VERSION`) y firma |
| P2 Checkov | **Parcial** | Defender Containers verificado | Decidir las exclusiones de Key Vault con Checkov a mano |
| P2 Azure Policy | **Preparado** | 10 asignaciones en auditoría, verificadas | Encenderlas y revisar el cumplimiento (7.4) |

## 7. Runbook de pasos manuales

Todo lo que sigue cambia la seguridad de Entra, de GitHub o de Azure, o requiere credenciales que no están en este repositorio: lo ejecuta una persona. Los comandos se verificaron contra la ayuda de `az` y la descripción OpenAPI oficial de GitHub; los de Azure no se ejecutaron contra la suscripción.

### 7.1 GitHub

1. Exigir que toda Action esté fijada por SHA (las 25 referencias ya lo están):

```bash
gh api -X PUT repos/manny864/finops/actions/permissions -F enabled=true -f allowed_actions=all -F sha_pinning_required=true
```

2. Proteger `main` contra force-push y borrado, sin exigir PR (se hace push directo a `main` y el deploy depende de ello). `enforce_admins` queda en `false` para no cerrar el flujo propio:

```bash
gh api -X PUT repos/manny864/finops/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

3. No se puede restringir el environment `prod` a la rama `main` hasta que exista el principal de plan separado (ver 7.2, paso 3): los planes de PR corren con `environment: prod`.

### 7.2 Entra ID y Azure

1. **Borrar las credenciales federadas sobrantes.** Las tres primeras ya no las usa ningún job. `gh-main` sólo después de que el workflow nuevo esté en `main` y haya pasado un `drift` (lunes) o un `workflow_dispatch` de prueba con la rama `main`:

```bash
APP=$(az ad app list --display-name cscs-finops-terraform --query "[0].id" -o tsv)
az ad app federated-credential delete --id "$APP" --federated-credential-id gh-pr
az ad app federated-credential delete --id "$APP" --federated-credential-id gh-actions-finops-env-staging
az ad app federated-credential delete --id "$APP" --federated-credential-id gh-actions-finops-staging
# Después del primer drift con environment:prod:
az ad app federated-credential delete --id "$APP" --federated-credential-id gh-main
```

2. **Limitar `User Access Administrator` con una condición.** Se crea la asignación nueva con condición *antes* de borrar la vieja, para no quedarse sin permisos. Los GUID son los de los 9 roles que asigna Terraform, resueltos con `az role definition list` (Key Vault Secrets Officer, Storage Blob Data Contributor, AcrPull, Virtual Machine Contributor, Automation Operator, MySQL Backup And Export Operator, Reader, Cognitive Services User y Cognitive Services OpenAI User). La condición sale del ejemplo "Constrain roles" de learn.microsoft.com (`delegate-role-assignments-examples`) y no afecta a otras acciones como los locks. **Se archiva en un archivo** para evitar problemas con `!` en el shell:

```bash
cat > /tmp/uaa-condition.txt <<'EOF'
((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {b86a8fe4-44ce-4948-aee5-eccb2c155cd7, ba92f5b4-2d11-453d-a403-e96b0029c9fe, 7f951dda-4ed3-4680-a7ca-43fe172d538d, 9980e02c-c2be-4d73-94e8-173b1dc7cf3c, d3881f73-407a-4167-8283-e981cbba0404, d18ad5f3-1baf-4119-b49b-d944edb1f9d0, acdd72a7-3385-48ef-bd42-f606fba81ae7, a97b65f3-24c7-4388-baec-2e87135dc908, 5e0bd9bd-7b93-4f28-af87-19fc36ad61bd})) AND ((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {b86a8fe4-44ce-4948-aee5-eccb2c155cd7, ba92f5b4-2d11-453d-a403-e96b0029c9fe, 7f951dda-4ed3-4680-a7ca-43fe172d538d, 9980e02c-c2be-4d73-94e8-173b1dc7cf3c, d3881f73-407a-4167-8283-e981cbba0404, d18ad5f3-1baf-4119-b49b-d944edb1f9d0, acdd72a7-3385-48ef-bd42-f606fba81ae7, a97b65f3-24c7-4388-baec-2e87135dc908, 5e0bd9bd-7b93-4f28-af87-19fc36ad61bd}))
EOF
SUB=$(az account show --query id -o tsv)
SP=$(az ad sp list --display-name cscs-finops-terraform --query "[0].id" -o tsv)
az role assignment create --assignee-object-id "$SP" --assignee-principal-type ServicePrincipal \
  --role "User Access Administrator" --scope "/subscriptions/$SUB" \
  --condition "$(cat /tmp/uaa-condition.txt)" --condition-version "2.0"
# Identificar la asignación vieja (sin condición) y borrar SÓLO esa, por id:
az role assignment list --assignee "$SP" --role "User Access Administrator" --scope "/subscriptions/$SUB" \
  --query "[].{id:id, condicion:condition}" -o table
az role assignment delete --ids "<id de la asignación SIN condición>"
```

   Después: un `workflow_dispatch` de Terraform con `confirm` vacío (sólo plan) tiene que dar el mismo resultado que antes. Si un módulo nuevo asigna otro rol, hay que agregar su GUID a la condición. No probado contra la suscripción.

3. **Plan de PR de sólo lectura** (cuando se quiera cerrar el último hueco de OIDC): crear un segundo principal con `Reader` sobre la suscripción y `Storage Blob Data Reader` sobre la cuenta de tfstate, con una única credencial federada `pull_request`, sin acceso al Key Vault; guardar su client id como secret `AZURE_PLAN_CLIENT_ID`. Con eso el workflow se parte en un job de PR (`terraform plan -refresh=false -lock=false`, sin firewall del vault) y un job de apply; y recién entonces se puede restringir el environment `prod` a `main`. La partición del workflow se hace cuando exista ese principal.

### 7.3 Cerrar el origen: Cloudflare + NAT Gateway + certificado propio (destino elegido)

Para ejecutarlo con un agente con terminal (por ejemplo Copilot en VS Code) hay una guía con las etapas en el orden recomendado, lo que se espera ver en cada una y cuándo parar: [`ejecucion-destino-a-copilot.md`](./ejecucion-destino-a-copilot.md). Esta sección es la referencia; la guía agrega el orden operativo (certificado primero, después NAT y por último el filtro).

Cada paso es un `workflow_dispatch` de Terraform con `confirm` vacío (sólo plan), lectura del resumen del plan y recién entonces `APPLY-PROD`. Las variables se editan en `TF_VARS_PROD` (desde GitHub; no se puede desde el repositorio). Antes de empezar, comprobar en Cloudflare el modo SSL y a qué URL apuntan los webhooks de Paddle y cualquier monitor externo: todo lo que le pegue al origen sin pasar por Cloudflare dejará de entrar.

**Paso 1: NAT Gateway.** En el stamp `us`:

```hcl
nat_gateway_enabled = true
```

El plan debe mostrar 4 recursos a crear (IP pública, NAT Gateway y sus dos asociaciones) y ningún cambio en el app. Cambia la salida de **todo** el entorno. Después del apply, la IP fija, y la prueba de que el entorno sale por ella (`az containerapp exec` abre una consola interactiva dentro de una réplica):

```bash
az network public-ip show -g cscs-finops-prod-westus2-rg -n cscs-finops-prod-westus2-nat-pip --query ipAddress -o tsv
az containerapp exec -g cscs-finops-prod-westus2-rg -n cscs-finops-prod-westus2-web
```

Y dentro de la consola: `node -e "fetch('https://api.ipify.org').then(r=>r.text()).then(console.log)"`. Tiene que imprimir la IP del NAT. Rollback: `nat_gateway_enabled = false`.

**Paso 2: certificado propio.** La clave privada se genera en tu máquina: no pasa por el navegador, por el repositorio ni por una variable.

a. Clave y CSR en una carpeta privada. `umask 077` hace que la clave no quede legible para otros usuarios (sin eso `openssl` la crea con permisos 644):

```bash
umask 077
mkdir ~/origen-cert && cd ~/origen-cert
openssl req -new -newkey rsa:2048 -nodes -keyout origen.key -out origen.csr -subj "/CN=finops.cscloudsolutions.com.ar"
```

RSA 2048 o ECDSA P-256; Container Apps no admite P-384 ni P-521.

b. En Cloudflare, SSL/TLS, Origin Server, Create Certificate: elegir **Use my private key and CSR** y pegar el contenido de `origen.csr` (`pbcopy < origen.csr`). En la lista de hostnames tiene que estar `finops.cscloudsolutions.com.ar` escrito de forma exacta. Cloudflare agrega por defecto el apex y el comodín de primer nivel; se pueden dejar (el 2026-10-10 se emitió así), pero la documentación de Container Apps no dice si acepta un certificado comodín para el binding, así que el nombre exacto no puede faltar. Elegir la vigencia (el máximo es 15 años) y Create. Copiar el certificado en formato PEM a un archivo `origen.pem` en la misma carpeta. Con esta opción Cloudflare nunca ve ni muestra la clave; con "Generate private key" la clave aparece una sola vez en pantalla. **Cloudflare no avisa del vencimiento de estos certificados:** anotar la fecha (`openssl x509 -in origen.pem -noout -enddate`) con un recordatorio en el calendario. Container Apps, además, marca en el panel de certificados del entorno los que vencen en menos de 60 días.

c. Armar el `.pfx` y subirlo a Key Vault con el script (desde la raíz del repositorio; por defecto lee `~/origen-cert`):

```bash
infra/scripts/subir-certificado-origen.sh
```

Hace, en este orden: comprueba que el certificado corresponda al CSR, que traiga el hostname exacto y que no esté vencido; arma el `.pfx` con una contraseña generada (3DES y SHA1, el formato clásico, porque OpenSSL 3 usa AES-256 por defecto y no se confirmó que Container Apps lo acepte; el comando se probó en el LibreSSL del Mac, 3.3.6, y en OpenSSL 3.6.3); escribe el Base64 en **una** línea (`az keyvault secret set --encoding base64` lo parte en líneas de 76 caracteres); abre el firewall del vault sólo para tu IP y **espera a que la regla propague** (el 2026-09-14 el plan de CI murió con 403 `ForbiddenByFirewall` 38 s después de abrirla); sube los dos secretos desde archivos (la contraseña no pasa por la línea de comandos); comprueba que el largo guardado sea el del archivo, sin leer el valor; y **cierra el firewall aunque algo falle**. Hace falta `az login` y el rol `Key Vault Secrets Officer` sobre el vault. Con `DRY_RUN=1` sólo hace la parte local (probada con material descartable; la parte de Azure sólo se prueba al correrlo). Si falla, dice por qué y deja el firewall cerrado; se corre de nuevo (genera otra contraseña y escribe una versión nueva de los secretos).

La carpeta con la clave **se conserva** hasta terminar el paso f: si Container Apps rechazara el formato del `.pfx` hace falta la clave para rearmarlo con otros parámetros.

d. `custom_domain_certificate_source = "byo_staged"` en el stamp. El plan debe mostrar un solo recurso nuevo, el certificado `finops-cscloudsolutions-com-ar-byo`. Apply.

e. Asociarlo al hostname (cambio en el lugar del binding, sin downtime) y comprobar que el origen sirve el nuevo:

```bash
az containerapp hostname bind --hostname finops.cscloudsolutions.com.ar -g cscs-finops-prod-westus2-rg -n cscs-finops-prod-westus2-web --environment cscs-finops-prod-westus2-cae --certificate finops-cscloudsolutions-com-ar-byo
echo | openssl s_client -connect cscs-finops-prod-westus2-web.victoriousmoss-01886ec5.westus2.azurecontainerapps.io:443 -servername finops.cscloudsolutions.com.ar 2>/dev/null | openssl x509 -noout -issuer -enddate
```

El emisor tiene que ser el Origin CA de Cloudflare. Recién entonces, en Cloudflare, modo SSL "Full (strict)", y comprobar que el sitio sigue respondiendo 200.

f. `custom_domain_certificate_source = "byo"`: el plan destruye sólo el certificado gestionado (que ya nadie usa). **El validador del apply (`scripts/validate-terraform-apply-plan.mjs`) bloquea cualquier destrucción que no sea la del input `replace`**, así que el workflow se lanza con `confirm=APPLY-PROD` **y** `replace=module.stamp["us"].module.custom_domain.azurerm_container_app_environment_managed_certificate.this[0]`. Se probó contra el state real: con ese input el plan sigue siendo un `delete` de ese certificado (no se recrea nada: el recurso ya no está en la configuración) y el validador lo deja pasar; sin él, lo bloquea con "Unapproved destructive change". El log mostrará el aviso fijo "Se va a RECREAR", que aquí no aplica. Apply. Con el sitio respondiendo, borrar la carpeta de la clave: `rm -rf ~/origen-cert`.

**Paso 3: filtrar el origen.** En `TF_VARS_PROD`:

```hcl
origin_cloudflare_only         = true
origin_extra_allowed_ip_ranges = ["<IP del NAT Gateway>/32"]
```

El plan debe mostrar sólo un cambio en el lugar de `azurerm_container_app` (las restricciones de ingress: 15 rangos de Cloudflare y la IP del NAT). Apply y verificar, en este orden:

```bash
# 1. Directo al origen: debe dar 403 (antes daba 200)
curl -s -o /dev/null -w '%{http_code}\n' https://cscs-finops-prod-westus2-web.victoriousmoss-01886ec5.westus2.azurecontainerapps.io/api/health
# 2. Por el dominio propio (Cloudflare): debe seguir en 200
curl -s -o /dev/null -w '%{http_code}\n' https://finops.cscloudsolutions.com.ar/api/health
# 3. Un cron manual debe terminar Succeeded (si da 403, el ingress ve otra IP de origen: revisar los extras)
az containerapp job start -g cscs-finops-prod-westus2-rg -n cron-prewarm-dashboard
az containerapp job execution list -g cscs-finops-prod-westus2-rg -n cron-prewarm-dashboard --query "[0].properties.status" -o tsv
```

Rollback: `origin_cloudflare_only = false` y un apply.

### 7.4 Alertas de Activity Log y Azure Policy en auditoría

En `TF_VARS_PROD`, dentro del stamp `us` (las alertas son de la suscripción: sólo en un stamp):

```hcl
security_activity_alerts_enabled = true
security_policy_audit_enabled    = true
```

Un `workflow_dispatch` de sólo plan tiene que mostrar 17 recursos a crear y ninguno a cambiar o destruir. Después del apply:

```bash
# Política: cumplimiento por asignación (tarda unos minutos en aparecer)
az policy state summarize --resource-group cscs-finops-prod-westus2-rg --query "policyAssignments[].{n:policyAssignmentId, noCumple:results.nonCompliantResources}" -o table
# Prueba de extremo a extremo de las alertas, en un resource group vacío y descartable
# (un lock sobre el RG de producción cascadea y puede romper operaciones legítimas):
# borrar el lock de prueba debe mandar el aviso "lock-delete"
az group create --name rg-prueba-alertas --location westus2
az lock create --name prueba --lock-type CanNotDelete --resource-group rg-prueba-alertas
az lock delete --name prueba --resource-group rg-prueba-alertas
az group delete --name rg-prueba-alertas --yes
```

Designar quién lee el correo del action group y revisar que llegue.

### 7.5 Restauración de prueba

Crea recursos con costo; hacerla en una ventana y borrar lo creado:

```bash
# MySQL: restauración point-in-time a un servidor NUEVO (no toca el de producción)
az mysql flexible-server restore --resource-group cscs-finops-prod-westus2-rg \
  --name cscs-finops-restore-prueba --source-server cscs-finops-prod-westus2-mysql \
  --restore-time "$(date -u -v-30M +%Y-%m-%dT%H:%M:%SZ)"
```

El servidor de producción tiene acceso privado: la restauración puede pedir `--vnet` y `--subnet` (ver `az mysql flexible-server restore --help`). Medir el tiempo, comprobar el recuento de tablas y filas contra producción, y borrar el servidor de prueba. La restauración del dump lógico y la de Blob (versiones y soft delete) se registran con la misma plantilla: pasos, tiempo, responsable y dependencias.

### 7.6 Storage: secuencia para apagar Shared Key

1. `blob_managed_identity_enabled = true` en `TF_VARS_PROD`; plan y apply. Subir un logo o un adjunto de prueba y comprobar que sale sin errores `[blob]` en los logs del app.
2. Comprobar que el acceso de la app pasó a OAuth:

```kusto
StorageBlobLogs
| where TimeGenerated > ago(1h)
| summarize Solicitudes = count() by AuthenticationType, Agente = substring(tostring(UserAgentHeader), 0, 28)
```

   Debe aparecer `azsdk-js-azure-storage-blob` con `OAuth` y dejar de aparecer con `AccountKey`.
3. Migrar el runbook de backups (AzCopy con la identidad de la VM, o SAS de delegación de usuario) y ensayarlo (7.5).
4. Agregar `storage_use_azuread = true` al provider de producción y un rol de datos para el principal de Terraform sobre la cuenta; comprobar un plan.
5. Sólo entonces: exponer `shared_access_key_enabled` como variable del stamp, retirar la connection string del app, apagar Shared Key, y volver a correr la consulta de arriba: no debe quedar ningún `AccountKey` ni `SAS` firmado con clave.

### 7.7 MySQL 8.0 a 8.4

La actualización es **irreversible** y la ejecuta una persona, en una ventana. Terraform no puede dispararla (ignora `version`). La validación contra un MySQL 8.4 real ya se hizo en local (P1 MySQL: migraciones, esquema, verificador de Oracle y prueba diferencial de SQL, sin hallazgos). Lo que sólo ve la base real es el paso 2: el ensayo en una copia.

1. **Chequeos previos.** Desde la VM de backups (está en la VNet; el servidor es privado), con la contraseña del administrador que está en el Key Vault:

```bash
# Ninguna transacción XA pendiente: debe devolver vacío
mysql -h cscs-finops-prod-westus2-mysql.mysql.database.azure.com -u <admin> -p --ssl-mode=REQUIRED -e "XA RECOVER;"
# Verificador oficial de Oracle (la validación en línea de Azure no existe para 8.0 a 8.4)
mysqlsh --uri <admin>@cscs-finops-prod-westus2-mysql.mysql.database.azure.com --ssl-mode=REQUIRED -- util checkForServerUpgrade --target-version=8.4
```

Microsoft indica que se pueden ignorar las advertencias sobre los procedimientos `mysql.az_*`. Cualquier otro hallazgo se resuelve antes.

2. **Ensayo en una copia.** Restaurar por punto en el tiempo a un servidor nuevo (el de producción es privado: la restauración puede pedir `--vnet` y `--subnet`; ver `az mysql flexible-server restore --help`), correr el verificador contra la copia, actualizar la copia, medir el tiempo que tarda y borrarla:

```bash
az mysql flexible-server restore --resource-group cscs-finops-prod-westus2-rg --name cscs-finops-upgrade-prueba \
  --source-server cscs-finops-prod-westus2-mysql --restore-time "$(date -u -v-5M +%Y-%m-%dT%H:%M:%SZ)"
```

3. **Backup a demanda de producción**, justo antes:

```bash
az mysql flexible-server backup create --resource-group cscs-finops-prod-westus2-rg --name cscs-finops-prod-westus2-mysql --backup-name pre-8-4
```

4. **Actualizar.** En el portal, Overview del servidor, Upgrade (el flujo documentado para Burstable): elegir 8.4, el compute tier General Purpose temporal (por defecto el más básico) y si al terminar se conserva o se vuelve a `B2s`. La base es chica (0,82 GB usados), pero el downtime no se midió: lo da el paso 2.

5. **Verificar:** `SELECT VERSION();` devuelve 8.4.x, `/api/health` en 200, un cron manual en Succeeded (7.3, paso 3) y la ausencia de errores de conexión en los logs del app. Si se conservó General Purpose, actualizar `mysql_sku_name` en el stamp o el siguiente plan propondrá volver a Burstable.

6. **Rollback:** restaurar el backup `pre-8-4` en un servidor nuevo, que tiene otro nombre: hay que cambiar `DB_HOST` del app. Por eso el ensayo del paso 2 es obligatorio.

Costo: durante la actualización se paga el uso real del compute tier General Purpose; se evita el Extended Support de ≈ USD 102 al mes.

## Referencias de configuración

- [Terraform de producción](../../infra/terraform/environments/prod/)
- [Módulos Terraform](../../infra/terraform/modules/)
- [Auditoría: alertas de Activity Log y Azure Policy](../../infra/terraform/modules/security_policy/audit.tf)
- [Workflow de Terraform](../../.github/workflows/terraform.yml)
- [Workflow de despliegue de Azure](../../.github/workflows/deploy-azure.yml)
- [Dependabot](../../.github/dependabot.yml)
- [Hardening de red de Key Vault](../../infra/docs/keyvault-network-hardening.md)
- [Pendientes de la aplicación](../../infra/docs/pendientes-de-app.md)
