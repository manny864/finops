# Azure Marketplace - Offer Listing

## Offer Details

### Offer ID
`finops-saas-azure-offer`

### Publisher ID
`cscloudsolutions`

---

## Offer Listing

### Title
FinOps SaaS Platform · CSCloudSolutions

### Summary (max 100 chars)
Cloud cost management and FinOps automation for Azure environments.

### Description (HTML, max 3000 chars)

<h2>Optimize Your Azure Costs with FinOps SaaS Platform</h2>

<p><strong>Intelligent Cloud Cost Management for Azure</strong></p>

<p>FinOps SaaS Platform by CSCloudSolutions is a comprehensive cost management and optimization solution built specifically for organizations managing Azure infrastructure at scale.</p>

<h3>Key Features:</h3>
<ul>
  <li><strong>Real-time Cost Analysis</strong> - Monitor Azure costs across multiple subscriptions in real-time with granular visibility</li>
  <li><strong>Automated Cost Optimization</strong> - Intelligent recommendations to reduce waste and optimize resource allocation</li>
  <li><strong>Kubernetes Cost Tracking</strong> - Deep visibility into container and AKS costs with per-pod cost allocation</li>
  <li><strong>Multi-tenant Support</strong> - Manage unlimited Azure subscriptions from a single dashboard</li>
  <li><strong>Governance & Alerts</strong> - Set budget thresholds and receive intelligent alerts for cost anomalies</li>
  <li><strong>Advanced Reporting</strong> - Custom reports, cost forecasting, and trend analysis</li>
  <li><strong>API-First Architecture</strong> - Integrate with your existing tools and workflows</li>
  <li><strong>Enterprise-Grade Security</strong> - SOC 2 Type II compliance, role-based access control, and audit logging</li>
</ul>

<h3>Use Cases:</h3>
<ul>
  <li>Multi-tenant cloud providers looking to optimize customer environments</li>
  <li>Enterprises managing complex Azure infrastructure across departments</li>
  <li>DevOps and FinOps teams seeking cost visibility and governance</li>
  <li>Organizations running Kubernetes on Azure seeking container cost allocation</li>
</ul>

<h3>Support & Resources:</h3>
<ul>
  <li>24/7 Email Support</li>
  <li>Comprehensive Documentation & Knowledge Base</li>
  <li>API Documentation for developers</li>
  <li>Regular webinars and best practices guides</li>
</ul>

<p>Start optimizing your Azure costs today. Try FinOps SaaS Platform free for 14 days.</p>

### Search Keywords
- finops
- cost management
- azure cost
- kubernetes cost
- cloud optimization
- cost governance
- cloud billing
- azure administration

### Offer Categories
**Primary:** Cloud Management
**Secondary:** IT & Management Tools

### Industries
- All

### Applicable Industries
- Finance
- IT & Operations
- Manufacturing
- Energy & Utilities
- Healthcare

---

## Plan Listing

> Limits below are the ones the platform actually enforces
> (`src/lib/tierLogic.ts`: `SUBSCRIPTION_LIMITS`, `USER_LIMITS`) and the prices
> in `src/lib/pricing.ts`. Do not inflate them in Partner Center: the app
> silently truncates the subscription list at the tier limit, so a listing that
> promises more produces a customer who sees fewer subscriptions than they paid
> for and no error explaining why.

### Plan 1: Professional - $299/month

**Plan ID:** `professional-monthly`

**Description:**
For teams putting their Azure spend under control for the first time.

**Features:**
- 2 Azure subscriptions
- 3 platform users
- Cost analysis, dashboards and forecasting
- Optimization recommendations
- Kubernetes/AKS cost tracking
- Budget alerts and anomaly detection with owner assignment
- Scheduled reports
- Email support
- 12-month data retention

**Price:** $299 USD/month
**Billing Frequency:** Monthly

---

### Plan 2: Business - $999/month

**Plan ID:** `business-monthly`

**Description:**
For organizations running several environments and needing cost allocation
across teams.

**Features:**
- 3 Azure subscriptions
- 5 platform users
- 2 tenants for cost allocation
- Everything in Professional
- Zombie-resource and networking remediation from the platform
- Multi-tenant cost allocation and cost centers
- Custom dashboards and API access
- SSO / Entra ID integration
- 12-month data retention

**Price:** $999 USD/month
**Billing Frequency:** Monthly

---

### Plan 3: Enterprise - Contact Sales

**Plan ID:** `enterprise-monthly`

**Description:**
Unlimited subscriptions and users, with capacity and terms set by contract.

**Features:**
- Unlimited Azure subscriptions and users
- Everything in Business
- TTL policies and Azure Advisor Action Center
- 36-month retention and priority support included
- Dedicated account manager and quarterly reviews
- Custom SLA

**Price:** Custom
**Contact:** sales@cscloudsolutions.com.ar

> Enterprise is **not published** as a transactable plan today: its capacity is
> negotiated. If it ever is, the plan ID must be `enterprise-monthly` or
> `enterprise-annual` — those are the ones `planMapping.ts` maps explicitly.

---

### Capacity add-ons

Professional and Business can buy capacity from inside the product (Billing →
add-ons), billed by Paddle. **These are not Marketplace plans** and must not be
listed as such: a purchase made through Azure is billed by Microsoft, and the
add-ons are on the other channel.

| Add-on | Professional | Business |
|---|---|---|
| Extra Azure subscription | $50/mo | $40/mo |
| Extra tenant | $90/mo | $240/mo |
| Extra user | $30/mo | $25/mo |
| 36-month retention | $79/mo | $99/mo |
| Priority support | $149/mo | $249/mo |

---

## Privacy, Legal & Support

### Privacy Policy URL
https://finops.cscloudsolutions.com.ar/legal/privacy

### Terms of Use URL
https://finops.cscloudsolutions.com.ar/legal/terms

### Support Website URL
https://finops.cscloudsolutions.com.ar/support

### Support Email
support@cscloudsolutions.com.ar

### Support Phone
**PENDIENTE — completar antes de enviar a certificación.** `+54 11 1234-5678` es
un placeholder; Partner Center publica este número al cliente y verifica que la
oferta tenga datos de soporte reales.

---

## Lead Destination

**Lead Destination Type:** Email
**Lead Destination Email:** sales@cscloudsolutions.com.ar

---

## Plan Visibility

- **Essential:** Public
- **Professional:** Public
- **Business:** Public
- **Enterprise:** Private

---

## Media & Images

### Offer Logo (1 MB, 216x216 PNG)
File: `finops-logo-216x216.png`

### Screenshots
1. Cost Dashboard
2. Kubernetes Cost Analysis
3. Budget Alerts
4. Custom Reports

### Videos
- Product Demo: 2-3 minutes overview of key features
- Customer Testimonial: Azure cost reduction case study
