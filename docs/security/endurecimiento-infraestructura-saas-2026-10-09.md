# Evaluación de seguridad y endurecimiento de infraestructura SaaS

| **Fecha** | 9 de octubre de 2026 |
| **Alcance** | revisión de configuración versionada de Azure, Terraform y GitHub Actions |
| **Estado** | evaluación documental; las recomendaciones requieren validación y priorización operativa |

## Resumen ejecutivo

La infraestructura ya aplica controles importantes: MySQL privado con TLS obligatorio, Redis privado con protocolo cifrado, secretos en Key Vault con identidades administradas, contenedores Blob privados y ACR sin usuario administrador. Los riesgos prioritarios son la posible exposición directa del origen de Container Apps, la amplitud de la autenticación OIDC del workflow de Terraform y la dependencia de Storage en acceso de red público y claves compartidas.

Esta revisión no determina la configuración desplegada. Los valores de producción se generan en el runner desde el secreto `TF_VARS_PROD`; los valores predeterminados de Terraform no prueban qué valores contiene ese secreto ni el estado actual de Azure.

### Validación de las sugerencias recibidas

| Sugerencia | Resultado al contrastarla con el código | Precisión importante |
|---|---|---|
| Cerrar el origen web | **Confirmada como riesgo condicionado.** Container Apps declara ingress externo y `allowed_ip_ranges` tiene default vacío. | Front Door está desactivado por defecto y hoy su módulo sólo implementa geo-routing; el WAF requiere Premium y sólo configura el ruleset administrado OWASP. El módulo no implementa rate limiting, protección de bots ni Private Link al origen. |
| Revisar OIDC y tfstate | **Confirmada.** El workflow ejecuta login y plan de producción también en `pull_request`; el apply sólo ocurre en `workflow_dispatch` con confirmación manual. | El job asigna `environment: prod` también en PR, por lo que el sujeto OIDC efectivo puede ser `environment:prod`, no `pull_request`. Los comentarios del workflow no sustituyen la inspección de federated credentials y RBAC reales. El bootstrap tampoco declara red privada/firewall para tfstate. |
| Privatizar Storage y retirar claves | **Confirmada.** El Storage de la app tiene acceso público habilitado, Shared Key activa, connection string para la app y `Storage Blob Data Contributor` a nivel de cuenta. | El bootstrap de tfstate sí deshabilita Shared Key, pero no declara cierre de red; además, concede RBAC al operador por defecto hasta que se cambie `grant_bootstrap_operator_access`. |
| Separar identidades y reducir privilegios | **Confirmada.** Web, cron y migraciones comparten la identidad asignada; la app usa el login administrador de MySQL y recibe `Key Vault Secrets Officer`. | El rol de Key Vault responde a la función actual de escribir y borrar credenciales de tenants; reducirlo requiere rediseñar/separar ese flujo, no sólo cambiar el rol por uno de lectura. |
| Desactivar auth local de Azure AI | **Confirmada, si el recurso está habilitado.** La cuenta `ai_services` hereda `local_auth_enabled = true`; Document Intelligence sí lo fija explícitamente en `false`. | `ai_services_enabled` tiene default `false`, por lo que esto no implica que exista o esté desplegada una cuenta AI en producción. |
| Defender, backups, políticas y supply chain | **Mayormente confirmada.** Defender, locks y los módulos opcionales de backup tienen defaults desactivados; ACR usa Basic por defecto y sin admin. | La instancia del Backup Vault de MySQL tiene `count = 0` fijo; `security_policy` administra locks y alertas, no Azure Policy. El pipeline etiqueta imágenes con el SHA de Git, pero no las despliega por digest y las Actions usan tags, no SHA fijados. |

## 1. Alcance, supuestos y limitaciones

- Se revisó configuración y documentación del repositorio, no se consultó Azure ni se inspeccionaron los valores de `TF_VARS_PROD`. El archivo `infra/terraform/environments/prod/terraform.tfvars` no está versionado: `.github/workflows/terraform.yml` lo materializa desde el secreto de GitHub durante el plan y el apply.
- Los valores opcionales predeterminados en `infra/terraform/environments/prod/variables.tf` describen el comportamiento si no se proporciona un valor. No prueban la configuración de producción, que puede sobrescribirlos.
- `infra/docs/keyvault-network-hardening.md` documenta el endurecimiento del Key Vault como aplicado y verificado el 7 de septiembre de 2026 (ACL `Deny`, Private Endpoint y allowlist vacía en esa observación). Es evidencia documental fechada, no una confirmación del estado actual; confirmar en Azure.
- La visibilidad del repositorio no está resuelta en la documentación: `infra/docs/keyvault-network-hardening.md` lo describe como público, mientras que comentarios de `.github/workflows/terraform.yml` lo describen como privado. Confirmar la visibilidad efectiva en GitHub antes de basar controles o decisiones de facturación en ella.
- Es una revisión de configuración, no una prueba de penetración, evaluación de vulnerabilidades en ejecución, auditoría de Azure en vivo ni certificación de cumplimiento. No se verificaron los permisos efectivos, las reglas activas, la cobertura de logs, las alertas ni la capacidad real de restauración.
- Los hallazgos y las prioridades reflejan el código y la documentación examinados; no se infieren valores secretos ni se afirma que una recomendación ya esté desplegada.

## 2. Controles existentes identificados en el repositorio

Estos controles están declarados en Terraform o documentados. Su presencia en el código no confirma que estén aplicados correctamente en Azure.

| Área | Control identificado | Referencias |
|---|---|---|
| MySQL | Flexible Server con VNet injection (`delegated_subnet_id`) y acceso de red privado; `require_secure_transport = ON`. La aplicación debe validar el certificado TLS. | [`modules/mysql/main.tf`](../../infra/terraform/modules/mysql/main.tf), [`modules/stamp/main.tf`](../../infra/terraform/modules/stamp/main.tf) |
| Redis | Azure Managed Redis con acceso público deshabilitado, Private Endpoint y protocolo `Encrypted`. La autenticación por access key está habilitada. | [`modules/redis/main.tf`](../../infra/terraform/modules/redis/main.tf), [`modules/stamp/main.tf`](../../infra/terraform/modules/stamp/main.tf) |
| Key Vault | El módulo declara RBAC, soft delete de 30 días y purge protection. La documentación de producción describe firewall `Deny`, Private Endpoint y apertura temporal de la IP del runner durante Terraform. | [`modules/keyvault/main.tf`](../../infra/terraform/modules/keyvault/main.tf), [`keyvault-network-hardening.md`](../../infra/docs/keyvault-network-hardening.md), [workflow de Terraform](../../.github/workflows/terraform.yml) |
| Blob Storage | Los contenedores de adjuntos, logos, exportaciones y backups son privados; no se permite acceso público anidado. | [`modules/storage/main.tf`](../../infra/terraform/modules/storage/main.tf) |
| ACR | `admin_enabled = false`; la identidad de la aplicación recibe `AcrPull`. | [`modules/acr/main.tf`](../../infra/terraform/modules/acr/main.tf), [`modules/stamp/main.tf`](../../infra/terraform/modules/stamp/main.tf) |
| Identidades de cargas | Se usa una identidad administrada asignada por el usuario para Container Apps y jobs, pull desde ACR y acceso a recursos. La aplicación recibe roles de datos para Blob y Secrets Officer en Key Vault. | [`modules/stamp/main.tf`](../../infra/terraform/modules/stamp/main.tf), [`modules/containerapp/main.tf`](../../infra/terraform/modules/containerapp/main.tf), [`modules/cronjobs/main.tf`](../../infra/terraform/modules/cronjobs/main.tf) |
| Estado Terraform | El bootstrap declara TLS 1.2, bloqueo del acceso público a contenedores, Shared Key deshabilitada y acceso de datos mediante RBAC para la cuenta de estado. No declara firewall, Private Endpoint ni `public_network_access_enabled = false`; el acceso de red público queda habilitado por defecto. También concede `Storage Blob Data Contributor` al operador mientras `grant_bootstrap_operator_access = true` (default). | [`bootstrap/main.tf`](../../infra/terraform/bootstrap/main.tf) |

## 3. Recomendaciones priorizadas

### P0 — Cerrar el acceso directo al origen y reforzar la entrega web

`modules/containerapp/main.tf` configura `external_enabled = true`. La restricción de IP se construye a partir de `allowed_ip_ranges`, cuyo valor predeterminado en producción es una lista vacía. Por tanto, **si el secreto de producción no aporta rangos efectivos**, el FQDN del Container App podría aceptar tráfico directo y permitir eludir las protecciones del proxy o WAF frontal. No se conoce el valor del secreto; comprobarlo sin exponerlo en logs.

1. Elegir y aplicar una estrategia de origen:
   - Si se conserva Cloudflare, permitir únicamente sus rangos de salida mantenidos en forma automatizada y bloquear cualquier otra conexión al origen; probar renovación de rangos y continuidad.
   - Evaluar Azure Front Door Premium con WAF y Private Link al origen como alternativa de arquitectura. Esto requiere ampliar el módulo actual: Front Door está desactivado por defecto, su módulo actual sirve para geo-routing, y no configura Private Link al origen.
2. Añadir defensas en el borde: conjunto de reglas OWASP, límites de tasa y controles contra abuso adecuados a rutas sensibles. El WAF que existe en Terraform sólo se crea con Front Door Premium y asocia `Microsoft_DefaultRuleSet` 2.1; no declara rate limiting ni reglas de bots. Asegurar que la política se aplica antes de que las solicitudes lleguen a la aplicación.
3. Probar desde una red externa que el FQDN del origen rechaza conexiones que no provienen del borde aprobado y que el tráfico legítimo sigue funcionando.

**Aceptación:** ningún origen público permite omitir el borde; solo se aceptan orígenes autorizados; las pruebas de acceso directo y reglas WAF/rate limit quedan registradas; el proceso de actualización de rangos tiene responsable y alerta.

### P0 — Reducir el riesgo de OIDC y de los planes de Terraform

`.github/workflows/terraform.yml` concede `id-token: write` a nivel del workflow, se activa con `pull_request` y ejecuta `azure/login`, escribe `TF_VARS_PROD` y hace `terraform plan` contra el state de producción. El apply está condicionado a `workflow_dispatch` y al texto `APPLY-PROD`, pero plan y apply corren en el mismo job con la misma identidad. El job usa `environment: prod` también en PR: cuando un job declara un environment, el sujeto OIDC normalmente es `repo:<owner>/<repo>:environment:prod`; por eso el comentario que menciona un sujeto `pull_request` no demuestra que ese sujeto sea el que se usa en este job. La federación exacta, secretos disponibles según el tipo de PR y permisos Azure efectivos deben comprobarse en GitHub/Entra ID.

1. Enumerar todas las credenciales federadas de Entra ID: audiencias, repositorio, sujeto exacto por evento/entorno/ref y principal asociado. Eliminar sujetos innecesarios o comodines.
2. Revisar roles y ámbitos Azure de cada principal; crear identidades distintas para plan de solo lectura y apply con escritura. No reutilizar el principal de deploy para tareas de PR.
3. Restringir `id-token: write` al job que realmente lo necesita. Mantener PRs sin permisos de escritura en Azure; separar plan de PR del plan de producción autenticado, o demostrar controles equivalentes con políticas de ramas protegidas y sujetos OIDC estrictos.
4. Exigir protección de `main`: revisiones requeridas, checks obligatorios, bloqueo de force-push y reglas para cambios de workflow/infra. Confirmar qué aprobaciones y protecciones están disponibles según la visibilidad y el plan efectivos del repositorio. El comentario del workflow afirma que los required reviewers de environments no están disponibles con el plan que se usaba; validar el plan actual y no tratar `APPLY-PROD` como sustituto de una aprobación protegida.
5. Fijar las Actions de terceros a SHA completo revisado (no sólo tags móviles). Limitar permisos `GITHUB_TOKEN` por job.
6. Tratar el plan binario, los logs y cualquier artefacto relacionado como sensibles: reducir su contenido, controlar quién puede leerlo, limitar la retención y no publicar secretos, valores de estado ni planes sin protección.

**Aceptación:** inventario de federaciones y roles aprobado; plan de PR no puede aplicar cambios ni obtener permisos de escritura; apply requiere identidad distinta y condiciones protegidas; las Actions externas están fijadas por SHA; planes y logs sensibles tienen acceso y retención controlados.

### P1 — Eliminar claves compartidas de Storage y restringir su red

`modules/storage/main.tf` declara acceso de red público y una variable `shared_access_key_enabled`; `modules/stamp/main.tf` la pasa como `true`. La aplicación recibe `AZURE_STORAGE_CONNECTION_STRING`, y `src/lib/azureBlobStorage.ts` consume esa conexión. La identidad tiene `Storage Blob Data Contributor` en el scope de toda la cuenta. Los contenedores son privados, pero eso no elimina el riesgo de acceso a la cuenta ni la exposición de una clave compartida.

1. Migrar `src/lib/azureBlobStorage.ts` y los consumidores a `DefaultAzureCredential`/identidad administrada; conservar permisos mínimos de `Storage Blob Data Contributor` sólo donde la aplicación efectivamente necesita escribir o borrar.
2. Deshabilitar Shared Key después de verificar todos los clientes y procesos de operación; retirar connection strings de secretos/configuración, reiniciar servicios y rotar/revocar credenciales antiguas.
3. Incorporar Private Endpoint para Blob y DNS privado. Deshabilitar el acceso público una vez que aplicación, procesos administrativos y despliegue tengan rutas privadas funcionales.
4. Aplicar la misma revisión de red y acceso de datos a la cuenta de **tfstate**. Aunque `bootstrap/main.tf` deshabilita Shared Key y asigna RBAC, confirmar acceso público, firewall/Private Endpoint, DNS, identidades CI y acceso humano temporal; no bloquear el pipeline antes de garantizar su conectividad.

**Aceptación:** aplicación y procesos autorizados operan sin connection string ni Shared Key; blobs no aceptan tráfico desde redes no autorizadas; identidad y permisos se prueban; el pipeline puede leer/escribir el state únicamente con la identidad prevista y por la ruta aprobada.

### P1 — Separar identidades de runtime y reducir privilegios de secretos

La identidad administrada compartida aparece en Container Apps y cron jobs; revisar también la ruta de migraciones. El módulo de Key Vault asigna a la identidad de aplicación `Key Vault Secrets Officer`. Según `modules/keyvault/main.tf`, esto permite que la aplicación gestione secretos, incluida la escritura y eliminación de credenciales de tenants: no es un permiso de solo lectura y amplía el impacto potencial de un compromiso.

1. Separar identidades para web, cron, migraciones y Terraform, con roles y ámbitos mínimos por recurso y función. Evitar que cron o migraciones hereden permisos de web sin necesidad demostrada.
2. Revisar el usuario de runtime de MySQL: no usar el administrador de aprovisionamiento para consultas normales. Crear cuenta de aplicación con permisos mínimos sobre el esquema requerido; reservar administración de esquema para una identidad/job de migración.
3. Revisar acceso de tenant credentials. Limitar qué proceso puede escribir/borrar secretos y por qué alcance; considerar separación de vaults o asignaciones de alcance reducido donde el modelo lo permita. Documentar el impacto de `Secrets Officer` y los controles compensatorios para evitar acceso cruzado entre tenants.

**Aceptación:** matriz identidad→recurso→rol→propósito aprobada; web/cron/migración/Terraform usan principales separados; las pruebas negativas confirman que cada principal no puede leer/escribir fuera de su función; credenciales de base de datos de runtime no son administrativas.

### P1 — Confirmar Defender, auditoría, diagnósticos y alertas

Defender for Cloud es opcional (`defender_enabled` tiene default `false`); no asumir que está habilitado por el mero hecho de que el módulo existe. Hay configuración de diagnósticos para Key Vault, MySQL, Redis (métricas) y Blob, además de monitorización de aplicación, pero no se verificaron recursos activos, destino, retención, alertas ni atención operativa.

1. Confirmar en la suscripción los planes Defender contratados/habilitados (incluidos Key Vault, Storage y contenedores), cobertura real de ACR y destinatarios de alertas.
2. Validar diagnostic settings y eventos recibidos en Log Analytics, especialmente lecturas/escrituras/eliminaciones de secretos, operaciones Blob, cambios de red/IAM y actividad administrativa.
3. Definir retención, alertas accionables, responsables y pruebas periódicas de extremo a extremo. Revisar si logs de control de acceso deben complementar los diagnósticos de datos.

**Aceptación:** inventario de cobertura y licencias vigente; evento de prueba visible para cada control crítico; alertas entregadas y atendidas por responsables designados; retención cumple objetivos operativos y regulatorios aplicables.

### P1 — Asegurar capacidad de recuperación, no sólo existencia de backups

En `environments/prod/variables.tf`, los defaults incluyen MySQL HA y backup geo-redundante desactivados y Backup Vault deshabilitado. El PITR nativo de MySQL sí se configura con 14 días por defecto. El módulo opcional `mysql_backup` usa `mysql_backup_enabled` (default `false`); además, aunque se habilite `mysql_backup_vault_enabled`, la instancia de backup de ese vault tiene `count = 0` fijo y no queda protegida por esa ruta. Storage define retención de blobs, pero no retención inmutable/WORM en este módulo. Los locks contra borrado están condicionados por `resource_lock_enabled` (default `false`). El secreto de producción puede cambiar estos defaults y habilitar otras rutas; no se conoce su valor ni se verificó el estado en vivo.

1. Confirmar el plan desplegado de MySQL, redundancia/retención, Backup Vault y locks; cotejarlo con RPO/RTO acordados y requisitos de disponibilidad y residencia.
2. Ejecutar restauraciones de prueba de base de datos y Blob, medir tiempo de recuperación e integridad, y registrar pasos, responsables y dependencias (claves, DNS, identidades, red).
3. Decidir explícitamente si se necesita HA de zona, backup geo-redundante, Azure Backup Vault y protección contra borrado. Validar su compatibilidad/costo por región y SKU; habilitar por etapas, no por default ciego.
4. Si los locks son necesarios, activarlos sólo en recursos con datos y probar antes el ciclo de mantenimiento y recuperación.

**Aceptación:** RPO/RTO aprobados y alcanzables; restauraciones recientes exitosas documentadas; política de retención y redundancia verificadas contra configuración en vivo; eliminaciones accidentales prevenidas según riesgo sin bloquear operaciones legítimas.

### P2 — Verificar autenticación y cifrado de MySQL y Redis

Terraform requiere transporte seguro en MySQL y configura Redis con protocolo cifrado y autenticación por access key. Verificar el lado cliente y la operación real: MySQL debe validar certificados (`ssl.rejectUnauthorized = true`, según el comentario de `modules/mysql/main.tf`), y las claves de Redis deben manejarse y rotarse de forma segura. Revisar si puede sustituirse la autenticación por clave de Redis por una opción Entra ID/identidad administrada compatible con el servicio y cliente.

**Aceptación:** pruebas de conexión insegura fallan; TLS/certificados y versiones negociadas se comprueban; claves de Redis no aparecen en logs/telemetría y existe ciclo de rotación probado.

### P2 — ACR: integridad de imágenes y decisión de SKU

ACR deshabilita el usuario admin; la identidad administrada hace `AcrPull`. El valor predeterminado de acr_sku es Basic; los comentarios describen georreplicación, zona redundante, endpoints privados y content trust como funciones de Premium, con una diferencia de costo sustancial. El SKU efectivo de producción no se conoce. El workflow de despliegue publica tanto `latest` como un tag basado en `github.sha` y actualiza Container Apps al tag SHA; esto mejora la trazabilidad frente a `latest`, pero no equivale a fijar el digest de la imagen. No subir SKU sólo para marcar un check sin validar el beneficio y el presupuesto.

1. Complementar los tags mutables con despliegue por digest; generar/proteger procedencia y firma de imágenes, y verificarla antes del despliegue.
2. Confirmar escaneo de vulnerabilidades y política de remediación (Defender u otra herramienta), retención y bloqueo de imágenes vulnerables.
3. Documentar el análisis Basic/Premium considerando volumen, replicación, acceso de red, firma/confiabilidad, disponibilidad y costo.

**Aceptación:** despliegues identificados por digest verificable; escaneos bloquean o gestionan hallazgos según severidad; decisión de SKU y excepciones tiene responsable y fecha de revisión.

### P2 — Introducir Azure Policy de forma gradual

Usar Azure Policy para sostener controles de red, TLS, diagnóstico, identidades y recursos aprobados, evitando asignar de inmediato políticas `Deny` que rompan Terraform o recursos heredados.

1. Inventariar recursos y excepciones; probar políticas en modo auditoría (`Audit`/`AuditIfNotExists`) con alcance inicialmente acotado.
2. Corregir desviaciones, validar efectos sobre los pipelines y formalizar exclusiones con responsable y vencimiento.
3. Pasar a `Deny`/remediación sólo para requisitos probados, con despliegue progresivo y procedimiento de rollback.

**Aceptación:** resultados de auditoría revisados; excepciones justificadas y con vencimiento; pipeline probado con políticas; las políticas de enforcement no bloquean recursos existentes ni recuperación.

## 4. Plan de implementación por fases

| Fase | Horizonte orientativo | Trabajo y salida requerida |
|---|---|---|
| 0 — Confirmación | Inmediata | Verificar valores efectivos sin imprimir secretos, estado Azure del Key Vault, rangos de origen, identidades OIDC/roles, visibilidad del repo y estado de backup/Defender. Guardar evidencia fechada y propietarios. |
| 1 — P0 | Antes del próximo despliegue relevante | Cerrar bypass de origen y probar WAF/rate limits; reducir y separar OIDC plan/apply; proteger `main`, fijar Actions y tratar planes como datos sensibles. No conceder escrituras a PRs. |
| 2 — P1 | Siguiente ciclo de cambio planificado | Migrar Storage a identidad administrada y red privada; separar identidades y usuario MySQL; confirmar telemetría y alertas; definir y probar restauración y protección contra borrado. |
| 3 — P2 | 30–90 días, según riesgo/costo | Endurecer controles de autenticación/TLS; introducir firma, digest y escaneo de imágenes; probar Azure Policy en auditoría y hacer enforcement escalonado. |

El orden y las fechas deben ajustarse al riesgo, dependencia de cambios y presupuesto. Mantener un plan Terraform revisado, aplicar en ventana controlada y disponer de rollback probado para cambios de red, identidad y políticas.

## 5. Criterios de cierre de la evaluación

La evaluación se considera atendida cuando:

- Los valores relevantes del despliegue productivo se verificaron desde fuentes autorizadas, sin incluir secretos en el documento, los logs o los artefactos.
- Se cerró o aceptó formalmente cada P0 con evidencia de prueba y responsable.
- Los P1 tienen propietario, fecha objetivo y criterios de aceptación completados; las excepciones remanentes son explícitas.
- Las pruebas de acceso, restauración, telemetría y alertas se repitieron después de los cambios.
- El estado de Azure y la documentación de este repositorio coinciden, incluidos visibilidad del repositorio y controles de red.

## Referencias de configuración

- [Terraform de producción](../../infra/terraform/environments/prod/)
- [Módulos Terraform](../../infra/terraform/modules/)
- [Workflow de Terraform](../../.github/workflows/terraform.yml)
- [Workflow de despliegue de Azure](../../.github/workflows/deploy-azure.yml)
- [Hardening de red de Key Vault](../../infra/docs/keyvault-network-hardening.md)
- [Pendientes de la aplicación](../../infra/docs/pendientes-de-app.md)