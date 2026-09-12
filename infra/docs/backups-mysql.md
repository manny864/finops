# Backups de MySQL — esquema de retención y el incidente del 22/08

**Estado: ⚠️ PARCIALMENTE APLICADO — 2026-09-12.** La causa raíz está corregida
en Azure; los cambios de código de esta tanda esperan `apply` y una publicación
manual de runbooks. Ver "Qué falta" al final.

## Las dos capas de backup

| Capa | Qué es | Retención | Dónde se configura |
|---|---|---|---|
| PITR del servicio | Backup nativo del MySQL Flexible Server | 14 días, `geoRedundantBackup: Disabled` | `mysql_backup_retention_days` |
| Dump lógico | `mysqldump` + gzip a Blob Storage | daily 90 / monthly 36 meses / yearly 10 años | módulo `mysql_backup` + `storage` |

La segunda es la que cubre el borrado accidental de filas y el restore selectivo:
el PITR sólo te devuelve el servidor entero a un punto en el tiempo.

## Cómo corre el dump lógico

```
schedule "daily-backup" (Hour/2)
  └─> Orchestrator-Start-Backup-Stop   (sandbox de Azure Automation)
        ├─ prende vm-mysql-worker
        ├─ espera a que el Hybrid Worker vuelva a hacer polling
        ├─ lanza Backup-MySQL-Smart    (en la VM, grupo hwg-mysql-worker)
        │     └─ mysqldump | gzip  →  azcopy con SAS  →  db-backups/
        ├─ monitorea con tope de tiempo
        └─ apaga la VM SIEMPRE (finally, con fallback por REST)
```

El nombre del schedule es `daily-backup` pero la frecuencia es **cada 2 horas**.
Quedó así a propósito: `name` es ForceNew en `azurerm_automation_schedule` y
renombrarlo obliga a recrearlo, cosa que falla porque el `start_time` de la
config está en el pasado (`should be at least 5m0s`).

## Esquema de retención

Son **tres carpetas dentro de un mismo container**, no tres containers:

```
db-backups/finops/daily/finops_2026-09-12_2301.sql.gz   ← toda corrida (12/día)
db-backups/finops/monthly/finops_2026-09.sql.gz         ← si es día 1
db-backups/finops/yearly/finops_2026.sql.gz             ← si es 1 de enero
```

`monthly/` y `yearly/` usan **nombre fijo por período**, no el timestamp. El día 1
el schedule corre 12 veces; con el nombre timestampeado eso dejaba 12 "mensuales"
distintos. Con nombre fijo y `--overwrite=true` las 12 pisan el mismo blob y queda
exactamente uno por mes, sin importar cada cuánto corra el schedule.

El lifecycle del storage tiene **una regla por carpeta, con prefijos que no se
solapan** (`modules/storage/main.tf`):

| Regla | Prefijo | A Cool | Borra |
|---|---|---|---|
| `backups-daily-cool-then-delete` | `db-backups/finops/daily/` | 7 días | **90 días** |
| `backups-monthly-cool-then-delete` | `db-backups/finops/monthly/` | 7 días | **1095 días** (36 meses) |
| `backups-yearly-cool-then-delete` | `db-backups/finops/yearly/` | 7 días | **3650 días** (10 años) |

Los 90 días de `daily/` son el número que **ya publica el DPA**
(`docs/trust-center/DPA_EN.md:54`). Estaba en 35: la ventana real de recuperación
era menos de la mitad de la comprometida por contrato.

No hay regla catch-all sobre `db-backups/`: se solaparía con las tres y la
retención efectiva quedaría ambigua. La contra es que un blob fuera de esos tres
prefijos no lo administra nadie. Si alguna vez se agrega otra base al runbook,
hay que agregar su prefijo — el `prefix_match` del lifecycle es literal, por eso
el módulo `storage` recibe `backup_database_name`.

Si el costo de los 10 años de `yearly/` molesta, la palanca es
`tier_to_archive_after_days_since_modification_greater_than`. No está puesto a
propósito: Archive tiene rehidratación de horas.

## El incidente del 22/08 → 12/09

**21 días sin un solo dump lógico, en silencio.**

| UTC | Qué pasó |
|---|---|
| 22/08 14:04 | Último dump subido OK (`finops_2026-08-22_1404.sql.gz`) |
| 22/08 14:41 | Un apply reescribe el lifecycle policy del storage |
| **22/08 15:36** | Un apply **destruye y recrea** la variable `STORAGE_ACCOUNT_NAME` al pasarla a `encrypted = true` (venía del commit `aa16332` de Checkov, del 30/07). Queda **vacía** |
| 22/08 16:05 | Primer job roto: azcopy sube a `https://.blob.core.windows.net/…` |
| 22/08 → 03/09 | El schedule de 2 horas deja de disparar |
| 03/09 → 12/09 | Corre a diario, pero **todas** las subidas fallan |
| 12/09 20:00 | Variable restaurada a `cscsfinopsprodwestus2sa` |

**Por qué nadie se enteró durante tres semanas.** El worker usaba `Write-Error`,
que en PowerShell es *non-terminating*: el job terminaba en **`Completed`** aunque
no se hubiera subido nada. El orquestador decide si alertar mirando el estado
terminal del hijo, así que 19 fallos seguidos de azcopy no dispararon una sola
alerta. La Logic App sólo corrió el 06/09 y el 07/09, los dos días en que el hijo
directamente no arrancó.

Se descartaron con medición: el SAS es válido hasta 2029 con permisos `racwdl`,
el storage tiene `defaultAction: Allow` sin reglas de red, y no se tocó el 22/08.
El `mysqldump` funcionó bien **todos** los días: lo único roto era el destino.

### Lo que se agregó para que no vuelva a pasar

1. **Guard de variables vacías** al principio del worker. Una variable de
   Automation vacía no da error: se interpola como cadena vacía. Ahora corta
   antes de tocar la base, nombrando cuál falta.
2. **`throw` en vez de `Write-Error`** en el fallo de dump y en el de subida. El
   job termina en `Failed`, que es lo que el orquestador mira para alertar.
3. **Alerta a Teams** además de la Logic App, en `Send-Alert`, cada una en su
   propio `try/catch`: si un canal se cae, el otro avisa igual. Ninguno puede
   voltear el runbook.
4. **`teams_webhook_url` sin `default` en Terraform.** Un tfvars incompleto frena
   el `plan` en vez de publicar un canal de alertas muerto — que es exactamente
   como se rompió esto.

## Operación

**Variables de Automation** (`aa-mysql-backups`, RG `…-backup-rg`). Todas
encriptadas, así que la API devuelve `value: null` y **el state de Terraform no
es evidencia de lo que hay en Azure**: el provider nunca las lee de vuelta y
arrastra el valor de la config. La única forma de saber qué tienen es la salida
de un job.

| Variable | Origen |
|---|---|
| `MYSQL_HOST` / `MYSQL_USER` / `MYSQL_PASS` | stamp |
| `STORAGE_ACCOUNT_NAME` / `STORAGE_SAS_TOKEN` | stamp + data source del SAS |
| `ALERT_WEBHOOK_URL` | `listCallbackUrl` de la Logic App |
| `TEAMS_WEBHOOK_URL` | `teams_webhook_url`, vía el secret `TF_VARS_PROD` |

**El `content` de los runbooks no se despliega por Terraform.** Está en
`ignore_changes` (commit `9c0cdf4`) porque un cambio de `content` arrastra el
`runbook_type` mal y recrea los dos runbooks en cada apply. El `.tf` es la fuente
de verdad; publicar es un paso manual:

```bash
az rest --method put --url ".../runbooks/<nombre>/draft/content?api-version=2023-11-01" \
  --headers "Content-Type=text/powershell" --body "@runbook.ps1"
az rest --method post --url ".../runbooks/<nombre>/publish?api-version=2023-11-01"
```

**Verificar que un backup realmente subió** — el estado del job no alcanza,
mirar el blob:

```bash
az storage blob list --account-name cscsfinopsprodwestus2sa -c db-backups \
  --sas-token "$SAS" --query "[].{n:name,m:properties.lastModified}" -o tsv | sort -k2 | tail -5
```

## Qué falta

- [ ] `apply` de esta tanda: schedule a `Hour/2`, las tres reglas de lifecycle,
      el recurso `TEAMS_WEBHOOK_URL`. **Va por CI, no local**: el plan local
      quiere reemplazar `deployer_secrets_officer` porque el `principal_id` pasa
      del SP de CI al usuario que corre, y eso deja a CI sin acceso al Key Vault.
- [ ] Publicar `Backup-MySQL-Smart` y `Orchestrator-Start-Backup-Stop` con el
      guard, el `throw` y el nombre fijo por período.
- [ ] Confirmar con un blob nuevo en `db-backups/finops/daily/`.
