#!/usr/bin/env bash
# Sube el certificado de origen (Cloudflare Origin CA) a Key Vault como .pfx + contraseña.
# Lo corre una persona con `az login` y el rol Key Vault Secrets Officer sobre el vault.
# Runbook: docs/security/endurecimiento-infraestructura-saas-2026-10-09.md, sección 7.3, paso 2c.
#
# Uso:  scripts/subir-certificado-origen.sh [carpeta]
#       DRY_RUN=1 scripts/subir-certificado-origen.sh [carpeta]   sólo la parte local: valida y arma el .pfx
# La carpeta (por defecto ~/origen-cert) trae origen.key, origen.csr y origen.pem. Nada se imprime de la clave
# ni de la contraseña.
set -euo pipefail
umask 077

DIR=${1:-$HOME/origen-cert}
VAULT=${VAULT:-cscs-finops-prod-wus2-kv}
HOST=${HOST:-finops.cscloudsolutions.com.ar}
cd "$DIR"

# 1) Lo que se sube tiene que ser lo que se espera.
[ "$(openssl x509 -in origen.pem -noout -pubkey | openssl md5)" = "$(openssl req -in origen.csr -noout -pubkey | openssl md5)" ] \
  || { echo "origen.pem no corresponde a origen.csr"; exit 1; }
openssl x509 -in origen.pem -noout -text | grep -q "DNS:$HOST" \
  || { echo "el certificado no trae el hostname exacto $HOST"; exit 1; }
openssl x509 -in origen.pem -noout -checkend 0 >/dev/null \
  || { echo "el certificado está vencido"; exit 1; }

# 2) El .pfx, con una contraseña generada. Los algoritmos van fijados (3DES y SHA1, el formato clásico) porque OpenSSL 3
#    usa AES-256 por defecto y no se confirmó que Container Apps lo acepte. El Base64 va en UNA línea: la opción
#    `az keyvault secret set --encoding base64` lo parte en líneas de 76 caracteres.
openssl rand -base64 24 | tr -d '\n' > pfx.pass
openssl pkcs12 -export -inkey origen.key -in origen.pem -out origen.pfx \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -passout file:pfx.pass
base64 < origen.pfx | tr -d '\n' > origen.pfx.b64
echo "pfx armado: $(wc -c < origen.pfx.b64 | tr -d ' ') caracteres de Base64"
if [ -n "${DRY_RUN:-}" ]; then
  echo "DRY_RUN: no se toca Azure"
  exit 0
fi

# 3) El firewall del vault se abre sólo para esta IP y se cierra pase lo que pase.
IP=$(curl -fsS https://api.ipify.org)
[[ "$IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo "api.ipify.org no devolvió una IPv4"; exit 1; }
cerrar() {
  if az keyvault network-rule remove --name "$VAULT" --ip-address "$IP" --only-show-errors > /dev/null 2>&1; then
    echo "Firewall de $VAULT cerrado para $IP"
  else
    echo "No se pudo quitar la regla de $IP (si nunca llegó a abrirse, es normal). Comprobar: az keyvault network-rule list --name $VAULT"
  fi
}
trap cerrar EXIT
az keyvault network-rule add --name "$VAULT" --ip-address "$IP" --only-show-errors > /dev/null
echo "Abierto $VAULT para $IP"

# 4) Esperar a que la regla propague, no un tiempo fijo: el 2026-09-14 el plan de CI murió con 403 ForbiddenByFirewall 38 s
#    después de abrirla. Sólo se espera mientras el error sea del firewall; cualquier otro (por ejemplo RBAC) corta acá.
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

# 5) Los dos secretos salen de archivos: la contraseña no pasa por la línea de comandos.
az keyvault secret set --vault-name "$VAULT" --name origin-cert-pfx --file origen.pfx.b64 --only-show-errors -o none
az keyvault secret set --vault-name "$VAULT" --name origin-cert-pfx-password --file pfx.pass --only-show-errors -o none

# 6) Comprobar que quedó entero: el largo guardado (sin leer el valor) tiene que ser el del archivo.
for par in "origin-cert-pfx:origen.pfx.b64" "origin-cert-pfx-password:pfx.pass"; do
  nombre=${par%%:*}
  archivo=${par#*:}
  en_vault=$(az keyvault secret show --vault-name "$VAULT" --name "$nombre" --query "length(value)" -o tsv --only-show-errors)
  en_archivo=$(wc -c < "$archivo" | tr -d ' ')
  if [ "$en_vault" != "$en_archivo" ]; then
    echo "$nombre: LARGO DISTINTO (vault $en_vault, archivo $en_archivo)"
    exit 1
  fi
  echo "$nombre: ok ($en_vault caracteres)"
done
echo "Listo. Conservar $DIR hasta terminar el paso f del runbook: si Container Apps rechazara el .pfx hace falta la clave para rearmarlo."
