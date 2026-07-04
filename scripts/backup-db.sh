#!/usr/bin/env bash
# =============================================================================
# backup-db.sh — Backup diario de MySQL (Fase 1, docs/vps-infra-improvement-plan.md)
# =============================================================================
# Hace mysqldump dentro del contenedor MySQL (compose project separado, igual
# que scripts/prod-migrate-kv.sh), comprime con gzip, rota copias locales
# (7 diarias + 4 semanales) y sube una copia off-site a Azure Blob Storage
# via SAS URL (sin az CLI: solo curl).
#
# Uso (cron en el VPS, ver docs/runbook-restore-mysql.md):
#   0 3 * * * /home/manny/cscloud/finops/scripts/backup-db.sh >> /var/log/finops-backup.log 2>&1
#
# Variables opcionales en el .env del proyecto:
#   BACKUP_AZURE_SAS_URL   SAS URL del contenedor de Azure Blob (permisos cw).
#                          Si no está, se omite el off-site (solo local).
#   BACKUP_HEALTHCHECK_URL URL de ping de healthchecks.io (Fase 2). Opcional.
#
# Exit codes: 0 OK · 1 error de dump/verificación · 2 error de configuración.
# El fallo del upload off-site NO aborta (el backup local ya está a salvo),
# pero se reporta en el log y en el ping /fail de healthchecks.io.
# =============================================================================
set -euo pipefail

# ---- Config (mismos defaults que prod-migrate-kv.sh) ------------------------
PROJECT_DIR="${PROJECT_DIR:-/home/manny/cscloud/finops}"
MYSQL_DIR="${MYSQL_DIR:-/home/manny/cscloud/database}"
MYSQL_SERVICE="${MYSQL_SERVICE:-mysql}"
ENV_FILE="${ENV_FILE:-$PROJECT_DIR/.env}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
DAILY_RETENTION_DAYS="${DAILY_RETENTION_DAYS:-7}"
WEEKLY_RETENTION_DAYS="${WEEKLY_RETENTION_DAYS:-28}"
MIN_DUMP_BYTES="${MIN_DUMP_BYTES:-10240}"   # un dump real nunca baja de 10 KB

TS="$(date +%Y%m%d-%H%M%S)"
log()  { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { log "ERROR: $1"; ping_health fail; exit "${2:-1}"; }

# ---- Ping healthchecks.io (Fase 2; no-op si no está configurado) ------------
ping_health() {
  local suffix=""
  [[ "${1:-}" == "fail" ]] && suffix="/fail"
  if [[ -n "${BACKUP_HEALTHCHECK_URL:-}" ]]; then
    curl -fsS -m 10 --retry 3 "${BACKUP_HEALTHCHECK_URL}${suffix}" >/dev/null 2>&1 || true
  fi
}

# ---- Pre-flight --------------------------------------------------------------
[[ -f "$ENV_FILE" ]] || { log "ERROR: no existe $ENV_FILE"; exit 2; }
command -v docker >/dev/null || { log "ERROR: docker no está instalado"; exit 2; }
[[ -d "$MYSQL_DIR" ]] || { log "ERROR: no existe $MYSQL_DIR"; exit 2; }

# Lector tolerante: si la variable no está en el .env devuelve vacío en vez de
# matar el script (pipefail + grep sin match = exit 1 silencioso).
env_var() { { grep -E "^$1=" "$ENV_FILE" || true; } | head -1 | cut -d= -f2- | tr -d '"'\'; }
DB_USER="$(env_var DB_USER)"
DB_PASS="$(env_var DB_PASSWORD)"
DB_NAME="$(env_var DB_NAME)"
BACKUP_AZURE_SAS_URL="${BACKUP_AZURE_SAS_URL:-$(env_var BACKUP_AZURE_SAS_URL)}"
BACKUP_HEALTHCHECK_URL="${BACKUP_HEALTHCHECK_URL:-$(env_var BACKUP_HEALTHCHECK_URL)}"
[[ -n "$DB_USER" && -n "$DB_PASS" && -n "$DB_NAME" ]] || { log "ERROR: faltan DB_USER/DB_PASSWORD/DB_NAME en $ENV_FILE"; exit 2; }

if ! ( cd "$MYSQL_DIR" && docker compose ps --services --filter status=running | grep -q "^${MYSQL_SERVICE}$" ); then
  fail "el servicio '$MYSQL_SERVICE' no está corriendo en $MYSQL_DIR" 2
fi

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"
DUMP_FILE="$BACKUP_DIR/daily/finops-${DB_NAME}-${TS}.sql.gz"

# ---- Dump --------------------------------------------------------------------
log "Iniciando backup de '$DB_NAME' → $DUMP_FILE"
if ! ( cd "$MYSQL_DIR" && docker compose exec -T "$MYSQL_SERVICE" \
    env MYSQL_PWD="$DB_PASS" mysqldump \
      --no-tablespaces --single-transaction --skip-lock-tables \
      --routines --triggers \
      -u"$DB_USER" "$DB_NAME" ) | gzip > "$DUMP_FILE"; then
  rm -f "$DUMP_FILE"
  fail "mysqldump falló"
fi

# ---- Verificación -------------------------------------------------------------
SIZE=$(stat -c '%s' "$DUMP_FILE" 2>/dev/null || stat -f '%z' "$DUMP_FILE")
[[ "$SIZE" -ge "$MIN_DUMP_BYTES" ]] || { rm -f "$DUMP_FILE"; fail "dump sospechosamente chico ($SIZE bytes < $MIN_DUMP_BYTES)"; }
gzip -t "$DUMP_FILE" || { rm -f "$DUMP_FILE"; fail "el gzip está corrupto"; }
log "Dump OK ($SIZE bytes, gzip íntegro)"

# ---- Copia semanal (domingos) --------------------------------------------------
if [[ "$(date +%u)" == "7" ]]; then
  cp "$DUMP_FILE" "$BACKUP_DIR/weekly/"
  log "Copia semanal creada en $BACKUP_DIR/weekly/"
fi

# ---- Rotación local -------------------------------------------------------------
DELETED_DAILY=$(find "$BACKUP_DIR/daily" -name '*.sql.gz' -mtime +"$DAILY_RETENTION_DAYS" -print -delete | wc -l)
DELETED_WEEKLY=$(find "$BACKUP_DIR/weekly" -name '*.sql.gz' -mtime +"$WEEKLY_RETENTION_DAYS" -print -delete | wc -l)
log "Rotación: borrados $DELETED_DAILY diarios (>${DAILY_RETENTION_DAYS}d) y $DELETED_WEEKLY semanales (>${WEEKLY_RETENTION_DAYS}d)"

# ---- Off-site: Azure Blob via SAS (curl, sin az CLI) ----------------------------
OFFSITE_OK=1
if [[ -n "$BACKUP_AZURE_SAS_URL" ]]; then
  # SAS de contenedor: https://cuenta.blob.core.windows.net/contenedor?sv=...
  # El blob se inserta entre el path del contenedor y la query string.
  BASE="${BACKUP_AZURE_SAS_URL%%\?*}"
  QUERY="${BACKUP_AZURE_SAS_URL#*\?}"
  BLOB_URL="${BASE}/$(basename "$DUMP_FILE")?${QUERY}"
  log "Subiendo off-site a Azure Blob..."
  if curl -fsS -m 300 --retry 3 --retry-delay 10 \
       -X PUT \
       -H "x-ms-blob-type: BlockBlob" \
       -H "x-ms-version: 2021-08-06" \
       --data-binary @"$DUMP_FILE" \
       "$BLOB_URL" >/dev/null; then
    log "Off-site OK: $(basename "$DUMP_FILE")"
  else
    OFFSITE_OK=0
    log "ERROR: falló el upload off-site (el backup local sí quedó en $DUMP_FILE)"
  fi
else
  log "AVISO: BACKUP_AZURE_SAS_URL no configurada — backup solo local (sin off-site)"
fi

# ---- Resultado -------------------------------------------------------------------
if [[ "$OFFSITE_OK" -eq 1 ]]; then
  log "Backup completado OK"
  ping_health ok
else
  ping_health fail
  exit 1
fi
