#!/usr/bin/env bash
# scripts/setup-local-cron.sh — Instala crons locales en macOS/Linux crontab para desarrollo.

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env.development"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: No se encontró el archivo .env.development en $PROJECT_DIR"
  exit 1
fi

# Cargar CRON_SECRET del .env.development
CRON_SECRET=$(grep "^CRON_SECRET=" "$ENV_FILE" | cut -d'=' -f2 | tr -d '"'"'")

if [ -z "$CRON_SECRET" ]; then
  # Fallback si no está explícito en el grep
  CRON_SECRET="super-secreto-finops-123"
fi

# Asegurar que exista la carpeta .tmp
mkdir -p "$PROJECT_DIR/.tmp"

# Definir comandos de cron
CRON_DB="*/15 * * * * curl -sS -X POST -H \"Authorization: Bearer $CRON_SECRET\" \"http://localhost:3000/api/cron/prewarm-databases\" >> \"$PROJECT_DIR/.tmp/prewarm-databases.log\" 2>&1"
CRON_COMPUTE="*/15 * * * * curl -sS -X POST -H \"Authorization: Bearer $CRON_SECRET\" \"http://localhost:3000/api/cron/prewarm-compute\" >> \"$PROJECT_DIR/.tmp/prewarm-compute.log\" 2>&1"

# Leer crontab actual
CURRENT_CRONTAB=$(crontab -l 2>/dev/null || true)

# Filtrar crons anteriores de prewarm si existen
CLEAN_CRONTAB=$(echo "$CURRENT_CRONTAB" | grep -v "prewarm-databases" | grep -v "prewarm-compute" | grep -v "^$" || true)

# Generar nuevo crontab
NEW_CRONTAB=$(cat <<EOF
$CLEAN_CRONTAB

# --- CSCloudSolutions FinOps Local Cron Jobs ---
$CRON_DB
$CRON_COMPUTE
EOF
)

# Instalar nuevo crontab
echo "$NEW_CRONTAB" | crontab -

echo "=========================================================="
echo "✅ Cron jobs locales instalados con éxito en tu crontab."
echo "=========================================================="
echo "Logs de ejecución en:"
echo "  - $PROJECT_DIR/.tmp/prewarm-databases.log"
echo "  - $PROJECT_DIR/.tmp/prewarm-compute.log"
echo "=========================================================="
echo "Entradas añadidas a crontab:"
echo "  $CRON_DB"
echo "  $CRON_COMPUTE"
echo "=========================================================="
