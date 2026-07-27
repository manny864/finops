#!/usr/bin/env bash
# =============================================================================
# log-docker-stats.sh — snapshot de CPU/RAM por contenedor (Fase 2,
# docs/vps-infra-improvement-plan.md)
# =============================================================================
# Alternativa $0 a netdata (no requiere instalar nada, ~150-200MB RAM menos):
# corre `docker stats --no-stream` y apendea una línea por contenedor a un
# log rotado. Sin esto, la señal de saturación de la Fase 5 (CPU >80%, RAM
# >85% sostenida) no tiene ningún dato histórico para confirmarse.
#
# Uso (cron en el VPS, cada 5 min):
#   */5 * * * * /home/manny/cscloud/finops/scripts/log-docker-stats.sh >> /var/log/finops-cron.log 2>&1
#
# Variables opcionales:
#   STATS_LOG_FILE       default: /var/log/finops-docker-stats.log
#   STATS_RETENTION_DAYS default: 14 (el log rota solo, sin logrotate extra)
#
# Formato de línea (fácil de parsear con awk/grep para un umbral simple):
#   2026-07-27T15:04:00Z finops-app CPU=12.34% MEM=512.3MiB/3GiB MEM%=17.05%
# =============================================================================
set -euo pipefail

STATS_LOG_FILE="${STATS_LOG_FILE:-/var/log/finops-docker-stats.log}"
STATS_RETENTION_DAYS="${STATS_RETENTION_DAYS:-14}"

command -v docker >/dev/null || { echo "ERROR: docker no está instalado" >&2; exit 2; }

TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# --no-stream: una sola muestra y sale (no queda un proceso colgado). Formato
# fijo separado por '|' para no depender de que los nombres de contenedor
# nunca tengan espacios.
docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}' \
  | while IFS='|' read -r name cpu mem memperc; do
      printf '%s %s CPU=%s MEM=%s MEM%%=%s\n' "$TS" "$name" "$cpu" "$mem" "$memperc" >> "$STATS_LOG_FILE"
    done

# Rotación simple: si el log supera la retención en días de antigüedad de
# modificación, se trunca (no borra el archivo — algunos tail -f de
# monitoreo externo se rompen si el inode desaparece).
if [[ -f "$STATS_LOG_FILE" ]] && find "$STATS_LOG_FILE" -mtime +"$STATS_RETENTION_DAYS" -print -quit | grep -q .; then
  : > "$STATS_LOG_FILE"
  echo "[$TS] log-docker-stats.sh: log rotado (>${STATS_RETENTION_DAYS}d)" >> "$STATS_LOG_FILE"
fi
