#!/usr/bin/env bash
set -euo pipefail

: "${TFSTATE_STORAGE:?TFSTATE_STORAGE requerido}"
: "${TFSTATE_CONTAINER:?TFSTATE_CONTAINER requerido}"
case "${TFSTATE_ENVIRONMENT:-}" in
  prod) OWN=tfstate-prod; OTHER=tfstate-stg ;;
  staging) OWN=tfstate-stg; OTHER=tfstate-prod ;;
  *) echo "::error::Ambiente de backend inválido" >&2; exit 1 ;;
esac
[ "$TFSTATE_CONTAINER" = "$OWN" ] || {
  echo "::error::El backend no corresponde al ambiente" >&2
  exit 1
}

az storage blob list --account-name "$TFSTATE_STORAGE" --container-name "$OWN" \
  --auth-mode login --num-results 1 --query 'length(@)' -o tsv --only-show-errors >/dev/null

ERR=$(mktemp)
trap 'rm -f "$ERR"' EXIT
for DENIED in "$OTHER" tfstate; do
  if az storage blob list --account-name "$TFSTATE_STORAGE" --container-name "$DENIED" \
    --auth-mode login --num-results 1 --query 'length(@)' -o tsv --only-show-errors >"$ERR" 2>&1; then
    echo "::error::La identidad de $TFSTATE_ENVIRONMENT puede leer un contenedor ajeno" >&2
    exit 1
  fi
  if ! grep -q 'AuthorizationPermissionMismatch' "$ERR"; then
    cat "$ERR" >&2
    echo "::error::No se pudo confirmar denegación por RBAC (un fallo de red no prueba aislamiento)" >&2
    exit 1
  fi
done
echo "Backend $TFSTATE_ENVIRONMENT: acceso propio permitido y acceso cruzado denegado por RBAC."
