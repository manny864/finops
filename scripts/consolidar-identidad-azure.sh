#!/usr/bin/env bash
#
# Consolidación de las dos identidades de Manuel en el directorio (decidida el
# 2026-09-07, medida el 2026-09-22).
#
#   GUEST  mchavez_cscloudsolutions.com.ar#EXT#@...   1926fcd6-4537-4c58-93a0-fd28ba6eefb5   ← queda
#   MEMBER mchavez@cscloudsolutionsoutlook...        3a469a6b-cbb5-49e7-a25c-96776d9a68f3   ← se va
#
# POR QUÉ NO ES "BORRAR LAS DE LA MEMBER Y LISTO"
# Medidas las 11 asignaciones de la member, cuatro NO las tiene la guest, y dos
# de ellas son de OTROS proyectos --el sitio corporativo y el LinkedIn MCP--, que
# es exactamente por qué no aparecieron cuando esto se decidió mirando FinOps.
# Borrarlas sin replicar deja un 403 sin causa aparente el día que alguien
# necesite esos secretos: el mismo síntoma que ya cortó el destroy de staging a
# la mitad.
#
# EL ORDEN IMPORTA, POR DOS RAZONES
#   1. Replicar va ANTES de borrar. Si algo del paso 1 falla, se corta sin haber
#      quitado nada y no se pierde acceso.
#   2. `Owner` sobre el management group va ÚLTIMO. Es lo único que le da a la
#      member permiso para borrar asignaciones de rol: si se va primero, los
#      borrados que queden fallan con 403 y el estado queda a medio camino.
#
# ANTES DE CORRER
#   az account show --query user.name -o tsv
# Tiene que devolver la MEMBER: es la que tiene Owner sobre el management group
# y por lo tanto la única de las dos que puede ejecutar los borrados. La guest
# también podría (tiene User Access Administrator en la raíz).
#
# DESPUÉS DE CORRER
#   az logout && az login
# y entrar con la GUEST. El `az` de la laptop queda logueado con una identidad
# sin permisos y todo empieza a dar 403 sin motivo aparente.
#
# USO
#   ./scripts/consolidar-identidad-azure.sh              # muestra lo que haría
#   ./scripts/consolidar-identidad-azure.sh --ejecutar   # lo hace
#
set -uo pipefail

GUEST=1926fcd6-4537-4c58-93a0-fd28ba6eefb5
MEMBER=3a469a6b-cbb5-49e7-a25c-96776d9a68f3
SUB=/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e
MG=/providers/Microsoft.Management/managementGroups/81ebe027-e6af-4e09-bc73-58c9012c6408

EJECUTAR=false
[[ "${1:-}" == "--ejecutar" ]] && EJECUTAR=true

corre() {
  if $EJECUTAR; then
    echo "  -> $*"
    "$@" || { echo "  FALLÓ. Se corta acá para no dejar el estado a medias."; exit 1; }
  else
    echo "  [dry-run] $*"
  fi
}

# --- Paso 1: replicar en la guest lo que hoy SÓLO alcanza la member -----------
#
# Los dos primeros son Key Vaults de otros proyectos. Los dos últimos salieron
# de medir, no del plan original: sin ellos la consolidación pierde capacidades
# en silencio.
echo "== Paso 1: replicar en la GUEST (aditivo, reversible) =="

echo "[1/4] Key Vault Secrets Officer en cscs-kv-wus2-prod (sitio corporativo)"
corre az role assignment create --assignee-object-id "$GUEST" --assignee-principal-type User \
  --role "Key Vault Secrets Officer" \
  --scope "$SUB/resourceGroups/cscs-webpage-wus2-prod/providers/Microsoft.KeyVault/vaults/cscs-kv-wus2-prod"

echo "[2/4] Key Vault Administrator en kvcscse22c35 (LinkedIn MCP)"
corre az role assignment create --assignee-object-id "$GUEST" --assignee-principal-type User \
  --role "Key Vault Administrator" \
  --scope "$SUB/resourceGroups/rg-cscs-linkedin-mcp/providers/Microsoft.KeyVault/vaults/kvcscse22c35"

# La guest tiene `Foundry User` en este RG, que NO es lo mismo: AI Developer
# permite crear y correr proyectos, Foundry User sólo consumirlos.
echo "[3/4] Azure AI Developer en cscs-finops-mgmt-eastus2-rg"
corre az role assignment create --assignee-object-id "$GUEST" --assignee-principal-type User \
  --role "Azure AI Developer" \
  --scope "$SUB/resourceGroups/cscs-finops-mgmt-eastus2-rg"

echo "[4/4] Foundry User en accounts/mchavez-8282-resource"
corre az role assignment create --assignee-object-id "$GUEST" --assignee-principal-type User \
  --role "Foundry User" \
  --scope "$SUB/resourceGroups/cscs-finops-mgmt-eastus2-rg/providers/Microsoft.CognitiveServices/accounts/mchavez-8282-resource"

# --- Verificación: no se borra nada hasta que el paso 1 se vea reflejado ------
echo
echo "== Verificación del paso 1 =="
if $EJECUTAR; then
  echo "  Esperando 30 s: las asignaciones de RBAC tardan en propagarse."
  sleep 30
  faltan=0
  for par in \
    "Key Vault Secrets Officer|cscs-kv-wus2-prod" \
    "Key Vault Administrator|kvcscse22c35" \
    "Azure AI Developer|cscs-finops-mgmt-eastus2-rg" \
    "Foundry User|mchavez-8282-resource"
  do
    rol="${par%%|*}"; alcance="${par##*|}"
    if az role assignment list --all --assignee "$GUEST" \
         --query "[?roleDefinitionName=='$rol' && contains(scope,'$alcance')] | length(@)" -o tsv | grep -qv '^0$'; then
      echo "  OK   $rol en $alcance"
    else
      echo "  NO   $rol en $alcance"; faltan=1
    fi
  done
  if [[ $faltan -eq 1 ]]; then
    echo
    echo "Falta alguna. NO se borra nada. Revisá y volvé a correr."
    exit 1
  fi
else
  echo "  [dry-run] se verifica que las 4 estén antes de borrar nada"
fi

# --- Paso 2: quitar las de la member -----------------------------------------
echo
echo "== Paso 2: quitar las asignaciones de la MEMBER (irreversible) =="

quitar() {
  local rol="$1" alcance="$2"
  echo "  $rol"
  corre az role assignment delete --assignee "$MEMBER" --role "$rol" --scope "$alcance"
}

# Redundantes: la guest ya tiene lo mismo o más.
quitar "Key Vault Secrets Officer"          "$SUB/resourceGroups/cscs-finops-prod-westus2-rg/providers/Microsoft.KeyVault/vaults/cscs-finops-prod-wus2-kv"
quitar "Storage Blob Data Contributor"      "$SUB/resourceGroups/cscs-finops-mgmt-eastus2-rg/providers/Microsoft.Storage/storageAccounts/cscsfinopsmgmtqak5xmsa"
quitar "Azure AI Administrator"             "$SUB/resourceGroups/cscs-multi-openai"
quitar "Azure AI Administrator"             "$SUB/resourceGroups/cscs-multi-openai/providers/Microsoft.CognitiveServices/accounts/cscs-multi-openai"
quitar "Cognitive Services OpenAI Contributor" "$SUB/resourceGroups/cscs-multi-openai/providers/Microsoft.CognitiveServices/accounts/cscs-multi-openai"
quitar "Foundry Owner"                      "$SUB/resourceGroups/cscs-multi-openai"

# Replicadas recién en el paso 1.
quitar "Key Vault Secrets Officer"          "$SUB/resourceGroups/cscs-webpage-wus2-prod/providers/Microsoft.KeyVault/vaults/cscs-kv-wus2-prod"
quitar "Key Vault Administrator"            "$SUB/resourceGroups/rg-cscs-linkedin-mcp/providers/Microsoft.KeyVault/vaults/kvcscse22c35"
quitar "Azure AI Developer"                 "$SUB/resourceGroups/cscs-finops-mgmt-eastus2-rg"
quitar "Foundry User"                       "$SUB/resourceGroups/cscs-finops-mgmt-eastus2-rg/providers/Microsoft.CognitiveServices/accounts/mchavez-8282-resource"

# ÚLTIMO: es el permiso con el que la member ejecuta todo lo de arriba.
echo "  Owner en el management group (va último: es lo que habilita los borrados)"
corre az role assignment delete --assignee "$MEMBER" --role "Owner" --scope "$MG"

echo
if $EJECUTAR; then
  echo "== Listo. Ahora: az logout && az login  (entrar con la GUEST, #EXT#) =="
  echo "   Hasta que lo hagas, el az de esta laptop va a dar 403 en todo."
  echo
  echo "   Verificación final, ya logueado como la guest:"
  echo "     az role assignment list --all --assignee $MEMBER -o table   # tiene que salir vacío"
else
  echo "== Era un dry-run. Para hacerlo: $0 --ejecutar =="
fi
