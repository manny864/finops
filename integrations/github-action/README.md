# FinOps PR Cost Estimator — GitHub Action

Calcula cuánto cambia la factura mensual de Azure un `terraform plan`, lo comenta
en el Pull Request y —si querés— falla el check cuando el aumento supera un
umbral.

La idea de Shift-Left es simple: el costo se decide cuando alguien escribe el
`.tf`, no cuando llega la factura. Esta action mueve la conversación a la
revisión del PR, que es donde todavía es barata.

## Uso

```yaml
name: costo
on: pull_request

permissions:
  contents: read
  pull-requests: write   # sin esto no puede comentar

jobs:
  estimar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3

      - run: terraform init
      - run: terraform plan -out=tfplan.bin

      - uses: ./integrations/github-action
        with:
          api-key: ${{ secrets.FINOPS_API_KEY }}
          plan-file: tfplan.bin
          threshold-usd: '200'   # opcional: bloquea si el PR agrega más de $200/mes
```

## Entradas

| Nombre | Requerida | Default | Para qué |
|---|---|---|---|
| `api-key` | sí | — | API Key con el scope `write:shift-left`. **Siempre por `secrets`.** |
| `plan-file` | no | `tfplan.bin` | Plan binario de `terraform plan -out=...`. |
| `plan-json` | no | — | Plan ya convertido a JSON. Si se pasa, no hace falta terraform en el runner. |
| `api-url` | no | `https://finops.cscloudsolutions.com.ar` | Sólo para apuntar a otro entorno. |
| `threshold-usd` | no | — | Budget Gate. Vacío = informa pero no bloquea. |
| `comment` | no | `true` | Comentar en el PR. |

## Salidas

`delta-usd`, `projected-usd` y `unpriced`, para encadenar con otros steps.

## Lo que conviene saber antes de confiar en el número

**El delta es un piso, no un total.** Se tarifa lo que la plataforma sabe mapear
a un medidor de la Azure Retail Prices API. Lo que no, se cuenta aparte y sale en
`unpriced` y en el comentario: si ese número no es cero, el costo real es mayor
que el informado. Se eligió informar de menos y decirlo, antes que estimar de más
en silencio.

**Son precios de lista.** No incluye tus reservas, savings plans, descuentos EA/CSP
ni el markup. Sirve para comparar el antes contra el después de un PR, que es lo
que importa acá; no reemplaza al costo real que muestra la plataforma.

**Recursos cubiertos hoy:** máquinas virtuales Linux y Windows, discos
administrados e IPs públicas. Los que no cuestan nada por definición —resource
groups, subredes, VNets, NICs— se reconocen y no ensucian el contador de "sin
tarifar". Cualquier otro tipo aparece marcado como no soportado.

**El comentario se edita, no se acumula.** Cada push actualiza el mismo
comentario (`--edit-last`): un hilo con seis estimaciones contradictorias es peor
que ninguna.

## Permisos

El scope `write:shift-left` **no viene** en las claves existentes: hay que
otorgarlo explícitamente desde Configuración → API Keys. Es a propósito — una
clave de lectura de costos no debería poder escribir filas de estimación.

El historial queda en **Gobernanza → Shift-Left** (tier Business).

## Por qué es una action `composite` y no una de JavaScript

Una action JS obliga a bundlear con `ncc` y a commitear `dist/`. Ese directorio
es un artefacto generado que hay que acordarse de regenerar en cada cambio, y
cuando alguien se olvida la action sigue corriendo el código viejo sin avisar.
Acá lo que se lee en `action.yml` es exactamente lo que corre.

Necesita `jq`, `curl` y `bc`, que vienen en los runners de GitHub.
