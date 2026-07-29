# HANDOFF — FinOpsProyect: migración del VPS a Azure Container Apps
**Fecha:** 2026-07-28

## Dónde quedó

La app corre en Azure y sirve tráfico:
`https://cscs-finops-prod-westus2-web.victoriousmoss-01886ec5.westus2.azurecontainerapps.io`

| | Estado |
|---|---|
| Terraform | 83 recursos |
| Esquema | 56 migraciones, **80 tablas — idéntico al VPS** |
| API / Database / AI Provider / Paddle | `operational` |
| Redis | `EnterpriseCluster`, 0 errores |
| Key Vault | `managed-identity`, rol `Secrets Officer` |
| Superadmin | funcionando |
| Azure Sync | `degraded` — falta el primer sync con credenciales de tenant |

Los errores `429` que aparecen en los logs son throttling de las APIs de Azure,
con reintentos y fallback funcionando. No son bugs.

## Pendientes, por urgencia

### 1. Rotar credenciales expuestas (SEGURIDAD)
`.dockerignore` **no excluía** `.env*`, así que `.env.production` —con
`AZURE_CLIENT_SECRET`, `AZURE_KEYVAULT_CLIENT_SECRET`, `CRON_SECRET`,
`DB_PASSWORD`, `GEMINI_API_KEY` y 31 variables más— viajó **dentro de las
imágenes publicadas en el ACR**. Cualquiera con permiso de pull sobre
`cscsfinopsprodglobalcr` puede extraerlas.

Corregido para builds nuevos, pero **las imágenes viejas siguen en el registry**:
rotar esos secretos y borrar los tags anteriores a la corrida `ccb`.

### 2. Cerrar el origen antes de abrir al público
`allowed_ip_ranges = []` en `prod/terraform.tfvars`. Hoy el FQDN de Container
Apps es alcanzable directo, salteando el WAF de Cloudflare.

### 3. Variables del pipeline en GitHub
`deploy-azure.yml` quedó corregido pero **nunca se ejecutó**.

*Settings → Secrets and variables → Actions → **Variables*** (públicas):
`NEXT_PUBLIC_CLIENT_ID` = `876d8a5b-6023-4484-b3ba-73c186e4a72b`,
`NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` y los 6 `NEXT_PUBLIC_PADDLE_*` de price id.

*→ **Secrets*** (SP `cscs-finops-terraform`, OIDC ya federado para `main`,
`pull_request` y `environment:prod`):
`AZURE_CLIENT_ID` = `3826973d-5d75-4039-bd31-b5ff9150f515` (**appId**, no objectId),
`AZURE_TENANT_ID` = `81ebe027-…`, `AZURE_SUBSCRIPTION_ID` = `ec03e8ce-…`.

### 4. Cuando esté estable
`resource_lock_enabled = true`.

## Trampas — leer antes de tocar

### `AZURE_CLIENT_ID` significa TRES cosas distintas
Ya rompió producción una vez. **No reusar ese nombre:**

| Contexto | Valor | Para qué |
|---|---|---|
| Secret de GitHub | `3826973d-…` | que el pipeline entre a Azure |
| `extra_env_vars` | `07d029f8-…` | que el backend hable con suscripciones de clientes |
| `AZURE_KEYVAULT_MI_CLIENT_ID` | `99141ef2-…` | que la app lea el Key Vault |

Ídem `AZURE_TENANT_ID`: como secret de GitHub va el de **CSCS** (`81ebe027`); en
`extra_env_vars` va el del **cliente** (`8b41364f`). Cruzarlos da `AADSTS700016`.

### Cambiar config de Redis REGENERA las claves de acceso
Tocar SKU, HA o clustering invalida la clave. Y **Container Apps no propaga
secretos a contenedores que ya están corriendo**. El orden es:

1. `terraform apply`
2. `az containerapp revision restart` (o nueva revisión)

Al revés no sirve: reiniciar antes del apply deja el valor viejo. Síntoma:
`WRONGPASS invalid username-password pair`, que la app reporta como
`Connection is closed` — el error real está dos capas más abajo.

### El Redis de prod NO se puede crear desde cero
`CREATE` con `high_availability=true` falla siempre en West US 2 (a los 2m10s
exactos, con B3 y con B0 por igual). El `UPDATE` de false→true sí funciona, y
`zones` queda en `null` en ambos casos: **no es capacidad zonal, es el path de
create de Azure el que está roto**.

Si hay que rehacerlo: crear con `high_availability_enabled = false`, aplicar, y
después `az redisenterprise update -n <name> -g <rg> --high-availability Enabled`.

### Probar migraciones en local, CON LA COLLATION DE AZURE
Un ciclo contra Azure son ~9 min y el runner corta en el PRIMER error.

```bash
docker run -d --name mig -e MYSQL_ROOT_PASSWORD=t -e MYSQL_DATABASE=finops \
  -p 13306:3306 mysql:8 --collation-server=utf8mb4_unicode_ci
DB_HOST=127.0.0.1 DB_PORT=13306 DB_USER=root DB_PASSWORD=t DB_NAME=finops npm run migrate
```

**El `--collation-server` no es opcional.** `mysql:8` usa `utf8mb4_0900_ai_ci`
pero Terraform crea la base de Azure con `utf8mb4_unicode_ci`
(`modules/mysql/main.tf`). Una FOREIGN KEY exige collation idéntica en ambos
lados, así que sin ese flag el local da **falso verde** y Azure revienta con
`ER_FK_INCOMPATIBLE_COLUMNS`. Pasó exactamente eso hoy.

Correr `npm run migrate` dos veces: la segunda tiene que dar
`0 aplicadas, N ya aplicadas, 0 fallidas`.

### Nunca `-lock=false` ni Terraform concurrente
Contra backend remoto produce *lost update*: varios `import` en paralelo se pisan
y sobrevive el último. Los "state lock stuck" son el síntoma, no la causa.

## Qué se arregló (por si reaparece algo parecido)

Casi todo tuvo la misma raíz: **el VPS tenía esquema y config que nunca entraron
al repo**.

**Esquema (lo más grande).** Las migraciones creaban 43 tablas; el VPS tenía 80.
Faltaban **37 tablas y 37 columnas**. Se resolvió con `mysqldump --no-data` del
VPS y `20260728-003-sincronizar-esquema-vps.sql`, con el DDL **literal** del dump
— sin inferir tipos, largos, índices ni FKs. Antes de eso habían aparecido de a
uno: `MfaChallenges`, `Anomalies`, las columnas FOCUS de `CostSnapshots` y
`Tenants.sync_status`. Eran los primeros de la lista.

`Users.scope` y `Users.permissions` eran las que tiraban 500 en
`/api/admin/config/users` y dejaban al frontend sin poder resolver `isSuperAdmin`.

**Autenticación.** El wrapper de Key Vault sólo sabía usar Service Principal (fue
escrito para el VPS). Se le agregó modo managed identity con
`ManagedIdentityCredential` **directo**, no `DefaultAzureCredential`: la cadena de
éste prueba `EnvironmentCredential` primero y tomaba el SP de CSCS, fallando con
`AADSTS7000232`. Y el rol pasó de `Secrets User` (sólo lectura) a
`Secrets Officer`, porque la app **escribe** credenciales de tenant.

**Redis.** La zona DNS privada era `privatelink.redisenterprise.cache.azure.net`
(Redis Enterprise clásico) en vez de `privatelink.redis.azure.net` (Managed Redis
v2): quedaba vacía, el hostname no resolvía y daba `ETIMEDOUT`. Y el clustering
estaba en `OSSCluster`, que exige cliente cluster-aware — `src/lib/redis.ts` usa
`new Redis(...)` a secas y fallaba con `MOVED`. Ahora `EnterpriseCluster`.

**Build.** El Dockerfile usaba `RUN --mount=type=cache`, que exige BuildKit, y
`az acr build` no lo tiene: el workflow **nunca habría podido buildear**.

**Terraform.** `subplan` no declarado en Defender hacía destroy/create de 3 planes
de seguridad en CADA apply.

## Divergencia menor pendiente

`CostSnapshots` usa `varchar(100)` en el VPS y `varchar(255)` en el bootstrap del
repo. Por eso allá el índice único entraba (1667 bytes) y acá no (4147, límite
3072). Se resolvió pasando `subscription_id` y `resource_group` a `ascii`, que
funciona y es equivalente en comportamiento, pero **no es lo que hace el VPS**.
Vale alinearlo en algún momento; no es urgente.

## Estado del repo

**Sin commits.** Todos los cambios del día están sin stagear, en `main`.
