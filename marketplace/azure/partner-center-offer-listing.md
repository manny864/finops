# Partner Center — Offer listing, campo por campo

Oferta **CSCloudFinops**, pestaña *Offer listing*. Cada bloque de abajo es para
copiar y pegar tal cual en el campo que lleva el mismo nombre en el formulario.

El texto autocompletado por el asistente de IA de Partner Center está reemplazado
a propósito: decía "cloud environments" y "cloud spending" en genérico, cuando
esta plataforma es **específica de Azure**. En una oferta del Azure Marketplace,
describirla como multi-cloud es a la vez vago y falso, y el comprador que busca
"Azure cost management" no la encuentra.

---

## Marketplace details

### Name

```
CSCloudSolutions FinOps
```

El autofill puso `CSCloudFinops`. La marca es CSCloudSolutions y el producto es
FinOps; el nombre pegado es el que ve el comprador en los resultados de búsqueda
y el que tiene que reconocer después en la factura de Microsoft.

### Search results summary

Es la línea que aparece bajo el nombre en los resultados. Máximo 100 caracteres.

```
Azure cost visibility, anomaly alerts with a named owner, and remediation you can run.
```

85 caracteres. Dice qué hace y qué lo diferencia (el dueño de la anomalía), en
vez de "optimize your cloud financial operations", que no dice nada que un
competidor no diría igual.

### Description

Pegar en modo **HTML** (el botón `HTML` arriba a la derecha del editor).
4066 caracteres con tags, dentro del límite de 5000.

```html
<p><strong>CSCloudSolutions FinOps</strong> turns Azure billing data into decisions someone owns. It reads your Cost Management exports and Resource Graph inventory, attributes every dollar to a service, resource, tag and cost center, and tells a named person when their spend breaks pattern.</p>

<p>Most cost tools stop at the chart. This one closes the loop: every deviation is assigned to an owner, carries a triage state, and is tracked to resolution.</p>

<h3>What it does</h3>
<ul>
<li><strong>Cost attribution that reconciles.</strong> Spend broken down by category, service, resource and tag from a single daily ingestion, so totals agree across views instead of drifting between screens.</li>
<li><strong>Anomaly detection with an owner.</strong> Deviations are detected statistically and assigned to a person or team, resolved from cost-group membership, naming patterns or resource tags. Each one carries a state (open, investigating, justified, resolved) and a time-to-action metric.</li>
<li><strong>Budgets per cost center.</strong> Allocation across teams, subsidiaries and environments, with alerts before the month closes rather than after.</li>
<li><strong>Commitment management.</strong> Reservation and Savings Plan coverage, utilization and expiry dates, so renewals become a decision instead of a surprise.</li>
<li><strong>Waste detection and remediation.</strong> Idle and orphaned resources, unattached disks, unused public IPs, oversized VMs, idle networking and backup orphans, with in-platform remediation from the Business plan.</li>
<li><strong>Kubernetes and AKS cost.</strong> Spend by namespace and workload plus container efficiency, for the clusters that usually escape the invoice breakdown.</li>
<li><strong>Storage efficiency.</strong> Access-tier opportunities, snapshot sprawl and lifecycle gaps.</li>
<li><strong>Power schedules.</strong> Start and stop calendars for non-production compute, applied and audited from the platform.</li>
<li><strong>Azure Advisor action center.</strong> Advisor recommendations tracked to closure instead of re-read every month.</li>
<li><strong>FinOps maturity and scorecard.</strong> Where your practice stands against the FinOps Framework capabilities, and what moves next.</li>
<li><strong>Multi-tenant cost allocation.</strong> Several Microsoft Entra ID directories under one contract, with isolated quotas and inherited plan.</li>
<li><strong>Open exports and API.</strong> FOCUS-aligned cost exports into Power BI, Microsoft Fabric or your own warehouse. Your data leaves in a format you can read.</li>
<li><strong>FinOps Copilot.</strong> Answers from your own cost data, with the figures it used, rather than from a generic model.</li>
</ul>

<h3>How it connects</h3>
<p>Read-only by default. Onboarding generates a script you run in your own Azure tenant, granting <em>Reader</em> and <em>Cost Management Reader</em> over the subscriptions you select. Write access (<em>Contributor</em>) is requested only if you enable in-platform remediation, available from the Business plan, and stays scoped to the subscriptions you choose. Nothing is deployed into your subscriptions and no agent is installed.</p>

<h3>Who it is for</h3>
<p>Cloud FinOps analysts, platform and infrastructure teams, and finance stakeholders who need Azure spend explained by owner and cost center, not just charted.</p>

<h3>Plans</h3>
<ul>
<li><strong>Professional</strong> &mdash; 2 Azure subscriptions, 3 platform users.</li>
<li><strong>Business</strong> &mdash; 3 Azure subscriptions, 5 platform users, 2 directories for cost allocation, in-platform remediation and SSO.</li>
<li><strong>Enterprise</strong> &mdash; unlimited subscriptions and users, TTL policies and the Advisor action center, with terms set by contract.</li>
</ul>
<p>Additional subscriptions, directories and users can be added to Professional and Business at any time from inside the platform.</p>

<p>Interface available in Spanish, English and Brazilian Portuguese. Some advanced analytics modules are currently Spanish-only.</p>
```

**La última línea sobre idiomas no es un detalle.** Un audit de las 12 páginas
principales contra `/en/...` mostró que 7 renderizan en español porque tienen
los textos hardcodeados: dashboard, whiteboard, anomalías, madurez, scorecard,
zombies y advisor. Sólo commitments, budgets, cost-centers y storage-efficiency
están íntegramente en inglés. Si la ficha declarara inglés a secas, el revisor
de certificación clickea y ve otro idioma. Declararlo evita el rechazo y fija la
expectativa; el arreglo de fondo es traducir esos paneles.

**Cuidado con el bloque de Plans.** Esos son los límites que la plataforma
*aplica de verdad* (`SUBSCRIPTION_LIMITS` y `USER_LIMITS` en
`src/lib/tierLogic.ts`). Si acá se prometen más, el cliente no ve un error: la
app trunca la lista de suscripciones en el tope del plan y en silencio. Vería
menos de las que pagó y nada le explicaría por qué.

### Getting Started Instructions

Obligatorio porque la oferta se vende a través de Microsoft. Es lo que el
comprador lee justo después de pagar, así que describe el circuito real.

```
After completing your purchase in Azure, select "Configure account" on the subscription page. You will be redirected to CSCloudSolutions FinOps to finish setup.

1. CONFIRM YOUR PLAN
Your Azure subscription is resolved automatically and the plan you purchased is shown for confirmation. Select "Activate" to link it to your new workspace.

2. CREATE YOUR ADMIN ACCOUNT
Sign in with your work Microsoft account. That account becomes the administrator of your workspace and can invite the rest of your team.

3. CONNECT YOUR AZURE SUBSCRIPTIONS
In Settings > Cloud Accounts, follow the onboarding wizard. It generates a script you run in your own Azure tenant, which grants the platform Reader and Cost Management Reader over the subscriptions you select. This is read-only access; nothing is deployed into your subscriptions and no agent is installed.

If you plan to use in-platform remediation (Business plan and above), the same script can additionally grant Contributor, scoped to the subscriptions you choose.

4. WAIT FOR THE FIRST INGESTION
Cost data begins loading immediately. Historical cost and inventory typically complete within a few hours of connecting a subscription, depending on its size and history.

NEED HELP?
Email soporte@cscloudsolutions.com.ar or visit https://finops.cscloudsolutions.com.ar/en/support
```

### Search keywords

Tres, y las tres tienen que ser términos que alguien tipea. `CSCloudFinops` era
un desperdicio: quien ya conoce la marca no busca por categoría.

```
azure cost management
finops
cloud cost optimization
```

---

## Legal

### Privacy policy link

```
https://finops.cscloudsolutions.com.ar/en/legal/privacy
```

Verificado en producción (la variante `/es/` responde 200; confirmar que `/en/`
también antes de enviar — la ruta es la misma con otro locale).

> El formulario sólo pide privacidad, pero conviene tener también
> `/en/legal/terms`, `/en/legal/dpa`, `/en/legal/security` y
> `/en/legal/subprocessors`, que ya existen: van como *Product information
> links* más abajo y es lo primero que pide un comprador corporativo.

---

## Contact information

### Support contact

Éste **sí se publica** al cliente.

| Campo | Valor |
|---|---|
| Name | `CSCloudSolutions Support` |
| Email | `soporte@cscloudsolutions.com.ar` |
| Phone | `+5492320670178` |
| Support link | `https://finops.cscloudsolutions.com.ar/en/support` |

Va el nombre del equipo y no de una persona a propósito: si la persona cambia de
rol, el dato publicado en el Marketplace queda viejo y hay que reeditar la
oferta.

### Engineering contact

Éste **no se publica**: lo usa Microsoft para escalar problemas técnicos de la
oferta (fallas del webhook, certificación, incidentes de fulfillment). Tiene que
llegarle a alguien que pueda actuar, no a una casilla compartida.

| Campo | Valor |
|---|---|
| Name | `Manuel Chavez` |
| Email | `mchavez@cscloudsolutions.com.ar` |
| Phone | `+5492320670178` |

---

## Supplemental product information for customers

### Product information links

`Add a link` por cada uno:

| Link title | Link URL |
|---|---|
| Product documentation | `https://finops.cscloudsolutions.com.ar/en/support` |
| Terms of use | `https://finops.cscloudsolutions.com.ar/en/legal/terms` |
| Data processing addendum | `https://finops.cscloudsolutions.com.ar/en/legal/dpa` |
| Security | `https://finops.cscloudsolutions.com.ar/en/legal/security` |
| Subprocessors | `https://finops.cscloudsolutions.com.ar/en/legal/subprocessors` |

Las cinco rutas existen en `src/app/[locale]/legal/`. DPA, seguridad y
subprocesadores son exactamente lo que revisa un comprador corporativo antes de
aprobar la compra, y tenerlos acá evita un ida y vuelta por mail.

### Product information documents

Acepta PDF. Subir el **manual de usuario en inglés**, que ya está generado en
`docs/manuales/`.

---

## Marketplace media

### Logos — Large (obligatorio)

PNG cuadrado, entre 216×216 y 350×350. Recomendado 300×300: Microsoft deriva los
tamaños chicos a partir de éste, y partir de 300 da mejor resultado al reducir
que partir del mínimo.

El logo tiene que ser **legible a 48×48**, que es como aparece en los resultados
de búsqueda. Un logo con el nombre completo al lado se vuelve ilegible a ese
tamaño: usar la marca sola, sin el texto.

### Screenshots (al menos 1, hasta 5)

PNG de **exactamente 1280×720**, cada uno con caption. El orden importa: el
primero es el que se ve sin hacer scroll.

Propuesta, de mayor a menor impacto:

| # | Pantalla | Caption |
|---|---|---|
| 1 | Dashboard principal | `Azure spend, forecast and detected waste in one view.` |
| 2 | Anomalías con dueño | `Every cost deviation is assigned to a named owner and tracked to resolution.` |
| 3 | Costo por categoría / centro de costo | `Attribute spend to teams and cost centers, with budgets that alert before month end.` |
| 4 | Compromisos | `Reservation and Savings Plan coverage, utilization and expiry in one place.` |
| 5 | Scorecard / madurez FinOps | `Measure your FinOps practice against the framework capabilities.` |

Los captions describen la captura en vez de repetir el eslogan: Microsoft los
lee en certificación y el comprador los usa para entender qué está viendo.

**Sacar las capturas con datos de demo, no de un cliente.** La plataforma tiene
modo demo justamente para esto. Una captura con nombres de suscripciones o
recursos reales de un cliente es una filtración publicada en el Marketplace.

### Videos (opcional)

Hasta 4, hospedados afuera (YouTube o Vimeo). No es obligatorio y no bloquea la
certificación. Si se hace uno, 2 a 3 minutos y que muestre el circuito completo:
conectar una suscripción, ver el costo, recibir una anomalía con dueño.

---

## Lo que este formulario NO cubre

`Offer listing` es sólo la vidriera. Para publicar hacen falta además:

- **Technical configuration** — landing page URL, webhook y los IDs de la App
  Registration. Está en `docs/marketplace-publicacion-checklist.md` §4.4.
- **Plan overview** — los planes con los IDs exactos que mapea
  `src/lib/marketplace/planMapping.ts`.
- **Preview audience** — el tenant con el que se hace la compra de prueba.
- **Properties** — categorías e industrias.
