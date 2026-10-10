# Revision de seguridad, optimizacion y Terraform - 2026-10-10

## Alcance y evidencia

Se leyo HANDOFF-PLATAFORMA-2026-10-10.md y se consulto Graphify
(13.624 nodos). El grafo corresponde a octubre 6: se uso como mapa y se
verifico el codigo actual. Se revisaron autenticacion, rutas administrativas,
tenants, cron, cache, pool, colectores, Next.js, pipelines y los 19 modulos
Terraform. No se afirma que cada linea o cada ruta haya sido auditada.

Base: main fd4846f. PR #117: 615f141. Destino verificado por Resource Graph:
ec03e8ce-ceee-4638-b303-64ae431d5b1e / westus2 /
cscs-finops-prod-westus2-rg / cscs-finops-prod-westus2-web.

## Correcciones implementadas

1. requestAuth.ts: eliminado bootstrap corporativo de SUPERADMIN en acceso
   entre tenants. Ahora exige membresia o rol persistido; no escribe roles.
2. Cuatro rutas administrativas: mock=true ya no evita OAuth/RBAC para IDs
   reales (billing portal, audit export, public-api-keys y mcp-keys).
3. Listado de tenants: una identidad sin email falla antes de consultar datos.
4. Cron Azure AI: eliminado unsafe-default; secreto de 16 caracteres minimo,
   lectura en cada request y comparacion criptografica de hashes.
5. Deploy web: deja de reemplazar imagenes de jobs programados con la imagen
   completa de Next.js. No cambia las imagenes ya desplegadas.
6. Terraform workflow: serializacion entre runs, guard previo al apply contra
   destrucciones no solicitadas/checks no resueltos y fallo visible si no se
   elimina la regla temporal del firewall de Key Vault.

## Bloqueo real del apply del PR #117

Run 38058662398, plan del 2026-10-10: 3 altas, 89 cambios y 1 destruccion.
Dos altas son locks. La tercera es recreacion de:
module.stamp["us"].module.keyvault.azurerm_role_assignment.deployer_secrets_officer[0].
Su principal_id queda desconocido por lectura diferida de azurerm_client_config.
La mayoria de actualizaciones visibles son normalizacion del tag Environment
de prod a PROD; no asumir que todas lo son sin revisar el nuevo plan.
Tambien falla el check replicas_web_acotadas: web_max_replicas=5 > 3.
CI verde NO significa que esas assertions de Terraform se hayan satisfecho:
los check blocks emiten warnings y no detienen terraform plan/apply.

Se elimino la dependencia global del stamp sobre module.acr. La espera
especifica de time_sleep.acr_pull_propagation permanece. Terraform init
-backend=false, validate y fmt -check pasaron; el nuevo plan remoto debe
confirmar que ya no propone recrear el rol del deployer.

Verificacion posterior: run 38061470356 sobre f45361c termina con **2 altas,
89 cambios y 0 destrucciones**. Desaparecio la recreacion del rol. Sigue fallando
replicas_web_acotadas (5 > 3), por lo que el nuevo guard impide el apply.
No se redujo capacidad sin validar carga ni se eludio el check con -target.

No ejecutar APPLY-PROD con este plan. Evitar -target como sustituto de resolver
la deriva. Corregir lectura diferida del principal, revisar todas las diferencias
y resolver el limite de replicas antes de aprobar un apply completo.

## Correcciones al handoff

- La variable real del PR es enable_delete_lock, no enable_resource_lock.
  Se agrego su passthrough en stamp y environment para controlarla desde
  tfvars; default true conservado. Su desactivacion elimina locks y sigue
  requiriendo aprobacion explicita de mantenimiento.
- El lock de Key Vault del PR solo existe cuando create=true. El plan observado
  lo crea en cscs-finops-prod-wus2-kv; no generalizar a vaults adoptados.
- Cloudflare all_cidrs incluye IPv6, pero ACA IP restrictions acepta IPv4.
  Usar cloudflare_ipv4_cidrs y validar cron/health checks antes de restringir.
- Blob Managed Identity es capacidad disponible, no migracion completada.
  AZURE_CLIENT_ID pertenece al App Registration: seleccionar la identidad
  user-assigned con un parametro dedicado, sin sobreescribir esa variable.
- Shared Keys permanece habilitado por dependencias de los backups actuales.

## Pendientes prioritarios

### Alta prioridad

- src/app/api/tenants/route.ts: el fallback de directorio puede dar Admin a un
  usuario no invitado. requireTenantAccess tambien concede acceso por igualdad
  de tid. Sustituir por membresia explicita y un flujo verificado de comprador/
  invitacion, cubriendo onboarding real antes de desplegar ese cambio.
- Separar autoridad de Terraform plan y apply. Los PR ejecutan Terraform con
  OIDC prod y pueden cambiar firewall; el input de confirmacion no aisla codigo
  Terraform no confiable. Usar SP de plan restringido y controles de repositorio.
- mysql_backup/main.tf: verificar exit code de mysqldump antes de comprimir y
  subir. Un gzip no vacio no prueba un dump valido. Relanzar errores finales del
  runbook. El content tiene ignore_changes: editar HCL no actualiza por si solo
  los runbooks publicados. Validar tambien una restauracion real.

### Rendimiento y fiabilidad

- cache.ts: un loader en vuelo puede repoblar datos viejos tras invalidacion.
  Fence por generacion; atomico en Redis para multiples replicas. Prueba con
  promesa diferida, invalidacion y resultado obsoleto liberado despues.
- cron/sync: no marcar ok cuando todos los tenants fallan. Heartbeat y release
  de lock condicionado al propietario para evitar sweeps superpuestos.
- intelligence/azure-ai: reutilizar single-flight en cold misses y aceptar
  inventarios vacios exitosos sin confundirlos con errores de colectores.
- Medir replicas, pool y llamadas Azure por tenant antes de aumentar paralelismo
  o reducir capacidad. No se declaran ahorros economicos sin mediciones.

### Infraestructura y red

- Nombre infra-db-password compartido: evitar colision entre stamps que adoptan
  el mismo vault. Una clave independiente por stamp o vault independiente.
- Imports incondicionales de mysql_backup[0] impiden apagado limpio del modulo.
- Dev omite retention variables requeridas; Bastion default /27 no satisface
  nuevos despliegues y la ubicacion RG/VNet requiere revision.
- Backup Vault del stamp tiene backup-instance count=0: no es una tercera
  proteccion funcional aunque vault/policy/RBAC existan.
- webhookSecurity valida DNS pero fetch vuelve a resolver: fijar conexiones a
  direcciones publicas validadas manteniendo verificacion TLS contra hostname.

## Validacion realizada antes de integrar el PR

- Typecheck: 0 errores.
- Suite completa: 4.904 pasados, 50 omitidos; 472 archivos pasados, 6 omitidos.
- Build Next.js: completado.
- Lint de codigo modificado: 0 errores; warnings existentes y tests excluidos
  por configuracion del repositorio (los tests si pasan por TypeScript/Vitest).
- Guard de plan: 7 casos pasados; contrato deploy cron: 1 caso pasado.
- Suite posterior al guard del workflow: 4.911 pasados, 50 omitidos.
- Terraform local: init -backend=false, validate y fmt -check exitosos.
- La version final integrada necesita repetir validacion y plan remoto.

La primera suite integrada revelo contaminacion de cache entre dos casos de
costByCategory.test.ts. Se aislo SWR en esa prueba de handler; la prueba
individual y cacheSingleFlight pasan. El build integrado termino correctamente.

PR #117 mergeado por squash: c88a9ac. Correcciones publicadas: f45361c.
El run 38061470356 fue solo plan: **no ejecuto Terraform apply**.

Suite integrada corregida: **4.912 pasados, 50 omitidos**. Typecheck y build
integrados exitosos; lint global: 0 errores, 3.434 warnings existentes.
CI remoto 38061780981: success. Deploy manual final solicitado: 38061845349,
commit de app 0e0f0b1 (resultado pendiente al escribir esta evidencia).

Azure metadata: MySQL publico deshabilitado, backup 14 dias, HA y geo-backup
deshabilitados. Key Vault RBAC y purge protection activos, firewall Deny.
Storage HTTPS/TLS1.2, blobs no publicos, Shared Keys habilitado por compatibilidad.
No se declara HA o recuperacion geo disponible en la configuracion actual.

No se ejecutaron pruebas de penetracion, restauraciones, benchmarks de carga
ni una auditoria de cumplimiento certificada. No se eliminaron worktrees.