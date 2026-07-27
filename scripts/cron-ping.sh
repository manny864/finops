#!/usr/bin/env bash
# =============================================================================
# cron-ping.sh — wrapper genérico de healthchecks.io para cualquier cron
# (Fase 2, docs/vps-infra-improvement-plan.md)
# =============================================================================
# Mismo patrón que ping_health() en backup-db.sh, pero reusable para los
# cron jobs de /api/cron/* (sync, prewarm-dashboard, power-schedules, etc.)
# que hoy son un curl suelto en el crontab sin ninguna señal si dejan de
# correr — el gap que motivó esta fase (ver incidente 2026-07-05 en README).
#
# Uso (crontab del VPS):
#   0 6 * * * /home/manny/cscloud/finops/scripts/cron-ping.sh "$SYNC_HEALTHCHECK_URL" -- \
#     curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/sync \
#     >> /var/log/finops-cron.log 2>&1
#
# Si $1 está vacío, el ping es no-op y el comando corre igual (permite
# desplegar el wrapper antes de tener las URLs de healthchecks.io creadas,
# sin romper el cron).
#
# Exit code: propaga el del comando envuelto (para que el log del cron
# refleje el fallo real, no el del wrapper).
# =============================================================================
set -uo pipefail

HEALTHCHECK_URL="${1:-}"
shift || true
if [[ "${1:-}" != "--" ]]; then
  echo "Uso: cron-ping.sh <healthcheck-url|-> -- <comando...>" >&2
  exit 2
fi
shift

ping() {
  local suffix="${1:-}"
  [[ -n "$HEALTHCHECK_URL" ]] || return 0
  curl -fsS -m 10 --retry 2 "${HEALTHCHECK_URL}${suffix}" >/dev/null 2>&1 || true
}

"$@"
STATUS=$?

if [[ "$STATUS" -eq 0 ]]; then
  ping ""
else
  ping "/fail"
fi

exit "$STATUS"
