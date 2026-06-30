#!/usr/bin/env bash
# =============================================================================
# prod-migrate-kv.sh — Migración de credenciales de tenants MySQL → Azure KV
# =============================================================================
# Ejecuta las 5 fases del runbook con confirmación interactiva entre cada una.
# Idempotente: si algo ya está hecho, lo detecta y salta.
#
# Uso (desde el VPS Hostinger):
#   cd /home/manny/cscloud/finops
#   chmod +x scripts/prod-migrate-kv.sh
#   ./scripts/prod-migrate-kv.sh
#
# Flags opcionales:
#   --yes        Auto-aprobar todas las fases (sin prompts)
#   --skip-fase N  Saltar fase N (1..5), repetible
#   --only N     Ejecutar solo la fase N
#   --no-backup  NO crear backup (solo si ya lo hiciste manualmente)
# =============================================================================
set -euo pipefail

# ---- Config ----------------------------------------------------------------
PROJECT_DIR="${PROJECT_DIR:-/home/manny/cscloud/finops}"
MYSQL_DIR="${MYSQL_DIR:-/home/manny/cscloud/database}"
ENV_FILE="${ENV_FILE:-$PROJECT_DIR/.env}"
MYSQL_SERVICE="${MYSQL_SERVICE:-mysql}"          # service en el compose de MySQL
APP_SERVICE="${APP_SERVICE:-finops-app}"          # service en el compose de la app
KV_URL_DEFAULT="https://cscs-kv-finops-saas-prod.vault.azure.net/"
TS="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="$PROJECT_DIR/migration-logs"
BACKUP_FILE="$PROJECT_DIR/backup-tenants-$TS.sql"
LOG_FILE="$LOG_DIR/migration-$TS.log"

AUTO_YES=0
NO_BACKUP=0
ONLY_FASE=""
SKIP_FASES=()

# ---- Colors ----------------------------------------------------------------
if [[ -t 1 ]]; then
  C_RED="\033[31m"; C_GRN="\033[32m"; C_YEL="\033[33m"
  C_BLU="\033[34m"; C_BLD="\033[1m";  C_RST="\033[0m"
else
  C_RED=""; C_GRN=""; C_YEL=""; C_BLU=""; C_BLD=""; C_RST=""
fi

log()  { printf "${C_BLU}[%(%H:%M:%S)T]${C_RST} %s\n" -1 "$*"; }
ok()   { printf "${C_GRN}✓${C_RST} %s\n" "$*"; }
warn() { printf "${C_YEL}⚠${C_RST} %s\n" "$*"; }
err()  { printf "${C_RED}✗${C_RST} %s\n" "$*" >&2; }
die()  { err "$*"; exit 1; }

header() {
  echo
  printf "${C_BLD}${C_BLU}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RST}\n"
  printf "${C_BLD}${C_BLU} %s${C_RST}\n" "$*"
  printf "${C_BLD}${C_BLU}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RST}\n"
}

confirm() {
  local msg="$1"
  if [[ "$AUTO_YES" -eq 1 ]]; then
    log "$msg → auto-yes"
    return 0
  fi
  read -rp "$(printf "${C_YEL}❓ %s [y/N]: ${C_RST}" "$msg")" reply
  [[ "$reply" =~ ^[yY]$ ]]
}

# ---- Parse args ------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y)     AUTO_YES=1; shift ;;
    --no-backup)  NO_BACKUP=1; shift ;;
    --only)       ONLY_FASE="$2"; shift 2 ;;
    --skip-fase)  SKIP_FASES+=("$2"); shift 2 ;;
    -h|--help)
      grep -E '^# ' "$0" | sed 's/^# \{0,1\}//' | head -25
      exit 0
      ;;
    *) die "Argumento desconocido: $1 (usar --help)" ;;
  esac
done

should_run() {
  local n="$1"
  if [[ -n "$ONLY_FASE" && "$ONLY_FASE" != "$n" ]]; then return 1; fi
  for s in "${SKIP_FASES[@]:-}"; do
    [[ "$s" == "$n" ]] && return 1
  done
  return 0
}

# ---- Pre-flight ------------------------------------------------------------
mkdir -p "$LOG_DIR"
cd "$PROJECT_DIR" || die "No existe $PROJECT_DIR"

command -v docker >/dev/null || die "docker no está instalado"
docker compose version >/dev/null 2>&1 || die "docker compose v2 requerido"
[[ -f "$ENV_FILE" ]] || die "No existe $ENV_FILE"

# Cargar credenciales DB desde .env (sin exportarlas al entorno padre)
DB_USER="$(grep -E '^DB_USER=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'\')"
DB_PASS="$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'\')"
DB_NAME="$(grep -E '^DB_NAME=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'\')"
[[ -n "$DB_USER" && -n "$DB_PASS" && -n "$DB_NAME" ]] || die "Faltan DB_USER/DB_PASSWORD/DB_NAME en $ENV_FILE"

# Helper para mysql sin spamear el password en logs (MySQL corre en otro compose project)
mysql_exec() {
  ( cd "$MYSQL_DIR" && docker compose exec -T "$MYSQL_SERVICE" \
      env MYSQL_PWD="$DB_PASS" mysql -u"$DB_USER" "$DB_NAME" "$@" )
}
mysql_dump() {
  ( cd "$MYSQL_DIR" && docker compose exec -T "$MYSQL_SERVICE" \
      env MYSQL_PWD="$DB_PASS" mysqldump -u"$DB_USER" "$DB_NAME" "$@" )
}
# Helper para app (otro compose project)
app_exec() {
  docker compose exec -T "$APP_SERVICE" "$@"
}

header "Pre-flight checks"
log "Project dir : $PROJECT_DIR  (service: $APP_SERVICE)"
log "MySQL dir   : $MYSQL_DIR  (service: $MYSQL_SERVICE)"
log "Env file    : $ENV_FILE"
log "Log file    : $LOG_FILE"
log "Backup file : $BACKUP_FILE"
log "Auto-yes    : $AUTO_YES"

[[ -d "$MYSQL_DIR" ]] || die "No existe $MYSQL_DIR (ajusta MYSQL_DIR env var)"

# Validar que la app esté UP (estamos en PROJECT_DIR)
if ! docker compose ps --services --filter status=running | grep -q "^${APP_SERVICE}$"; then
  AVAILABLE=$(docker compose ps --services --filter status=running | tr '\n' ' ')
  die "Service '$APP_SERVICE' no está corriendo en $PROJECT_DIR. Disponibles: ${AVAILABLE:-(ninguno)}. Override con APP_SERVICE=<nombre>."
fi
ok "App service UP: $APP_SERVICE"

# Validar MySQL en su propio compose project
if ! ( cd "$MYSQL_DIR" && docker compose ps --services --filter status=running | grep -q "^${MYSQL_SERVICE}$" ); then
  AVAILABLE=$( cd "$MYSQL_DIR" && docker compose ps --services --filter status=running | tr '\n' ' ' )
  die "Service '$MYSQL_SERVICE' no está corriendo en $MYSQL_DIR. Disponibles: ${AVAILABLE:-(ninguno)}. Override con MYSQL_SERVICE=<nombre>."
fi
ok "MySQL service UP: $MYSQL_SERVICE  (en $MYSQL_DIR)"

# Validar vars KV en el container de la app
KV_VARS=$(app_exec sh -c 'env | grep -c "^AZURE_KEYVAULT_" || true' | tr -d '\r')
if [[ "${KV_VARS:-0}" -lt 5 ]]; then
  die "El container '$APP_SERVICE' no tiene las vars AZURE_KEYVAULT_* cargadas ($KV_VARS encontradas, esperaba ≥5). Reinicia con: docker compose up -d --force-recreate $APP_SERVICE"
fi
ok "Variables AZURE_KEYVAULT_* en container: $KV_VARS"

KV_URL=$(app_exec sh -c 'echo "$AZURE_KEYVAULT_URL"' | tr -d '\r')
log "KV URL: ${KV_URL:-$KV_URL_DEFAULT}"

# Smoke test conectividad KV (debe responder, aunque sea 401)
log "Probando conectividad TLS al Key Vault..."
HTTP_CODE=$(app_exec sh -c "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 ${KV_URL:-$KV_URL_DEFAULT}" || echo "000")
HTTP_CODE=$(echo "$HTTP_CODE" | tr -d '\r')
case "$HTTP_CODE" in
  401|400|404) ok "KV responde HTTP $HTTP_CODE (firewall permite acceso)" ;;
  403)         die "KV responde 403 Forbidden — la IP del VPS NO está en el firewall del Key Vault. Agrega \$(curl -s ifconfig.me) en Azure Portal → Networking → Firewall." ;;
  000)         die "Timeout/no conectividad al KV. Verifica firewall Azure y red del VPS." ;;
  *)           warn "KV respondió HTTP $HTTP_CODE — continuar bajo tu riesgo." ;;
esac

confirm "Pre-flight OK. ¿Continuar con FASE 1 (backup)?" || die "Abortado por usuario."

# =============================================================================
# FASE 1 — Backup de la tabla tenants
# =============================================================================
if should_run 1 && [[ "$NO_BACKUP" -eq 0 ]]; then
  header "FASE 1 — Backup de tabla 'tenants'"
  log "Volcando a $BACKUP_FILE ..."
  if mysql_dump tenants > "$BACKUP_FILE" 2>>"$LOG_FILE"; then
    SIZE=$(stat -c '%s' "$BACKUP_FILE" 2>/dev/null || stat -f '%z' "$BACKUP_FILE")
    if [[ "$SIZE" -lt 500 ]]; then
      die "Backup demasiado pequeño ($SIZE bytes). Revisa $LOG_FILE."
    fi
    ok "Backup creado: $BACKUP_FILE ($SIZE bytes)"
  else
    die "mysqldump falló. Revisa $LOG_FILE."
  fi
else
  warn "Saltando FASE 1 (backup)"
fi

# =============================================================================
# FASE 2 — Migración SQL: client_secret NULLable
# =============================================================================
if should_run 2; then
  header "FASE 2 — SQL migration (client_secret nullable)"
  CURRENT_NULL=$(mysql_exec -BN -e "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_NAME='tenants' AND COLUMN_NAME='client_secret';" 2>/dev/null | tr -d '\r')
  if [[ "$CURRENT_NULL" == "YES" ]]; then
    ok "Columna client_secret ya es NULLable — skip"
  else
    log "Aplicando migrations/20260630-tenants-secret-nullable.sql ..."
    mysql_exec < migrations/20260630-tenants-secret-nullable.sql 2>>"$LOG_FILE"
    AFTER=$(mysql_exec -BN -e "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_NAME='tenants' AND COLUMN_NAME='client_secret';" | tr -d '\r')
    [[ "$AFTER" == "YES" ]] || die "La columna sigue NOT NULL tras migration. Revisa $LOG_FILE."
    ok "client_secret ahora NULLable"
  fi
  confirm "¿Continuar con FASE 3 (dry-run)?" || die "Abortado por usuario."
fi

# =============================================================================
# FASE 3 — Dry-run
# =============================================================================
if should_run 3; then
  header "FASE 3 — Dry-run del script de migración"
  log "Ejecutando dry-run (NO escribe en KV)..."
  set +e
  app_exec npx tsx scripts/migrate-tenants-to-keyvault.ts --dry-run \
    2>&1 | tee -a "$LOG_FILE"
  RC=${PIPESTATUS[0]}
  set -e
  [[ $RC -eq 0 ]] || die "Dry-run falló (exit $RC). Revisa $LOG_FILE."
  ok "Dry-run OK"
  confirm "¿Continuar con FASE 4 (MIGRACIÓN LIVE — escribe en KV)?" || die "Abortado por usuario."
fi

# =============================================================================
# FASE 4 — Migración LIVE
# =============================================================================
if should_run 4; then
  header "FASE 4 — Migración LIVE 🚦"
  warn "Esto escribe secretos en el Key Vault productivo."
  confirm "ÚLTIMA confirmación: ¿ejecutar migración LIVE?" || die "Abortado por usuario."
  log "Ejecutando migración..."
  set +e
  app_exec npx tsx scripts/migrate-tenants-to-keyvault.ts \
    2>&1 | tee -a "$LOG_FILE"
  RC=${PIPESTATUS[0]}
  set -e
  [[ $RC -eq 0 ]] || die "Migración LIVE falló (exit $RC). Considera rollback con backup en $BACKUP_FILE."
  ok "Migración LIVE completada"
fi

# =============================================================================
# FASE 5 — Validación post-migración
# =============================================================================
if should_run 5; then
  header "FASE 5 — Validación post-migración"

  log "Reiniciando container '$APP_SERVICE' para forzar lectura desde KV..."
  docker compose restart "$APP_SERVICE" >/dev/null
  sleep 12

  log "Health check..."
  HEALTH=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000/api/health || echo "000")
  if [[ "$HEALTH" == "200" ]]; then
    ok "App responde HTTP 200"
  else
    warn "App respondió HTTP $HEALTH — revisa: docker compose logs --tail=50 $APP_SERVICE"
  fi

  log "Monitoreando logs por 30s buscando errores de KV..."
  set +e
  KV_ERRORS=$(docker compose logs --since=30s "$APP_SERVICE" 2>/dev/null | grep -cE '\[tenantCredentials\].*(failed|error)')
  set -e
  if [[ "$KV_ERRORS" -gt 0 ]]; then
    warn "Encontrados $KV_ERRORS errores [tenantCredentials] en últimos 30s. Inspecciona:"
    echo "    docker compose logs --since=30s $APP_SERVICE | grep tenantCredentials"
  else
    ok "Sin errores [tenantCredentials] en logs recientes"
  fi
fi

# =============================================================================
# Summary
# =============================================================================
header "✅ Migración completada"
echo
echo "📂 Archivos generados:"
echo "   • Backup : $BACKUP_FILE"
echo "   • Log    : $LOG_FILE"
echo
echo "👉 Siguientes pasos:"
echo "   1. Verificar secretos en Azure Portal:"
echo "      https://portal.azure.com → Key Vault → cscs-kv-finops-saas-prod → Secrets"
echo "   2. Monitorear 30 días:"
echo "      docker compose logs --since=24h app | grep -E '\[tenantCredentials\] KV read failed' | wc -l"
echo "   3. Tras 30 días estables, aplicar cleanup:"
echo "      docker compose exec -T mysql mysql -u\$USER -p \$DB < migrations/20260801-tenants-secret-cleanup.sql"
echo
echo "🚨 Rollback (si hace falta):"
echo "   ( cd $MYSQL_DIR && docker compose exec -T $MYSQL_SERVICE env MYSQL_PWD=\$pwd mysql -u$DB_USER $DB_NAME < $BACKUP_FILE )"
echo "   sed -i 's/^AZURE_KEYVAULT_ENABLED=true/AZURE_KEYVAULT_ENABLED=false/' $ENV_FILE"
echo "   docker compose restart $APP_SERVICE"
echo
