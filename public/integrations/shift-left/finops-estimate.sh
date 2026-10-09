#!/usr/bin/env bash
# FinOps Shift-Left — estima cuánto cambia la factura mensual de Azure un cambio de
# infraestructura ANTES del merge. Sirve para Terraform, OpenTofu y Bicep, y lo usan
# igual la GitHub Action, Azure DevOps, GitLab CI o cualquier otro CI.
#
# Qué hace:
#   1. Obtiene el plan (terraform/tofu show -json) o la salida de un what-if de Bicep.
#   2. Se queda SÓLO con los atributos que el estimador lee (tipo, región, SKU,
#      cantidades). Contraseñas, claves, custom_data y etiquetas no salen del runner.
#   3. Se lo manda a la plataforma FinOps, que lo tarifa con los precios de Azure.
#   4. Escribe el comentario para el Pull Request y devuelve el resultado del Budget Gate.
#
# Variables de entorno (las que ponen los wrappers de cada CI están marcadas con *):
#   FINOPS_API_KEY          API Key con el scope write:shift-left. Siempre desde un secreto.
#   FINOPS_API_URL          Base de la plataforma (por defecto https://finops.cscloudsolutions.com.ar).
#   FINOPS_TOOL             terraform (por defecto), tofu o bicep.
#   FINOPS_PLAN_FILE        Plan binario (terraform/tofu). Por defecto tfplan.bin.
#   FINOPS_PLAN_JSON        Plan ya en JSON, o la salida de `az deployment group what-if
#                           --no-pretty-print` para Bicep. Si se da, FINOPS_PLAN_FILE se ignora.
#   FINOPS_THRESHOLD_USD    Umbral local en USD/mes. Si también hay uno en la plataforma
#                           falla el que sea más estricto: un workflow puede apretar el gate
#                           de su repo, no aflojarlo.
#   FINOPS_REPOSITORY *     owner/repo.        FINOPS_PR_NUMBER *   número del PR.
#   FINOPS_COMMIT_SHA *     commit evaluado.   FINOPS_AUTHOR *      autor del PR.
#   FINOPS_OUTPUT_DIR       Dónde escribir los archivos de salida (por defecto .).
#   FINOPS_RETRY_DELAY      Segundos base entre reintentos ante 429/5xx/sin red (por defecto 4).
#   FINOPS_COMMENT          auto (por defecto), true o false: comentar el resultado en el PR.
#                           En auto comenta sólo si detecta un PR en GitHub, Azure DevOps o
#                           GitLab y hay token. El comentario se EDITA en cada push (lleva una
#                           marca oculta), no se acumulan.
#   Token para comentar     GitHub: GITHUB_TOKEN (permiso pull-requests: write).
#                           Azure DevOps: SYSTEM_ACCESSTOKEN (mapear $(System.AccessToken); la
#                           identidad del build necesita "Contribute to pull requests").
#                           GitLab: FINOPS_GITLAB_TOKEN o GITLAB_TOKEN (scope api; CI_JOB_TOKEN
#                           no alcanza para escribir notas).
#
# Salidas: finops-comment.md (el comentario), finops-result.json (la respuesta completa)
# y finops.env (KEY=VALUE). Si existen, también GITHUB_OUTPUT / GITHUB_STEP_SUMMARY y las
# variables de Azure DevOps.
#
# Código de salida: 0 = ok o sin evaluar; 1 = el Budget Gate se superó;
#                   2 = configuración o entrada inválida (clave, scope, plan).
# Si la plataforma no responde NO se bloquea el PR (sale 0): es un control de costo y
# voltear el trabajo de un equipo por una caída ajena es peor que dejar pasar un cambio caro.
#
# Requiere bash, curl y jq (vienen en los runners de GitHub y de Azure DevOps).
set -euo pipefail

VERSION="1"
API_URL="${FINOPS_API_URL:-https://finops.cscloudsolutions.com.ar}"
API_URL="${API_URL%/}"
TOOL="${FINOPS_TOOL:-terraform}"
OUT_DIR="${FINOPS_OUTPUT_DIR:-.}"

# Atributos que el estimador lee. Si el catálogo del servidor suma uno, se agrega acá:
# un test (iacEstimateScript.test.ts) falla si las dos listas se desfasan.
CAMPOS_TF='["location","size","priority","license_type","os_disk","sku","instances","sku_name","default_node_pool","sku_tier","vm_size","node_count","os_type","min_count","auto_scaling_enabled","worker_count","family","capacity","shard_count","scale_units","type","autoscale_configuration","georeplications","allocation_method","ip_version","storage_account_type","disk_size_gb"]'
ANIDADOS_TF='["storage_account_type","disk_size_gb","vm_size","node_count","min_count","max_count","auto_scaling_enabled","name","tier","capacity","min_capacity","max_capacity","location"]'

anotar() { # $1 = error | warning, $2 = mensaje
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::$1::$2" >&2
  elif [ -n "${TF_BUILD:-}" ]; then echo "##vso[task.logissue type=$1]$2" >&2
  else echo "[finops] $(echo "$1" | tr '[:lower:]' '[:upper:]'): $2" >&2; fi
}
fallar() { anotar error "$1"; exit 2; }

command -v jq >/dev/null 2>&1 || fallar "Falta jq en el runner."
command -v curl >/dev/null 2>&1 || fallar "Falta curl en el runner."
[ -n "${FINOPS_API_KEY:-}" ] || fallar "Falta FINOPS_API_KEY: una API Key con el scope write:shift-left, siempre desde un secreto."
LOCAL_THRESHOLD="${FINOPS_THRESHOLD_USD:-}"
if [ -n "$LOCAL_THRESHOLD" ] && ! printf '%s' "$LOCAL_THRESHOLD" | grep -Eq '^[0-9]+([.][0-9]+)?$'; then
  fallar "FINOPS_THRESHOLD_USD tiene que ser un número (USD por mes), no '$LOCAL_THRESHOLD'."
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT_DIR"

# ── 1. El plan ───────────────────────────────────────────────────────────────
case "$TOOL" in
  terraform|tofu)
    if [ -n "${FINOPS_PLAN_JSON:-}" ]; then
      PLAN_JSON="$FINOPS_PLAN_JSON"
    else
      PLAN_FILE="${FINOPS_PLAN_FILE:-tfplan.bin}"
      [ -f "$PLAN_FILE" ] || fallar "No existe el plan '$PLAN_FILE'. Generalo con '$TOOL plan -out=$PLAN_FILE' antes de este paso, o pasá FINOPS_PLAN_JSON."
      command -v "$TOOL" >/dev/null 2>&1 || fallar "No encuentro '$TOOL' en el PATH. Instalalo, o pasá el plan ya convertido en FINOPS_PLAN_JSON."
      "$TOOL" show -json "$PLAN_FILE" > "$WORK/plan.json" || fallar "'$TOOL show -json $PLAN_FILE' falló."
      PLAN_JSON="$WORK/plan.json"
    fi
    CLAVE_PLAN="plan"
    ;;
  bicep)
    PLAN_JSON="${FINOPS_PLAN_JSON:-}"
    [ -n "$PLAN_JSON" ] || fallar "Para Bicep pasá FINOPS_PLAN_JSON con la salida de: az deployment group what-if --no-pretty-print ... > whatif.json"
    CLAVE_PLAN="what_if"
    ;;
  *) fallar "FINOPS_TOOL tiene que ser terraform, tofu o bicep, no '$TOOL'." ;;
esac
[ -f "$PLAN_JSON" ] || fallar "No existe el archivo '$PLAN_JSON'."
jq -e . "$PLAN_JSON" >/dev/null 2>&1 || fallar "'$PLAN_JSON' no es JSON válido."

# ── 2. Reducir: sólo lo que el estimador lee ─────────────────────────────────
JQ_ANIDADO='def anidado($p): if type=="object" then with_entries(select(.key as $k | $p | index($k)) | .value |= anidado($p)) elif type=="array" then map(anidado($p)) else . end;'
JQ_TF="$JQ_ANIDADO"'
def tope($c; $p): if type=="object" then with_entries(select(.key as $k | $c | index($k)) | .value |= (if type=="object" or type=="array" then anidado($p) else . end)) else . end;
{ format_version: .format_version, terraform_version: .terraform_version,
  resource_changes: [ (.resource_changes // [])[] | { address: .address, type: .type, change: {
      actions: .change.actions,
      before: (.change.before | tope($c; $p)),
      after: (.change.after | tope($c; $p)),
      after_unknown: (.change.after_unknown | tope($c; $p)) } } ] }'
# Bicep: el what-if trae cada recurso entero; se conservan sólo las claves que el estimador
# necesita, en cualquier nivel (las contraseñas y claves viven en claves que no están acá).
CAMPOS_ARM='["agentPoolProfiles","autoscaleConfiguration","capacity","count","diskSizeGB","enableAutoScaling","family","gatewayType","hardwareProfile","isXenon","kind","licenseType","location","managedDisk","maxCapacity","minCapacity","minCount","name","osDisk","osType","priority","properties","publicIPAddressVersion","publicIPAllocationMethod","reserved","scaleSetPriority","scaleUnits","shardCount","sku","storageAccountType","storageProfile","tier","virtualMachineProfile","vmSize"]'
JQ_ARM="$JQ_ANIDADO"'
{ status: .status, changes: [ ((.changes // .properties.changes) // [])[] | { resourceId: .resourceId, changeType: .changeType,
    before: (.before | anidado($c)), after: (.after | anidado($c)) } ] }'

if [ "$TOOL" = "bicep" ]; then
  jq -c --argjson c "$CAMPOS_ARM" --argjson p "$CAMPOS_ARM" "$JQ_ARM" "$PLAN_JSON" > "$WORK/reducido.json" || fallar "No pude leer la salida del what-if."
else
  jq -c --argjson c "$CAMPOS_TF" --argjson p "$ANIDADOS_TF" "$JQ_TF" "$PLAN_JSON" > "$WORK/reducido.json" || fallar "No pude leer el plan: ¿es la salida de '$TOOL show -json'?"
fi

PR="${FINOPS_PR_NUMBER:-}"
printf '%s' "$PR" | grep -Eq '^[0-9]+$' || PR="null"
jq -n --slurpfile plan "$WORK/reducido.json" \
  --arg clave "$CLAVE_PLAN" --arg repo "${FINOPS_REPOSITORY:-}" --arg sha "${FINOPS_COMMIT_SHA:-}" \
  --arg autor "${FINOPS_AUTHOR:-}" --argjson pr "$PR" --arg tool "$TOOL" \
  '{($clave): $plan[0], repository: $repo, commit_sha: $sha, author: $autor, pr_number: $pr, tool: $tool}' > "$WORK/body.json"

# ── 3. Estimar ───────────────────────────────────────────────────────────────
# La clave viaja por stdin (`curl -K -`) y no en la línea de comandos: un argumento se ve
# en la lista de procesos de la máquina.
HTTP="000"
for intento in 1 2 3; do
  HTTP="$(printf 'header = "Authorization: Bearer %s"\n' "$FINOPS_API_KEY" | curl -sS --max-time 60 -K - \
    -o "$WORK/resp.json" -w '%{http_code}' -X POST "$API_URL/api/v1/shift-left/estimate" \
    -H 'Content-Type: application/json' -H "User-Agent: finops-shift-left-script/$VERSION" \
    --data-binary @"$WORK/body.json" 2>"$WORK/curl.err")" || HTTP="000"
  case "$HTTP" in 429|5??|000) [ "$intento" -lt 3 ] && sleep $((intento * ${FINOPS_RETRY_DELAY:-4})) || true ;; *) break ;; esac
done

mensaje_error() { jq -r '.error.message // .error // "sin detalle"' "$WORK/resp.json" 2>/dev/null || echo "sin detalle"; }
case "$HTTP" in
  200) ;;
  401) fallar "La API Key no es válida o fue revocada (HTTP 401): $(mensaje_error)" ;;
  403) fallar "La API Key no tiene el scope write:shift-left (HTTP 403): $(mensaje_error)" ;;
  400|413|422) fallar "La plataforma rechazó la entrada (HTTP $HTTP): $(mensaje_error)" ;;
  *)
    # Falla abierto: caída, 429 sostenido o un 5xx. No se bloquea el PR.
    anotar warning "La plataforma FinOps no respondió (HTTP $HTTP): no se pudo estimar este PR y no se bloquea."
    GATE="NOT_EVALUATED"; DELTA=""; PROJECTED=""; CURRENT=""; UNPRICED=""
    printf 'FINOPS_GATE=%s\n' "$GATE" > "$OUT_DIR/finops.env"
    [ -n "${GITHUB_OUTPUT:-}" ] && echo "gate=$GATE" >> "$GITHUB_OUTPUT" || true
    exit 0
    ;;
esac

cp "$WORK/resp.json" "$OUT_DIR/finops-result.json"
leer() { jq -r "$1" "$WORK/resp.json"; }
DELTA="$(leer '.data.delta_cost_usd')"
PROJECTED="$(leer '.data.projected_monthly_cost_usd')"
CURRENT="$(leer '.data.current_monthly_cost_usd')"
UNPRICED="$(leer '.data.resources_unpriced')"
PLATFORM_GATE="$(leer '.data.budget_gate.status')"

# ── 4. El Budget Gate: el más estricto entre la plataforma y el workflow ─────
GATE="$PLATFORM_GATE"
RAZON="$(leer '.data.budget_gate.reason // ""')"
if [ -n "$LOCAL_THRESHOLD" ]; then
  if jq -en --argjson d "$DELTA" --argjson t "$LOCAL_THRESHOLD" '$d > $t' >/dev/null; then
    GATE="EXCEEDED"; RAZON="local"
  elif [ "$GATE" = "NOT_EVALUATED" ]; then
    GATE="OK"
  fi
fi

# ── 5. El comentario del PR ──────────────────────────────────────────────────
jq -r --arg gate "$GATE" --arg razon "$RAZON" --arg local "$LOCAL_THRESHOLD" '
def miles: tostring | [match("\\d{1,3}(?=(\\d{3})*$)"; "g").string] | join(",");
def usd: . as $n | (($n | fabs) * 100 | round) as $c
  | (if $n < 0 and $c > 0 then "-" else "" end) + "$" + (($c / 100 | floor) | miles) + "."
    + ((($c % 100) | tostring) | if length == 1 then "0" + . else . end);
def firmado: if . > 0 then "+" + usd else usd end;
def nota: {
  "disco-os-no-incluido": "el disco del sistema operativo no está incluido (el plan no trae su tamaño)",
  "discos-os-no-incluidos": "los discos del SO de los nodos no están incluidos",
  "datos-procesados-no-incluidos": "no incluye los datos procesados",
  "transferencia-no-incluida": "no incluye la transferencia de datos",
  "unidades-de-capacidad-no-incluidas": "no incluye las unidades de capacidad consumidas",
  "instancias-adicionales-no-incluidas": "no incluye las instancias adicionales",
  "almacenamiento-no-incluido": "no incluye el almacenamiento",
  "reglas-adicionales-y-datos-no-incluidos": "no incluye reglas adicionales ni datos procesados",
  "lts-no-incluido": "no incluye el soporte extendido (LTS)",
  "autoescalado-minimo": "con autoescalado se toma el mínimo de nodos",
  "spot-variable": "precio Spot: varía con la demanda",
  "region-inferida": "región inferida del resto del plan"
}[.] // .;
def motivo: {
  "por-uso": "se cobra por consumo",
  "tipo-no-soportado": "tipo de recurso sin tarifar",
  "sin-sku": "falta el SKU o el tamaño",
  "sin-region": "sin región",
  "sin-precio": "sin precio en la Retail API",
  "valor-al-aplicar": "se define recién al aplicar",
  "precio-no-disponible": "la API de precios no respondió"
}[.] // .;
.data as $d
| ($d.delta_cost_usd) as $delta
| (if $delta > 0 then "🔺" elif $delta < 0 then "🟢" else "⚪" end) as $icono
| [
  "<!-- finops-shift-left -->",
  "## \($icono) Impacto en el costo mensual de Azure",
  "",
  "| | USD/mes |",
  "|---|---:|",
  "| Antes | \($d.current_monthly_cost_usd | usd) |",
  "| Después | \($d.projected_monthly_cost_usd | usd) |",
  "| **Delta** | **\($delta | firmado)** |",
  (if ($d.discount_pct // 0) > 0 then
     "| Delta a precio de lista | \($d.list_delta_cost_usd | firmado) |\n\n> Precios con tu descuento del \($d.discount_pct)% aplicado."
   else empty end),
  "",
  (if $d.previous then
     "> ↩️ Push anterior: \($d.previous.delta_cost_usd | firmado) → ahora \($delta | firmado) (\(if $delta > $d.previous.delta_cost_usd then "sube" elif $delta < $d.previous.delta_cost_usd then "baja" else "igual" end))."
   else empty end),
  (if $d.budget then
     "**Presupuesto de «\($d.budget.cost_center)»:** "
     + (if $d.budget.delta_pct_of_budget != null then "este cambio equivale al \($d.budget.delta_pct_of_budget)% del presupuesto mensual (\($d.budget.monthly_usd | usd))" else "presupuesto mensual \($d.budget.monthly_usd | usd)" end)
     + "; quedan \($d.budget.remaining_usd | usd) del mes."
   else empty end),
  (if $gate == "EXCEEDED" then
     "⛔ **Budget Gate: umbral superado** — " + (
       if $razon == "pct" then "agrega más del \($d.budget_gate.threshold_pct_of_remaining)% del presupuesto restante."
       elif $razon == "local" then "agrega \($delta | usd) y el umbral del workflow es \($local | tonumber | usd)/mes."
       else "agrega \($delta | usd) y el umbral del repositorio es \($d.budget_gate.threshold_usd | usd)/mes." end)
   elif $gate == "OK" then "✅ **Budget Gate:** dentro del umbral."
   else empty end),
  (if $d.resources_unpriced > 0 then
     "> ⚠️ \($d.resources_unpriced) recurso(s) no se pudieron tarifar o se cobran por consumo (\($d.resources_by_use // 0) por consumo): el delta es un piso, no el total."
   else empty end),
  "",
  "<details><summary>Desglose por recurso</summary>",
  "",
  "| Recurso | Acción | Antes | Después | Notas |",
  "|---|---|---:|---:|---|",
  ($d.lines[] | select(.mensualAntes != 0 or .mensualDespues != 0 or .motivo != null)
    | "| `\(.direccion)` | \(.accion) | \(.mensualAntes | usd) | \(.mensualDespues | usd) | "
      + ([(if .motivo then "⚠️ " + (.motivo | motivo) else empty end), ((.notas // [])[] | nota)] | join("; ")) + " |"),
  "",
  "</details>",
  "",
  "<sub>Precios de lista de la Azure Retail Prices API, sin reservas ni descuentos que no estén configurados en la plataforma.</sub>"
] | map(select(. != null)) | join("\n")' "$WORK/resp.json" > "$OUT_DIR/finops-comment.md"


# ── 5b. Publicar el comentario en el PR ──────────────────────────────────────
# Marca oculta al inicio del comentario: así se encuentra el de la corrida anterior y se
# edita en vez de apilar uno nuevo por push (un hilo con seis estimaciones es peor que ninguna).
MARCA='<!-- finops-shift-left -->'

# Todas las llamadas llevan el token por stdin (`curl -K -`), no en la línea de comandos.
http_ci() { # $1 = encabezado de auth completo, $2 = método, $3 = url, $4 = archivo de cuerpo (opcional)
  printf 'header = "%s"\n' "$1" | curl -sS --max-time 30 -K - -X "$2" "$3" \
    -H 'Accept: application/json' ${4:+-H 'Content-Type: application/json' --data-binary @"$4"} \
    -o "$WORK/ci.out" -w '%{http_code}' 2>/dev/null || echo "000"
}
exito() { case "$1" in 200|201) return 0 ;; *) return 1 ;; esac; }

# Publica o actualiza. $1 = proveedor. Devuelve 0 si quedó publicado.
publicar_comentario() {
  local codigo
  case "$1" in
    github)
      local base="${GITHUB_API_URL:-https://api.github.com}/repos/${GITHUB_REPOSITORY:-}" auth="Authorization: Bearer ${GITHUB_TOKEN:-}" id="" pagina
      jq -Rs '{body: .}' "$OUT_DIR/finops-comment.md" > "$WORK/payload.json"
      for pagina in 1 2 3 4 5; do
        codigo="$(http_ci "$auth" GET "$base/issues/$PR/comments?per_page=100&page=$pagina")"
        exito "$codigo" || break
        id="$(jq -r --arg m "$MARCA" '[.[] | select((.body // "") | contains($m))] | .[0].id // empty' "$WORK/ci.out")"
        [ -n "$id" ] || [ "$(jq 'length' "$WORK/ci.out")" -lt 100 ] && break
      done
      # Si ni siquiera se pudo listar, no se crea a ciegas: sin permiso de lectura un POST por
      # push dejaría un comentario nuevo cada vez.
      if ! exito "$codigo"; then :
      elif [ -n "$id" ]; then codigo="$(http_ci "$auth" PATCH "$base/issues/comments/$id" "$WORK/payload.json")"
      else codigo="$(http_ci "$auth" POST "$base/issues/$PR/comments" "$WORK/payload.json")"; fi
      ;;
    azuredevops)
      local proyecto base auth tid cid
      proyecto="$(jq -rn --arg p "${SYSTEM_TEAMPROJECT:-}" '$p | @uri')"
      base="${SYSTEM_COLLECTIONURI%/}/$proyecto/_apis/git/repositories/${BUILD_REPOSITORY_ID:-}/pullRequests/$PR/threads"
      auth="Authorization: Bearer ${SYSTEM_ACCESSTOKEN:-}"
      codigo="$(http_ci "$auth" GET "$base?api-version=7.1")"
      tid=""; cid=""
      if exito "$codigo"; then
        read -r tid cid < <(jq -r --arg m "$MARCA" '[.value[]? | select(.isDeleted != true) | . as $t | $t.comments[]? | select(.isDeleted != true and ((.content // "") | contains($m))) | "\($t.id) \(.id)"] | .[0] // ""' "$WORK/ci.out") || true
      fi
      if [ -n "$tid" ] && [ -n "$cid" ]; then
        jq -Rs '{content: .}' "$OUT_DIR/finops-comment.md" > "$WORK/payload.json"
        codigo="$(http_ci "$auth" PATCH "$base/$tid/comments/$cid?api-version=7.1" "$WORK/payload.json")"
      else
        jq -Rs '{comments: [{parentCommentId: 0, content: ., commentType: 1}], status: 1}' "$OUT_DIR/finops-comment.md" > "$WORK/payload.json"
        codigo="$(http_ci "$auth" POST "$base?api-version=7.1" "$WORK/payload.json")"
      fi
      ;;
    gitlab)
      local base="${CI_API_V4_URL:-}/projects/${CI_PROJECT_ID:-}/merge_requests/$PR/notes" auth="PRIVATE-TOKEN: ${FINOPS_GITLAB_TOKEN:-${GITLAB_TOKEN:-}}" id="" pagina
      jq -Rs '{body: .}' "$OUT_DIR/finops-comment.md" > "$WORK/payload.json"
      for pagina in 1 2 3 4 5; do
        codigo="$(http_ci "$auth" GET "$base?per_page=100&page=$pagina")"
        exito "$codigo" || break
        id="$(jq -r --arg m "$MARCA" '[.[] | select(.system != true and ((.body // "") | contains($m)))] | .[0].id // empty' "$WORK/ci.out")"
        [ -n "$id" ] || [ "$(jq 'length' "$WORK/ci.out")" -lt 100 ] && break
      done
      if ! exito "$codigo"; then :
      elif [ -n "$id" ]; then codigo="$(http_ci "$auth" PUT "$base/$id" "$WORK/payload.json")"
      else codigo="$(http_ci "$auth" POST "$base" "$WORK/payload.json")"; fi
      ;;
  esac
  if exito "$codigo"; then return 0; fi
  anotar warning "No pude publicar el comentario en el PR (HTTP $codigo). El resultado está en el log y en finops-comment.md."
  return 1
}

COMENTAR="${FINOPS_COMMENT:-auto}"
if [ "$COMENTAR" != "false" ]; then
  PROVEEDOR=""
  if [ -n "${GITHUB_ACTIONS:-}" ]; then PROVEEDOR="github"
  elif [ -n "${TF_BUILD:-}" ]; then PROVEEDOR="azuredevops"
  elif [ -n "${GITLAB_CI:-}" ]; then PROVEEDOR="gitlab"; fi
  # GitLab entrega el número del MR en su propia variable.
  if [ "$PROVEEDOR" = "gitlab" ] && [ "$PR" = "null" ] && [ -n "${CI_MERGE_REQUEST_IID:-}" ]; then PR="$CI_MERGE_REQUEST_IID"; fi
  if [ -z "$PROVEEDOR" ] || [ "$PR" = "null" ]; then
    : # Sin PR o sin un CI conocido no hay dónde comentar: el resultado queda en el log y en los archivos.
  else
    TOKEN_OK=1
    case "$PROVEEDOR" in
      github) [ -n "${GITHUB_TOKEN:-}" ] || TOKEN_OK=0 ;;
      azuredevops) [ -n "${SYSTEM_ACCESSTOKEN:-}" ] || TOKEN_OK=0 ;;
      gitlab) [ -n "${FINOPS_GITLAB_TOKEN:-${GITLAB_TOKEN:-}}" ] || TOKEN_OK=0 ;;
    esac
    if [ "$TOKEN_OK" = "1" ]; then publicar_comentario "$PROVEEDOR" || true
    else anotar warning "No hay token para comentar en el PR (GitHub: GITHUB_TOKEN, Azure DevOps: SYSTEM_ACCESSTOKEN, GitLab: FINOPS_GITLAB_TOKEN). Se informa el resultado igual."; fi
  fi
fi

# ── 6. Salidas ───────────────────────────────────────────────────────────────
cat "$OUT_DIR/finops-comment.md"
{
  printf 'FINOPS_DELTA_USD=%s\nFINOPS_PROJECTED_USD=%s\nFINOPS_CURRENT_USD=%s\nFINOPS_UNPRICED=%s\nFINOPS_GATE=%s\n' \
    "$DELTA" "$PROJECTED" "$CURRENT" "$UNPRICED" "$GATE"
} > "$OUT_DIR/finops.env"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "delta=$DELTA"; echo "projected=$PROJECTED"; echo "unpriced=$UNPRICED"; echo "gate=$GATE"; } >> "$GITHUB_OUTPUT"
fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat "$OUT_DIR/finops-comment.md" >> "$GITHUB_STEP_SUMMARY"; fi
if [ -n "${TF_BUILD:-}" ]; then
  echo "##vso[task.setvariable variable=finopsDeltaUsd]$DELTA"
  echo "##vso[task.setvariable variable=finopsGate]$GATE"
fi

if [ "$GATE" = "EXCEEDED" ]; then
  anotar error "Budget Gate superado: el cambio agrega $DELTA USD por mes."
  exit 1
fi
exit 0
