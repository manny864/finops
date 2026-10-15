#!/usr/bin/env bash
# INFRA-05 — Reglas temporales del firewall del Key Vault con lease y vencimiento.
#
# El workflow de Terraform abre la IP del runner en el firewall del vault. `if: always()`
# cierra en el caso normal, pero no si el runner se pierde o el job se mata a la fuerza, y
# Key Vault no tiene TTL para una IP rule. Por eso cada apertura deja ANTES un lease (blob en
# el contenedor del tfstate) con vault, IP, job, dueño y vencimiento, y un reconciliador que
# corre aparte quita las reglas cuyo lease venció.
#
#   open       escribe un lease por vault y recién después agrega la regla.
#   close      borra el lease propio y quita la regla si ningún otro lease vigente la usa
#              (reintenta; si no puede, sale con error: nunca éxito silencioso).
#   reconcile  por vault: quita reglas /32 sin lease vigente que no sean permanentes, y borra
#              leases vencidos. Nunca toca reglas permanentes ni CIDR más anchos que /32.
#
# Entorno común: LEASE_ACCOUNT, LEASE_CONTAINER, LEASE_PREFIX (default kv-firewall-leases), VAULTS.
# open/close: RUNNER_IP, LEASE_ID; open además TTL_MINUTES, LEASE_OWNER, LEASE_RUN_URL.
# reconcile: PERMANENT_FILE (líneas "<vault> <ip|cidr>") y PERMANENT_KNOWN=1 si la lista es
# confiable. Sin PERMANENT_KNOWN=1 sólo se quitan reglas con lease vencido (no huérfanas).
set -uo pipefail

CMD="${1:-}"
PREFIX="${LEASE_PREFIX:-kv-firewall-leases}"
RETRIES="${KV_FW_RETRIES:-5}"
VAULT_RE='^[A-Za-z0-9-]{3,24}$'
IP_RE='^([0-9]{1,3}\.){3}[0-9]{1,3}$'
ID_RE='^[A-Za-z0-9._-]{1,128}$'

die() { echo "::error::$*"; exit 1; }
now() { date -u +%s; }
norm_ip() { local r="$1"; echo "${r%/32}"; }

: "${LEASE_ACCOUNT:?LEASE_ACCOUNT requerido}"
: "${LEASE_CONTAINER:?LEASE_CONTAINER requerido}"
for V in ${VAULTS:-}; do [[ "$V" =~ $VAULT_RE ]] || die "Nombre de vault inválido"; done

blob() { az storage blob "$@" --account-name "$LEASE_ACCOUNT" --container-name "$LEASE_CONTAINER" --auth-mode login --only-show-errors; }

# Líneas "<ip> <expires_epoch> <blob>" de los leases de un vault.
list_leases() {
  local vault="$1" out
  out=$(blob list --prefix "$PREFIX/$vault/" --include m --num-results '*' \
    --query "[].[name, metadata.expires]" -o tsv) || return 1
  while IFS=$'\t' read -r name exp; do
    [ -n "$name" ] || continue
    local rest="${name#"$PREFIX/$vault/"}"
    local ip="${rest%%/*}"
    [[ "$ip" =~ $IP_RE ]] || continue
    [[ "$exp" =~ ^[0-9]+$ ]] || exp=0
    echo "$ip $exp $name"
  done <<< "$out"
}

remove_rule() {
  local vault="$1" ip="$2" attempt
  for attempt in $(seq 1 "$RETRIES"); do
    if az keyvault network-rule remove --name "$vault" --ip-address "$ip" --only-show-errors >/dev/null; then
      return 0
    fi
    [ "$attempt" -lt "$RETRIES" ] && sleep 5
  done
  return 1
}

case "$CMD" in
  open)
    [[ "${RUNNER_IP:-}" =~ $IP_RE ]] || die "RUNNER_IP no es una IPv4"
    [[ "${LEASE_ID:-}" =~ $ID_RE ]] || die "LEASE_ID inválido"
    [[ "${TTL_MINUTES:-}" =~ ^[0-9]+$ ]] && [ "$TTL_MINUTES" -gt 0 ] || die "TTL_MINUTES inválido"
    EXP=$(( $(now) + TTL_MINUTES * 60 ))
    EXP_ISO=$(date -u -d "@$EXP" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$EXP" +%Y-%m-%dT%H:%M:%SZ)
    TMP=$(mktemp)
    trap 'rm -f "$TMP"' EXIT
    # Todos los leases primero: si alguno no se puede escribir, no se abre nada.
    for V in $VAULTS; do
      jq -n --arg vault "$V" --arg ip "$RUNNER_IP" --arg job "$LEASE_ID" --arg owner "${LEASE_OWNER:-}" \
        --arg run "${LEASE_RUN_URL:-}" --arg exp "$EXP_ISO" \
        '{vault:$vault, ip:$ip, job:$job, owner:$owner, run_url:$run, expires_at:$exp}' > "$TMP"
      blob upload --name "$PREFIX/$V/$RUNNER_IP/$LEASE_ID" --file "$TMP" --overwrite \
        --metadata "expires=$EXP" >/dev/null || die "No se pudo registrar el lease de $V; no se abre el firewall"
    done
    for V in $VAULTS; do
      az keyvault network-rule add --name "$V" --ip-address "$RUNNER_IP" --only-show-errors >/dev/null \
        || die "No se pudo abrir $V"
      echo "Abierto $V para $RUNNER_IP hasta $EXP_ISO"
    done
    ;;

  close)
    [[ "${RUNNER_IP:-}" =~ $IP_RE ]] || die "RUNNER_IP no es una IPv4"
    [[ "${LEASE_ID:-}" =~ $ID_RE ]] || die "LEASE_ID inválido"
    FAILED=0
    for V in $VAULTS; do
      blob delete --name "$PREFIX/$V/$RUNNER_IP/$LEASE_ID" >/dev/null 2>&1 \
        || echo "::warning::No se pudo borrar el lease de $V (vence solo y lo limpia el reconciliador)"
      if LEASES=$(list_leases "$V"); then
        T=$(now)
        if awk -v ip="$RUNNER_IP" -v t="$T" '$1==ip && $2>t {f=1} END {exit !f}' <<< "$LEASES"; then
          echo "$V: otro job vigente usa $RUNNER_IP; la regla queda hasta que venza su lease."
          continue
        fi
      else
        echo "::warning::No se pudieron leer los leases de $V; se cierra igual."
      fi
      if remove_rule "$V" "$RUNNER_IP"; then
        echo "Cerrado $V para $RUNNER_IP"
      else
        echo "::error::No se pudo cerrar la regla temporal de $V tras $RETRIES intentos (la quita el reconciliador al vencer el lease)"
        FAILED=1
      fi
    done
    exit "$FAILED"
    ;;

  reconcile)
    PERM_FILE="${PERMANENT_FILE:-/dev/null}"
    [ "${PERMANENT_KNOWN:-0}" = 1 ] || echo "::warning::Lista de reglas permanentes desconocida: sólo se quitan reglas con lease vencido."
    FAILED=0
    for V in $VAULTS; do
      # Primero las reglas y después los leases: open escribe el lease ANTES de agregar la
      # regla, así que toda regla vista acá ya tiene su lease visible en la lectura siguiente.
      if ! RULES=$(az keyvault show --name "$V" --query "properties.networkAcls.ipRules[].value" -o tsv --only-show-errors); then
        echo "::error::No se pudieron leer las reglas de $V"; FAILED=1; continue
      fi
      if ! LEASES=$(list_leases "$V"); then
        echo "::error::No se pudieron leer los leases de $V"; FAILED=1; continue
      fi
      T=$(now)
      KEEP_LEASE=""
      for RAW in $RULES; do
        IP=$(norm_ip "$RAW")
        [[ "$IP" =~ $IP_RE ]] || continue  # CIDR más ancho: nunca es temporal
        if awk -v v="$V" -v ip="$IP" '{r=$2; sub(/\/32$/, "", r)} $1==v && r==ip {f=1} END {exit !f}' "$PERM_FILE"; then
          continue
        fi
        if awk -v ip="$IP" -v t="$T" '$1==ip && $2>t {f=1} END {exit !f}' <<< "$LEASES"; then
          continue
        fi
        HAS_EXPIRED=0
        awk -v ip="$IP" '$1==ip {f=1} END {exit !f}' <<< "$LEASES" && HAS_EXPIRED=1
        if [ "$HAS_EXPIRED" = 0 ] && [ "${PERMANENT_KNOWN:-0}" != 1 ]; then
          echo "::warning::$V tiene $IP sin lease y no se puede confirmar que no sea permanente; se deja."
          continue
        fi
        if remove_rule "$V" "$IP"; then
          if [ "$HAS_EXPIRED" = 1 ]; then
            echo "::warning title=Key Vault firewall::Se quitó de $V una regla temporal con lease vencido (el job no la cerró)"
          else
            echo "::warning title=Key Vault firewall::Se quitó de $V una regla /32 huérfana sin lease"
          fi
        else
          echo "::error::No se pudo quitar una regla vencida de $V"; FAILED=1
          KEEP_LEASE="$KEEP_LEASE $IP"
        fi
      done
      # Leases vencidos: se borran, salvo los de una regla que no se pudo quitar (quedan
      # para el próximo intento).
      while read -r IP EXP NAME; do
        [ -n "${NAME:-}" ] || continue
        [ "$EXP" -le "$T" ] || continue
        [[ " $KEEP_LEASE " == *" $IP "* ]] && continue
        blob delete --name "$NAME" >/dev/null || echo "::warning::No se pudo borrar un lease vencido de $V"
      done <<< "$LEASES"
    done
    exit "$FAILED"
    ;;

  *)
    die "Uso: $0 open|close|reconcile"
    ;;
esac
