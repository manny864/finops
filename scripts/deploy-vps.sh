#!/usr/bin/env bash
# =============================================================================
# deploy-vps.sh — build-antes-de-stop + smoke test + rollback (Fase 4,
# docs/vps-infra-improvement-plan.md)
# =============================================================================
# Se corre EN el VPS, después de `git reset --hard origin/main` (eso lo hace
# deploy.yml antes de invocar este script — acá asumimos que el checkout ya
# está actualizado).
#
# Antes: `docker compose stop finops-app` seguido de `up -d --build` — downtime
# igual al tiempo de build completo (minutos).
# Ahora: se construye la imagen nueva CON LA VIEJA TODAVÍA SIRVIENDO TRÁFICO, y
# recién con la imagen lista se reemplaza el contenedor — Docker lo hace casi
# instantáneo (segundos). Si el contenedor nuevo no llega a healthy, se
# revierte automáticamente a la imagen anterior.
#
# Exit code: 0 si el deploy quedó healthy, 1 si hubo que hacer rollback (para
# que deploy.yml lo trate como fallo y dispare su reintento).
# =============================================================================
set -euo pipefail

SERVICE="${SERVICE:-finops-app}"
CONTAINER="${CONTAINER:-finops-finops-app-1}"
IMAGE="${IMAGE:-finops-finops-app}"
SMOKE_TIMEOUT_S="${SMOKE_TIMEOUT_S:-30}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# ---- Tag de rollback (best-effort: si no existe imagen previa, primer deploy) --
docker tag "${IMAGE}:latest" "${IMAGE}:previous" 2>/dev/null || log "Sin imagen ${IMAGE}:latest previa (primer deploy) — sin tag de rollback."

# ---- Build con la app vieja todavía corriendo ---------------------------------
log "Construyendo imagen nueva (app vieja sigue sirviendo tráfico)..."
docker compose build "$SERVICE"

# ---- Swap: Docker reemplaza el contenedor casi instantáneo una vez que la ----
# ---- imagen ya está lista -------------------------------------------------------
log "Reemplazando contenedor..."
docker compose up -d "$SERVICE"

# ---- Smoke test: esperar a que el healthcheck de docker-compose.yml diga ------
# ---- "healthy" (mismo endpoint /api/health, sin reimplementar el chequeo) -----
log "Smoke test: esperando healthy (máx ${SMOKE_TIMEOUT_S}s)..."
ELAPSED=0
while true; do
  STATUS="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "unknown")"
  if [[ "$STATUS" == "healthy" ]]; then
    log "Smoke test OK: $CONTAINER healthy."
    docker builder prune -af --filter until=48h || true
    exit 0
  fi
  if [[ "$ELAPSED" -ge "$SMOKE_TIMEOUT_S" ]]; then
    break
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

# ---- Smoke test falló: rollback ------------------------------------------------
log "ERROR: $CONTAINER no llegó a healthy en ${SMOKE_TIMEOUT_S}s (status: $STATUS). Logs:"
docker compose logs --tail=100 "$SERVICE" || true

if docker image inspect "${IMAGE}:previous" >/dev/null 2>&1; then
  log "Haciendo rollback a ${IMAGE}:previous..."
  docker tag "${IMAGE}:previous" "${IMAGE}:latest"
  docker compose up -d "$SERVICE"
  log "Rollback aplicado. El deploy sigue marcado como FALLIDO (exit 1) para que dispare el reintento/alerta."
else
  log "No hay ${IMAGE}:previous para hacer rollback (probablemente primer deploy) — queda como está."
fi

exit 1
