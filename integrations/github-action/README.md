# FinOps PR Cost Estimator — GitHub Action

Action *composite*. No hay una publicada: copiá esta carpeta a tu repositorio y referenciala con
`uses: ./integrations/github-action`. La forma más directa, sin copiar nada, es el workflow que
genera **Gobernanza → Shift-Left (PRs) → Configurar**.

La explicación completa (cómo funciona, seguridad, variables, qué incluye el número) está en
[`integrations/README.md`](../README.md).

```yaml
name: costo
on: pull_request

permissions:
  contents: read
  pull-requests: write   # para comentar

jobs:
  estimar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - run: terraform init -input=false
      - run: terraform plan -input=false -out=tfplan.bin

      - uses: ./integrations/github-action
        with:
          api-key: ${{ secrets.FINOPS_API_KEY }}
          script-sha256: '<hash que muestra la pantalla de Shift-Left>'
          # threshold-usd: '200'   # opcional
```

## Entradas

| Nombre | Requerida | Default | Para qué |
|---|---|---|---|
| `api-key` | sí | — | API Key con el scope `write:shift-left`. **Siempre por `secrets`.** |
| `tool` | no | `terraform` | `terraform`, `tofu` o `bicep`. |
| `plan-file` | no | `tfplan.bin` | Plan binario. |
| `plan-json` | no | — | Plan ya en JSON, o el what-if de Bicep. |
| `threshold-usd` | no | — | Umbral del workflow. Con uno en la plataforma, manda el **más estricto**. |
| `comment` | no | `true` | Comentar en el PR (se edita en cada push). |
| `api-url` | no | `https://finops.cscloudsolutions.com.ar` | Sólo para otro entorno. |
| `script-sha256` | no | — | Hash esperado del script. Recomendado. |

## Salidas

`delta-usd`, `projected-usd`, `unpriced` y `gate-status` (`OK`, `EXCEEDED` o `NOT_EVALUATED`).

## Cambios respecto de la versión anterior

- El umbral del workflow ya **no puede aflojar** el de la plataforma: falla el más estricto. Antes
  el del workflow ganaba aunque fuera más laxo, al revés de lo que decía este README.
- Si la plataforma no responde, el PR **no se bloquea** (antes el paso fallaba).
- Sólo sale del runner lo que el estimador necesita: antes viajaba el plan completo.
- Soporta OpenTofu y Bicep, y la lógica es la misma que usan Azure DevOps y GitLab.
