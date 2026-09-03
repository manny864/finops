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

## Plan overview — los seis planes

**El Plan ID no se puede modificar después de crear el plan**, y tiene que
coincidir exacto con la tabla de `src/lib/marketplace/planMapping.ts`. Un ID
fuera de esa tabla no falla: cae a `inferTierByKeyword()`, que busca las palabras
`enterprise` y `business` y si no encuentra ninguna devuelve **Professional**. Un
plan llamado `premium` daría acceso Professional en silencio.

### Precios y términos

| Plan ID | Plan name | Contract duration | Billing frequency | Price per charge |
|---|---|---|---|---|
| `professional-monthly` | Professional | 1-month | One-time | 299.99 |
| `professional-annual` | Professional (Annual) | 1-year | One-time | 3167.88 |
| `business-monthly` | Business | 1-month | One-time | 999.99 |
| `business-annual` | Business (Annual) | 1-year | One-time | 10559.88 |
| `enterprise-monthly` | Enterprise | 1-month | One-time | 2999.99 *(sugerido)* |
| `enterprise-annual` | Enterprise (Annual) | 1-year | One-time | 31679.88 *(sugerido)* |

Modelo de precio: **flat rate**, no per-user.

**Una duración por plan, y no más.** `azurePlanToBillingCycle()` deduce el ciclo
del **Plan ID**, no del término que eligió el comprador. Si `professional-monthly`
ofreciera además un término anual, esa compra quedaría registrada como MONTHLY.
Y el aviso de Partner Center importa: las duraciones **no se pueden quitar
después de publicar**.

`1-year` + `Per month` es otro producto: compromiso de 12 meses pagado en cuotas.
No usarlo salvo que se cree un Plan ID aparte para ese término.

**De dónde sale el precio de Enterprise.** Es la frontera donde Business +
add-ons deja de convenir: `999.99 + n × 40` llega a 2.999,99 con 50 suscripciones
extra, o sea 53 en total. Debajo, el cliente hace mejor negocio en Business
comprando capacidad; arriba, Enterprise le sale más barato. Además absorbe los
$348/mes de add-ons que Enterprise ya incluye (retención 36 meses $99 + soporte
prioritario $249). Los anuales siguen el mismo esquema que el resto: equivalente
mensual redondeado a dos decimales × 12, exacto, 12% de descuento.

### "A negociar" no existe como opción del formulario

En el Marketplace **todo plan lleva precio fijo**. No hay forma de publicar
"a convenir", así que se comunica con palabras: las dos descripciones de
Enterprise cierran con un párrafo que aclara que el número publicado es el
precio de lista para compra self-service, y que los acuerdos se arman con el
equipo comercial.

Los planes van **públicos**, no privados. Un plan privado exige al menos un
tenant ID por adelantado y no se puede publicar con la audiencia vacía: sirve
para un acuerdo ya cerrado, no para "todavía no sé quién va a comprar". Cuando
se cierre un Enterprise negociado, ahí se crea el plan privado con el tenant de
ese cliente y el precio pactado. Conviven sin problema: el público es la
vidriera, el privado es el contrato.

Se publica con precio y no sin planes Enterprise porque el anclaje vale: sin un
número arriba, Business a $999,99 parece el techo en vez del escalón medio.

### Free trial: 7 días en los tres tiers

Encender **Free trial (7 días)** en los seis planes. La página de precios anuncia
"Prueba gratuita de 7 días" en las tres tarjetas (`pricing.trial` en
`messages/*.json`), así que dejarlo apagado en Partner Center haría que un
comprador por Azure no tenga lo que la web le prometió — y esa web es la que
Microsoft enlaza desde la ficha.

### Auto activation: OFF

**Es lo que el código espera.** Con auto-activation encendido, Microsoft activa
la suscripción y empieza a facturar apenas se paga, sin que el cliente pase por
la landing page — y es la landing la que crea el tenant
(`activate/route.ts:110`). Quedaría un cliente pagando sin workspace, y
`activateSubscription()` llamándose sobre una suscripción que Microsoft ya
activó. Apagado, el circuito es el correcto: el cliente configura su cuenta,
nosotros activamos, la facturación arranca ahí. El plazo para activar es de 30
días.

### Descripciones

#### `professional-monthly` — Professional

```
For teams putting their Azure spend under control for the first time.

Includes 2 Azure subscriptions and 3 platform users.

Cost attribution by service, resource and tag from a single daily ingestion. Anomaly detection that assigns every deviation to a named owner and tracks it to resolution. Budget alerts before the month closes, optimization recommendations, Kubernetes and AKS cost tracking, storage efficiency analysis, and scheduled reports.

Read-only access to your Azure subscriptions. Nothing is deployed into them and no agent is installed.

Additional subscriptions and users can be added at any time from inside the platform.
```

#### `professional-annual` — Professional (Annual)

```
The Professional plan billed annually: same capabilities, 12% lower than paying monthly (USD 3,167.88/year versus USD 3,599.88).

Includes 2 Azure subscriptions and 3 platform users.

Cost attribution by service, resource and tag from a single daily ingestion. Anomaly detection that assigns every deviation to a named owner and tracks it to resolution. Budget alerts before the month closes, optimization recommendations, Kubernetes and AKS cost tracking, storage efficiency analysis, and scheduled reports.

Read-only access to your Azure subscriptions. Nothing is deployed into them and no agent is installed.
```

#### `business-monthly` — Business

```
For organizations running several environments that need cost allocation across teams.

Includes 3 Azure subscriptions, 5 platform users and 2 Microsoft Entra ID directories under one contract, each with its own isolated quota.

Everything in Professional, plus: cost centers and multi-tenant cost allocation, in-platform remediation of zombie and idle networking resources, power schedules for non-production compute, custom dashboards, API access, and SSO through Entra ID.

Remediation is opt-in and requires Contributor scoped only to the subscriptions you choose. Without it the platform stays read-only.

Additional subscriptions, directories and users can be added at any time from inside the platform.
```

#### `business-annual` — Business (Annual)

```
The Business plan billed annually: same capabilities, 12% lower than paying monthly (USD 10,559.88/year versus USD 11,999.88).

Includes 3 Azure subscriptions, 5 platform users and 2 Microsoft Entra ID directories under one contract, each with its own isolated quota.

Everything in Professional, plus: cost centers and multi-tenant cost allocation, in-platform remediation of zombie and idle networking resources, power schedules for non-production compute, custom dashboards, API access, and SSO through Entra ID.

Remediation is opt-in and requires Contributor scoped only to the subscriptions you choose. Without it the platform stays read-only.
```

#### `enterprise-monthly` — Enterprise

```
For organizations whose Azure estate has outgrown per-subscription licensing.

Unlimited Azure subscriptions and unlimited platform users, with 3 Microsoft Entra ID directories included and more available by agreement.

Everything in Business, plus: TTL policies that expire non-production resources automatically, the Azure Advisor Action Center that tracks every recommendation to closure, unit economics and cost-per-unit modelling, allocation across the full estate, and rate and licence optimization analysis.

Included at no extra charge: 36-month data retention and priority support, both paid add-ons on the lower plans.

Onboarding is assisted. A named account manager, quarterly business reviews and a custom SLA are part of the agreement.

Remediation and TTL enforcement are opt-in and require Contributor scoped only to the subscriptions you choose. Without them the platform stays read-only.

The price shown is the list price for self-service purchase. Enterprise agreements are usually customized: volume tiers, multi-year terms, additional Entra ID directories, custom SLAs and assisted onboarding are agreed directly with our team. Contact sales@cscloudsolutions.com.ar before purchasing if you need any of those, and we will issue a plan priced to your agreement.

Includes a 7-day free trial.
```

#### `enterprise-annual` — Enterprise (Annual)

```
The Enterprise plan billed annually: same capabilities, 12% lower than paying monthly (USD 31,679.88/year versus USD 35,999.88).

Unlimited Azure subscriptions and unlimited platform users, with 3 Microsoft Entra ID directories included and more available by agreement.

Everything in Business, plus: TTL policies that expire non-production resources automatically, the Azure Advisor Action Center that tracks every recommendation to closure, unit economics and cost-per-unit modelling, allocation across the full estate, and rate and licence optimization analysis.

Included at no extra charge: 36-month data retention and priority support, both paid add-ons on the lower plans.

Onboarding is assisted. A named account manager, quarterly business reviews and a custom SLA are part of the agreement.

Remediation and TTL enforcement are opt-in and require Contributor scoped only to the subscriptions you choose. Without them the platform stays read-only.

The price shown is the list price for self-service purchase. Enterprise agreements are usually customized: volume tiers, multi-year terms, additional Entra ID directories, custom SLAs and assisted onboarding are agreed directly with our team. Contact sales@cscloudsolutions.com.ar before purchasing if you need any of those, and we will issue a plan priced to your agreement.

Includes a 7-day free trial.
```

> **Los límites de cada descripción son los que la plataforma APLICA**
> (`SUBSCRIPTION_LIMITS` y `USER_LIMITS` en `src/lib/tierLogic.ts`; TTL y Advisor
> gateados a Enterprise en `tierLogic.ts:44-47`). Prometer más no produce un
> error visible: la app trunca la lista de suscripciones en el tope del plan y en
> silencio, y el cliente ve menos de las que pagó sin nada que se lo explique.

---

## Lo que este formulario NO cubre

`Offer listing` es sólo la vidriera. Para publicar hacen falta además:

- **Technical configuration** — landing page URL, webhook y los IDs de la App
  Registration. Está en `docs/marketplace-publicacion-checklist.md` §4.4.
- **Plan overview** — cubierto arriba.
- **Preview audience** — el tenant con el que se hace la compra de prueba.
- **Properties** — categorías e industrias.
