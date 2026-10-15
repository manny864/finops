#!/usr/bin/env bash
# Abre el firewall del Key Vault para TODAS las IPs de salida del runner, no sólo una.
#
# Los runners hospedados de GitHub salen a Internet por más de una IP (SNAT). En el run
# 38714617769, api.ipify.org vio 68.220.61.196, el paso de espera pasó, y Terraform salió por
# .198 y murió con 403 ForbiddenByFirewall. Key Vault dice en ese 403 cuál es la IP real
# ("Client address: x.x.x.x"), así que se usa eso para aprender las IPs que falten.
#
#   open        IP de ipify + sondeos al vault ANTES de abrir (cada `az` es una conexión
#               nueva): abre con lease cada IP vista y espera a que el data plane responda
#               varias veces seguidas, abriendo las IPs nuevas que aparezcan mientras tanto.
#   learn LOG   abre las IPs de los 403 de firewall de LOG (por ejemplo, el stderr de
#               terraform plan). Sale 0 si abrió alguna (conviene reintentar) y 1 si no.
#   close       cierra todas las IPs abiertas por este job.
#
# Cada apertura pasa por kv-firewall-lease.sh, así que vale lo de INFRA-05: lease antes de
# la regla, vencimiento y reconciliador si el runner se pierde.
#
# Entorno: el de kv-firewall-lease.sh, VAULTS, IPS_FILE (registro de IPs abiertas por este
# job), y opcionales RUNNER_IP (ya conocida), KV_FW_PROBES, KV_FW_WAIT_TRIES, KV_FW_MAX_IPS.
set -uo pipefail

CMD="${1:-}"
LEASE="$(dirname "$0")/kv-firewall-lease.sh"
IP_RE='^([0-9]{1,3}\.){3}[0-9]{1,3}$'
PROBES="${KV_FW_PROBES:-6}"
WAIT_TRIES="${KV_FW_WAIT_TRIES:-24}"
OK_STREAK="${KV_FW_OK_STREAK:-3}"
# Tope: lo que entra al firewall sale de mensajes de error; nunca una lista sin límite.
MAX_IPS="${KV_FW_MAX_IPS:-8}"

die() { echo "::error::$*"; exit 1; }
: "${IPS_FILE:?IPS_FILE requerido}"
: "${VAULTS:?VAULTS requerido}"
touch "$IPS_FILE"

client_ips() { grep -oE 'Client address: ([0-9]{1,3}\.){3}[0-9]{1,3}' | awk '{print $3}' | sort -u; }

# 0 = abrió, 1 = ya estaba, 2 = error.
add_ip() {
  local ip="$1"
  [[ "$ip" =~ $IP_RE ]] || { echo "::warning::IP de salida descartada (no es IPv4)"; return 2; }
  grep -qxF "$ip" "$IPS_FILE" && return 1
  if [ "$(grep -c . "$IPS_FILE")" -ge "$MAX_IPS" ]; then
    echo "::error::El runner ya tiene $MAX_IPS IPs abiertas; no se abren más."
    return 2
  fi
  # Registrada ANTES de abrir: si el job muere a mitad, el cierre igual la limpia.
  echo "$ip" >> "$IPS_FILE"
  RUNNER_IP="$ip" "$LEASE" open || return 2
  return 0
}

probe() { az keyvault secret list --vault-name "$1" --maxresults 1 --only-show-errors 2>&1 >/dev/null; }

# Espera a que cada vault responda OK_STREAK veces seguidas. Una sola respuesta no alcanza:
# puede haber salido por la única IP ya propagada.
wait_open() {
  local v i out streak
  for v in $VAULTS; do
    streak=0
    for ((i = 1; i <= WAIT_TRIES; i++)); do
      if out=$(probe "$v"); then
        streak=$((streak + 1))
        if [ "$streak" -ge "$OK_STREAK" ]; then
          echo "Data plane de $v accesible ($streak respuestas seguidas, intento $i)"
          break
        fi
        continue
      fi
      streak=0
      if ! grep -q "ForbiddenByFirewall" <<< "$out"; then
        echo "$v responde algo que no es el firewall; se sigue sin esperar más."
        break
      fi
      for ip in $(client_ips <<< "$out"); do
        add_ip "$ip" && echo "IP de salida nueva vista por $v: se abrió."
      done
      [ "$i" -eq "$WAIT_TRIES" ] && echo "::warning title=Key Vault::$v sigue rechazando al runner; el plan puede fallar con 403."
      sleep 5
    done
  done
}

case "$CMD" in
  open)
    if [ -n "${RUNNER_IP:-}" ]; then
      add_ip "$RUNNER_IP"; [ $? -eq 2 ] && die "No se pudo abrir la IP del runner"
    fi
    for V in $VAULTS; do
      for ((n = 1; n <= PROBES; n++)); do
        OUT=$(probe "$V") && continue
        for ip in $(client_ips <<< "$OUT"); do
          add_ip "$ip"; [ $? -eq 2 ] && die "No se pudo abrir una IP de salida"
        done
      done
    done
    [ -s "$IPS_FILE" ] || echo "Ningún vault rechazó al runner: no hizo falta abrir nada."
    wait_open
    echo "IPs abiertas por este job: $(tr '\n' ' ' < "$IPS_FILE")"
    ;;

  learn)
    LOG="${2:-}"
    [ -f "$LOG" ] || die "learn requiere un archivo de log"
    grep -q "ForbiddenByFirewall" "$LOG" || exit 1
    NEW=0
    for ip in $(client_ips < "$LOG"); do
      add_ip "$ip"
      case $? in 0) NEW=1 ;; 2) die "No se pudo abrir una IP de salida" ;; esac
    done
    [ "$NEW" = 1 ] || { echo "El 403 fue de una IP ya abierta; reintentar no lo resuelve solo."; exit 1; }
    wait_open
    exit 0
    ;;

  close)
    [ -n "${RUNNER_IP:-}" ] && ! grep -qxF "$RUNNER_IP" "$IPS_FILE" && echo "$RUNNER_IP" >> "$IPS_FILE"
    FAILED=0
    while read -r ip; do
      [[ "$ip" =~ $IP_RE ]] || continue
      RUNNER_IP="$ip" "$LEASE" close || FAILED=1
    done < "$IPS_FILE"
    exit "$FAILED"
    ;;

  *)
    die "Uso: $0 open|learn LOG|close"
    ;;
esac
