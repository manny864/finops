#!/usr/bin/env bash
set -euo pipefail

: "${TFSTATE_STORAGE:?TFSTATE_STORAGE requerido}"
: "${TFSTATE_CONTAINER:?TFSTATE_CONTAINER requerido}"
[[ "$TFSTATE_STORAGE" =~ ^[a-z0-9]{3,24}$ ]] || {
  echo "::error::Nombre de cuenta de backend inválido" >&2
  exit 1
}
case "${TFSTATE_ENVIRONMENT:-}" in
  prod) OWN=tfstate-prod; OTHER=tfstate-stg ;;
  staging) OWN=tfstate-stg; OTHER=tfstate-prod ;;
  *) echo "::error::Ambiente de backend inválido" >&2; exit 1 ;;
esac
[ "$TFSTATE_CONTAINER" = "$OWN" ] || {
  echo "::error::El backend no corresponde al ambiente" >&2
  exit 1
}

# `az storage` reemplaza el código RBAC por un mensaje genérico. REST conserva
# el <Code> del servicio, sin registrar tokens ni usar Shared Key/SAS.
list() {
  az rest --method get \
    --url "https://$TFSTATE_STORAGE.blob.core.windows.net/$1?restype=container&comp=list&maxresults=1" \
    --resource https://storage.azure.com/ --headers x-ms-version=2023-11-03 \
    --only-show-errors -o none
}
list "$OWN" >/dev/null

ERR=$(mktemp)
trap 'rm -f "$ERR"' EXIT
for DENIED in "$OTHER" tfstate; do
  if list "$DENIED" >"$ERR" 2>&1; then
    echo "::error::La identidad de $TFSTATE_ENVIRONMENT puede leer un contenedor ajeno" >&2
    exit 1
  fi
  if ! grep -q '<Code>AuthorizationPermissionMismatch</Code>' "$ERR"; then
    cat "$ERR" >&2
    echo "::error::No se pudo confirmar denegación por RBAC (un fallo de red no prueba aislamiento)" >&2
    exit 1
  fi
done
echo "Backend $TFSTATE_ENVIRONMENT: acceso propio permitido y acceso cruzado denegado por RBAC."
