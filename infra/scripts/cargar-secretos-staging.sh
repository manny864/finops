#!/usr/bin/env bash
# Carga al Key Vault de STAGING los tres secretos de D5 (docs/security/ejecucion-staging-copilot.md): la clave de API
# del sandbox de Paddle, el secreto de su destino de webhook y el secreto de la app registration de staging.
# Lo corre una persona con `az login` y el rol Key Vault Secrets Officer sobre el vault, en UNA TERMINAL REAL: los
# valores se piden sin eco desde /dev/tty. No sirve el `!` del chat, que no le pasa el teclado al `read`.
#
# Uso:  infra/scripts/cargar-secretos-staging.sh
#       infra/scripts/cargar-secretos-staging.sh --stdin   (sólo para pruebas: lee los tres valores, uno por línea)
# Con Enter sin escribir nada se salta ese secreto, así se cargan de a uno cuando cada valor esté listo.
#
# Qué garantiza:
#  - es sólo de staging: si VAULT tiene "prod" en el nombre, se niega;
#  - rechaza una clave de Paddle en vivo (pdl_live_...): la de staging tiene que ser del sandbox (pdl_sdbx_apikey_...);
#  - los valores no salen por pantalla ni por la línea de comandos: se escriben a archivos temporales privados y
#    `az` los lee con --file; los archivos se borran siempre;
#  - el firewall del vault se abre sólo para esta IP y se cierra pase lo que pase;
#  - se comprueba que cada secreto quedó entero comparando el largo guardado (el valor no se lee ni se imprime).
set -euo pipefail
umask 077

VAULT=${VAULT:-cscs-finops-stg-wus2-kv}
case "$VAULT" in
  *prod*) echo "Este script es sólo para staging: el vault $VAULT parece de prod."; exit 1 ;;
esac

DESDE_STDIN=
[ "${1:-}" = "--stdin" ] && DESDE_STDIN=1

# nombre en el vault | descripción | prefijo obligatorio (vacío = sin chequeo)
SECRETOS=(
  "infra-paddle-api-key|Clave de API del SANDBOX de Paddle (pdl_sdbx_apikey_...)|pdl_sdbx_apikey_"
  "infra-paddle-webhook-secret|Secreto del destino de webhook del sandbox (pdl_ntfset_...)|pdl_ntfset_"
  "infra-azure-client-secret|Secreto de la app registration de STAGING (la de prueba, no la de prod)|"
)

TMP=$(mktemp -d "${TMPDIR:-/tmp}/cargar-secretos.XXXXXX")
IP=
ABIERTO=
cerrar() {
  rm -rf "$TMP"
  if [ -n "$ABIERTO" ]; then
    if az keyvault network-rule remove --name "$VAULT" --ip-address "$IP" --only-show-errors > /dev/null 2>&1; then
      echo "Firewall de $VAULT cerrado para $IP"
    else
      echo "No se pudo quitar la regla de $IP. Comprobar: az keyvault network-rule list --name $VAULT"
    fi
  fi
}
trap cerrar EXIT

# 1) Pedir y validar todo ANTES de tocar Azure: un valor mal pegado no deja el vault a medias.
declare -a A_CARGAR=()
for entrada in "${SECRETOS[@]}"; do
  IFS='|' read -r nombre descripcion prefijo <<< "$entrada"
  if [ -n "$DESDE_STDIN" ]; then
    read -r valor || valor=
  else
    printf '%s\n(Enter para saltear): ' "$descripcion" > /dev/tty
    read -r -s valor < /dev/tty || valor=
    printf '\n' > /dev/tty
  fi
  [ -z "$valor" ] && { echo "Salteado: $nombre"; continue; }
  if [ -n "$prefijo" ] && [[ "$valor" != "$prefijo"* ]]; then
    echo "$nombre: el valor no empieza con $prefijo. Si es una clave de Paddle en vivo, no va en staging. No se cargó nada."
    exit 1
  fi
  printf '%s' "$valor" > "$TMP/$nombre"
  A_CARGAR+=("$nombre")
done
unset valor
[ "${#A_CARGAR[@]}" -eq 0 ] && { echo "No había nada para cargar."; exit 0; }

# 2) El firewall del vault se abre sólo para esta IP y se cierra pase lo que pase (trap).
IP=$(curl -fsS https://api.ipify.org)
[[ "$IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo "api.ipify.org no devolvió una IPv4"; exit 1; }
az keyvault network-rule add --name "$VAULT" --ip-address "$IP" --only-show-errors > /dev/null
ABIERTO=1
echo "Abierto $VAULT para $IP"

# 3) Esperar a que la regla propague, no un tiempo fijo: sólo se espera mientras el error sea del firewall.
for i in $(seq 1 24); do
  if SALIDA=$(az keyvault secret list --vault-name "$VAULT" --maxresults 1 --only-show-errors 2>&1); then
    echo "Data plane de $VAULT accesible (intento $i)"
    break
  fi
  if ! grep -q "ForbiddenByFirewall" <<< "$SALIDA"; then
    echo "$SALIDA"
    exit 1
  fi
  if [ "$i" -eq 24 ]; then
    echo "El firewall sigue rechazando tras 120 s"
    exit 1
  fi
  sleep 5
done

# 4) Cargar desde archivo (el valor no pasa por la línea de comandos) y comprobar el largo guardado.
for nombre in "${A_CARGAR[@]}"; do
  az keyvault secret set --vault-name "$VAULT" --name "$nombre" --file "$TMP/$nombre" --only-show-errors -o none
  en_vault=$(az keyvault secret show --vault-name "$VAULT" --name "$nombre" --query "length(value)" -o tsv --only-show-errors)
  en_archivo=$(wc -c < "$TMP/$nombre" | tr -d ' ')
  if [ "$en_vault" != "$en_archivo" ]; then
    echo "$nombre: LARGO DISTINTO (vault $en_vault, valor $en_archivo)"
    exit 1
  fi
  echo "$nombre: ok ($en_vault caracteres)"
done
echo "Listo. La app lee los secretos del vault al arrancar: hace falta una revisión nueva (un deploy o un restart) para que los tome."
