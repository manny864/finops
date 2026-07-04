# Runbook — Backup y Restore de MySQL (Fase 1)

**Plan:** [vps-infra-improvement-plan.md](vps-infra-improvement-plan.md) · **Script:** `scripts/backup-db.sh`
**Topología confirmada:** MySQL corre dockerizado en un compose project **separado** de la app (`~/cscloud/database`, servicio `mysql`). La app vive en `~/cscloud/finops`.

---

## 1. Arquitectura del backup

```
cron (VPS, 03:00)
  └─ scripts/backup-db.sh
       ├─ mysqldump dentro del contenedor MySQL (--single-transaction, sin locks)
       ├─ gzip → ~/cscloud/finops/backups/daily/finops-<db>-<ts>.sql.gz
       ├─ domingo → copia a backups/weekly/
       ├─ rotación: 7 diarios + 4 semanales (28 días)
       ├─ off-site: PUT a Azure Blob Storage vía SAS URL (curl, sin az CLI)
       └─ ping healthchecks.io (opcional, Fase 2)
```

- **RPO:** 24 h (dump diario). **RTO:** minutos (restore local) / ~10 min (descarga desde Azure + restore).
- El upload off-site que falla **no** aborta el backup local; se reporta por log y healthcheck.
- Redis no se respalda: hoy es 100 % cache regenerable.

## 2. Provisioning del Storage Account (una sola vez, desde tu máquina)

Principios FinOps/seguridad aplicados: tier **Cool** (acceso infrecuente), **LRS** (el dato primario vive en el VPS; la redundancia geo no se justifica aún), lifecycle policy que borra blobs viejos (la retención larga la dan las copias semanales locales), y SAS de contenedor con permisos **solo `cw`** (create/write): un VPS comprometido **no puede leer ni borrar** los backups existentes.

```bash
# Variables (ajustar RG/región a lo que ya usen para el Key Vault)
RG="cscs-rg-finops-prod"
LOC="brazilsouth"
SA="cscsfinopsbackups"          # 3-24 chars, solo minúsculas y números, único global
CONTAINER="mysql-backups"

# 1. Storage account: Cool, LRS, solo HTTPS, TLS 1.2, sin acceso público a blobs
az storage account create \
  --name "$SA" --resource-group "$RG" --location "$LOC" \
  --sku Standard_LRS --kind StorageV2 --access-tier Cool \
  --https-only true --min-tls-version TLS1_2 \
  --allow-blob-public-access false

# 2. Contenedor
az storage container create \
  --name "$CONTAINER" --account-name "$SA" --auth-mode login

# 3. Lifecycle: borrar blobs con más de 35 días (cubre 4 semanas + margen)
az storage account management-policy create \
  --account-name "$SA" --resource-group "$RG" \
  --policy '{
    "rules": [{
      "enabled": true,
      "name": "delete-old-backups",
      "type": "Lifecycle",
      "definition": {
        "filters": { "blobTypes": ["blockBlob"] },
        "actions": { "baseBlob": { "delete": { "daysAfterModificationGreaterThan": 35 } } }
      }
    }]
  }'

# 4. SAS de contenedor, permisos SOLO create+write, vigencia 1 año
az storage container generate-sas \
  --name "$CONTAINER" --account-name "$SA" \
  --permissions cw \
  --expiry "$(date -v+1y +%Y-%m-%d 2>/dev/null || date -d '+1 year' +%Y-%m-%d)" \
  --https-only --output tsv
```

La SAS URL completa queda: `https://<SA>.blob.core.windows.net/<CONTAINER>?<token-del-paso-4>`

> **Rotación:** la SAS vence en 1 año. Anotar recordatorio (ver `plan.md`) para regenerarla antes del vencimiento. Si se filtra, se revoca rotando la account key (`az storage account keys renew`).

**Costo estimado:** dumps comprimidos de decenas de MB × ~35 retenidos → ≤ 2-3 GB en tier Cool ≈ **< $0.05/mes**. Dentro del presupuesto "$0–1/mes" de la Fase 1.

## 3. Instalación en el VPS (una sola vez, por SSH)

```bash
# 1. Agregar la SAS URL al .env de la app (NO commitear)
echo 'BACKUP_AZURE_SAS_URL=https://<SA>.blob.core.windows.net/<CONTAINER>?<sas-token>' >> ~/cscloud/finops/.env

# 2. Log con permisos del usuario
sudo touch /var/log/finops-backup.log && sudo chown $(whoami) /var/log/finops-backup.log

# 3. Permiso de ejecución (git conserva el bit, pero por las dudas)
chmod +x ~/cscloud/finops/scripts/backup-db.sh

# 4. Corrida manual de prueba ANTES de instalar el cron
~/cscloud/finops/scripts/backup-db.sh

# 5. Instalar el cron (idempotente: no duplica si ya existe)
( crontab -l 2>/dev/null | grep -v 'backup-db.sh'; \
  echo '0 3 * * * /home/manny/cscloud/finops/scripts/backup-db.sh >> /var/log/finops-backup.log 2>&1' ) | crontab -

# 6. Verificar
crontab -l
```

En la corrida de prueba verificar: archivo en `backups/daily/`, tamaño razonable, y el blob visible en Azure Portal → Storage Account → Containers.

## 4. Restore

> ⚠️ **Antes de cualquier restore en producción:** avisar a los usuarios (downtime de la app durante el restore) y hacer un dump del estado actual aunque esté corrupto (`backup-db.sh` manual) — nunca pisar el único estado existente sin copia.

### 4.1 Desde backup local

```bash
# 1. Elegir el dump
ls -lh ~/cscloud/finops/backups/daily/

# 2. Parar la app (evita escrituras a mitad del restore)
cd ~/cscloud/finops && docker compose stop finops-app

# 3. Restaurar dentro del contenedor MySQL
DB_USER=$(grep '^DB_USER=' .env | cut -d= -f2)
DB_PASS=$(grep '^DB_PASSWORD=' .env | cut -d= -f2)
DB_NAME=$(grep '^DB_NAME=' .env | cut -d= -f2)
gunzip -c backups/daily/finops-<db>-<ts>.sql.gz | \
  ( cd ~/cscloud/database && docker compose exec -T mysql \
      env MYSQL_PWD="$DB_PASS" mysql -u"$DB_USER" "$DB_NAME" )

# 4. Levantar la app y verificar
cd ~/cscloud/finops && docker compose up -d finops-app
sleep 15 && curl -fsS http://localhost:3000/api/health
```

### 4.2 Desde Azure Blob (disco del VPS perdido)

La SAS del cron es solo-escritura **a propósito**; para descargar usá tus credenciales de Azure desde tu máquina:

```bash
az storage blob list --account-name "$SA" --container-name "$CONTAINER" \
  --auth-mode login --query '[].{name:name, mtime:properties.lastModified}' -o table

az storage blob download --account-name "$SA" --container-name "$CONTAINER" \
  --auth-mode login --name 'finops-<db>-<ts>.sql.gz' --file ./restore.sql.gz

scp ./restore.sql.gz <user>@<vps>:~/cscloud/finops/backups/
# → continuar con los pasos de 4.1
```

### 4.3 Prueba del runbook (obligatoria, al menos una vez)

Restaurar en una **DB de prueba** (no la real) para validar el dump end-to-end:

```bash
( cd ~/cscloud/database && docker compose exec -T mysql \
    env MYSQL_PWD="$DB_PASS" mysql -u root -e "CREATE DATABASE IF NOT EXISTS finops_restore_test;" )
gunzip -c backups/daily/<dump>.sql.gz | \
  ( cd ~/cscloud/database && docker compose exec -T mysql \
      env MYSQL_PWD="$DB_PASS" mysql -u root finops_restore_test )
# Sanity check y limpieza
( cd ~/cscloud/database && docker compose exec -T mysql \
    env MYSQL_PWD="$DB_PASS" mysql -u root -e \
    "SELECT COUNT(*) AS tenants FROM finops_restore_test.Tenants; DROP DATABASE finops_restore_test;" )
```

> Si `root` no está disponible, usar un usuario con permisos de CREATE DATABASE, o pedir los grants necesarios sobre `finops_restore_test.*` para `$DB_USER`.

## 5. Troubleshooting

| Síntoma | Causa probable | Acción |
|---|---|---|
| Log: `el servicio 'mysql' no está corriendo` | Compose de MySQL caído | `cd ~/cscloud/database && docker compose up -d` |
| Log: `dump sospechosamente chico` | Credenciales mal / DB vacía | Verificar `DB_*` en `.env`; probar `mysqldump` manual |
| Upload off-site falla con 403 | SAS vencida o revocada | Regenerar SAS (paso 2.4) y actualizar `.env` |
| No hay backups nuevos y nadie se enteró | Cron no corre / script roto | Configurar `BACKUP_HEALTHCHECK_URL` (Fase 2) — alerta automática por ausencia de ping |
