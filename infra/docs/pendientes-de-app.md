# Pendientes de aplicación

Cambios de código que la migración deja pedidos. Ninguno bloquea el `terraform
apply`; los dos primeros sí bloquean el **corte**.

## Estado de los bloqueantes: ninguno abierto

### 1. Aviso de cambio de subencargado — sin destinatarios

`docs/aviso-cambio-subencargado-2026.md` sigue siendo el borrador válido, pero
al 2026-07-28 **todos los tenants son de prueba**: no hay cliente real a quien
notificar, así que los 30 días de espera no aplican y el corte puede hacerse
cuando se quiera.

Lo que **sí** hay que hacer igual, porque es documentación pública:

- Publicar los textos ya actualizados (`messages/*.json` y
  `docs/trust-center/`) junto con el despliegue, para que la página no declare
  Brasil mientras la infraestructura está en West US 2.
- Enviar el aviso a partir del **primer cliente real**, si en ese momento la
  ubicación volviera a cambiar. Con el cliente ya onboardeado sobre West US 2,
  no hay nada que notificar.

### 2. Crontab del VPS — verificado, todo en orden

**Zona horaria:** el VPS corre en UTC (`date` → `Tue Jul 28 00:00:22 UTC 2026`).
Las expresiones del README eran UTC; las del tfvars son las mismas ejecuciones
reescritas en hora argentina, y el módulo las convierte de vuelta al mismo UTC.
Verificado job por job: los 14 dan exactamente la expresión documentada.

**Dónde viven:** en el crontab de **root** (36 líneas no vacías), no en el de
`manny` (1 línea). No hay systemd timers del proyecto — los que lista
`systemctl list-timers` son todos del sistema operativo.

Único chequeo que queda, opcional: el README marca `anomaly-detection`,
`cost-sync-staleness-check` y `focus-export-daily` como documentados pero **no
confirmados**. El Terraform los incluye, así que si alguno estaba apagado a
propósito, la migración lo enciende.

```bash
sudo crontab -l | grep -E '^[0-9*]' | awk '{printf "%s %s %s %s %s  ", $1,$2,$3,$4,$5; if (match($0,/api\/cron\/[a-z-]+/)) print substr($0,RSTART,RLENGTH); else print "(script local)"}'
```

## No bloquean, en orden de valor

### 3. Barrido de fechas a la zona del tenant

La plomería está hecha: `Tenants.timezone`, `src/lib/timezone.ts`,
`useTenantDateFormat()` y el endpoint `PUT /api/admin/tenant-settings`. Falta
reemplazar las llamadas sueltas, que hoy usan la zona del navegador:

```bash
grep -rn "toLocaleDateString\|toLocaleString" src/ --include="*.tsx" \
  | grep -iE "date|_at|timestamp"
```

Son ~52 usos sobre fechas en ~30 archivos (los otros ~50 `toLocaleString` son
formato de números y **no** hay que tocarlos). El patrón:

```tsx
const { formatDateTime } = useTenantDateFormat();
// antes: {new Date(t.created_at).toLocaleString()}
// ahora: {formatDateTime(t.created_at)}
```

Ya migrado: `PowerSchedules.tsx` (la parte que guarda la zona).

### 4. `currency` del onboarding, igual que `timezone`

El wizard tiene un `<select>` de moneda cuyo valor también se descarta: no hay
columna ni endpoint. `tenant-settings` es el lugar natural para agregarlo.

### 5. Blob Storage con managed identity

`src/lib/azureBlobStorage.ts` usa `BlobServiceClient.fromConnectionString`, o
sea la clave de la cuenta. Cambiándolo a `DefaultAzureCredential` con
`AZURE_STORAGE_ACCOUNT_NAME` se puede poner
`shared_access_key_enabled = false` en el módulo `storage` y dejar de tener una
clave de cuenta dando vueltas como variable de entorno.

### 6. Redis con TLS — HECHO

`src/lib/redis.ts` ahora activa TLS cuando `REDIS_TLS=true` (con `servername`
explícito para el SNI) y sube los timeouts de conexión y comando, que a 2 s
quedaban al borde con el round-trip extra del handshake y la latencia de un
servicio gestionado. Con la variable ausente o en `false` el comportamiento es
el de siempre, así que el VPS y el desarrollo local no cambian.

### 7. Filas de PowerSchedules sin zona

La migración `20260731-001` sólo convirtió las filas cuyo offset coincidía con
el de la zona del tenant. El resto sigue con el comportamiento viejo:

```sql
SELECT id, tenant_id, vm_name, shutdown_time, gmt_offset
FROM PowerSchedules WHERE timezone IS NULL AND enabled = 1;
```

Editarlas desde la UI las convierte. Mientras tengan zona `NULL` y el cliente
esté en un país con horario de verano, apagan a la hora equivocada medio año.

### 8. Acceso público del Key Vault — decisión de infra pendiente

No es código de aplicación, pero condiciona al pipeline y conviene que esté en
la misma lista. Los dos vaults (`cscs-finops-prod-wus2-kv`,
`cscs-finops-stg-wus2-kv`) tienen `publicNetworkAccess: Enabled`. El módulo de
Terraform ya sabe cerrarlos, pero hacerlo rompe el drift semanal y el apply
manual, porque Terraform gestiona dos secretos en el plano de datos del vault y
los runners de GitHub no tienen ruta a la VNet.

Análisis completo, opciones y costos en
[`keyvault-network-hardening.md`](keyvault-network-hardening.md).

### 9. Residencia de datos multi-región

`infra/docs/residencia-de-datos.md`. Lo grande es pasar las queries de `pool`
global a `resolveTenantPool(tenantId)`; la abstracción ya existe, usarla en
todos lados es una refactorización.
