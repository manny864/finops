# Integraciones de CI — FinOps Shift-Left

Muestran el costo mensual de un cambio de infraestructura **en el Pull Request**, antes del
merge, y pueden fallar el check si supera el umbral (Budget Gate). Funcionan con **Terraform,
OpenTofu y Bicep**, y en **GitHub, Azure DevOps y GitLab** (o cualquier otro CI).

## Cómo empezar

1. En la plataforma: **Integraciones y API → API Pública**, generar una clave con el permiso
   `write:shift-left` (plan Enterprise). Guardarla como secreto del CI: `FINOPS_API_KEY`.
2. En **Gobernanza → Shift-Left (PRs) → Configurar** elegir la herramienta y copiar el
   workflow de tu plataforma. Ya trae la URL de la plataforma y el SHA-256 del script.
3. Abrir un Pull Request que toque infraestructura.

Los archivos de esta carpeta son lo mismo en forma de plantilla, para quien prefiera
incorporarlos al repositorio.

| Carpeta | Para |
|---|---|
| `github-action/` | Action *composite* de GitHub (para copiarla a tu repo; no hay una publicada) |
| `azure-devops/finops-shift-left.yml` | Plantilla de pasos para Azure Pipelines |
| `gitlab-ci/finops-shift-left.yml` | Job base (`.finops-shift-left`) para GitLab CI |

## Cómo funciona

Todo pasa por **un solo script**, `public/integrations/shift-left/finops-estimate.sh`, que la
plataforma sirve en `/integrations/shift-left/finops-estimate.sh`. Los wrappers de cada CI sólo
lo descargan, verifican su hash y lo ejecutan. Hay una sola lógica y está probada de punta a
punta (`__tests__/unit/iacEstimateScript.test.ts`).

1. Obtiene el plan: `terraform|tofu show -json`, o la salida de
   `az deployment group what-if --no-pretty-print` para Bicep.
2. **Lo reduce a lo que el estimador lee** (tipo, región, SKU, cantidades). Contraseñas, claves,
   `custom_data` y etiquetas **no salen del runner**: un `terraform show -json` las trae en claro.
3. Lo manda a la plataforma, que lo tarifa con la Azure Retail Prices API.
4. Escribe el comentario del PR (y lo **edita** en cada push, no lo apila) y devuelve el resultado
   del gate.

### Seguridad

- **El hash del script va fijado** en el workflow. Si el archivo que se descarga cambia, el paso
  falla antes de ejecutarlo.
- La API Key viaja por **stdin** de `curl` y no en la línea de comandos: un argumento se ve en la
  lista de procesos de la máquina.
- Sólo se envían los atributos del catálogo (un test falla si el script y el servidor se desfasan).

### Variables

| Variable | Para qué |
|---|---|
| `FINOPS_API_KEY` | API Key con el permiso `write:shift-left`. Siempre desde un secreto. |
| `FINOPS_API_URL` | Base de la plataforma. |
| `FINOPS_TOOL` | `terraform` (defecto), `tofu` o `bicep`. |
| `FINOPS_PLAN_FILE` / `FINOPS_PLAN_JSON` | Plan binario, o ya en JSON (en Bicep, la salida del what-if). |
| `FINOPS_THRESHOLD_USD` | Umbral del workflow. Si la plataforma también tiene uno, falla el **más estricto**. |
| `FINOPS_REPOSITORY`, `FINOPS_PR_NUMBER`, `FINOPS_COMMIT_SHA`, `FINOPS_AUTHOR` | Contexto del PR; los pone cada wrapper. |
| `FINOPS_COMMENT` | `auto` (defecto), `true` o `false`. |

Tokens para comentar: **GitHub** `GITHUB_TOKEN` (`pull-requests: write`); **Azure DevOps**
`SYSTEM_ACCESSTOKEN` (la identidad del build necesita *Contribute to pull requests*); **GitLab**
`FINOPS_GITLAB_TOKEN` (scope `api`; `CI_JOB_TOKEN` no alcanza para escribir notas).

### Código de salida

`0` ok o sin evaluar · `1` Budget Gate superado · `2` configuración o entrada inválida (clave,
scope, plan). **Si la plataforma no responde, no se bloquea el PR** (sale `0`): es un control de
costo y voltear el trabajo de un equipo por una caída ajena es peor que dejar pasar un cambio caro.
Una clave inválida o sin scope sí falla (`2`): ahí no hay nada que "dejar pasar".

## Qué incluye el número

- **Precios de lista** de la Azure Retail Prices API, con el **descuento del cliente** si está
  configurado en la plataforma (se muestran los dos).
- **Es un piso, no un total.** Los recursos que se cobran por consumo (Storage, Log Analytics…) y los
  que no se pudieron tarifar salen aparte, con su motivo. Cada línea indica además qué NO incluye
  (datos procesados, transferencia, instancias adicionales…).
- Cobertura: máquinas virtuales y *scale sets*, discos, IPs públicas, AKS, App Service Plan, Redis,
  Azure Firewall, Bastion, VPN Gateway, Application Gateway, Container Registry, NAT Gateway y
  Load Balancer. Las bases de datos administradas todavía no (ver `docs/plan-ampliar-shift-left-2026-10-08.md`).
- **Bicep** se lee del *what-if* de ARM, que consulta tu suscripción: necesita credenciales de Azure.
  El what-if no resuelve la función `reference()`.
