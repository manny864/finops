<div class="cover">
<img src="../../public/CSCloudSolutions.png" alt="CSCloudSolutions" class="cover-logo" width="360" />
<h1 class="cover-title">User Manual</h1>
<p class="cover-sub">FinOps SaaS · CSCloudSolutions</p>
<p class="cover-meta">Version 2.0 · July 2026</p>
<p class="cover-copyright">© 2026 CSCloudSolutions. All rights reserved.</p>
</div>

# 📘 User Manual — FinOps SaaS (CSCloudSolutions)

**Version:** 2.0 (detailed)
**Language:** English
**Last updated:** July 2026
**Audience:** technical users (Cloud Admin, DevOps, FinOps Analyst) and non-technical users (finance, management, product owners)

---

## How to use this manual

Each section explains **what** the feature is, **who** can use it (role and subscription tier), and the **step-by-step usage flow** — concrete buttons, URL paths, form fields, and expected results. If you're a non-technical user, feel free to jump straight to the section you need: each one is self-contained.

---

## 📑 Table of Contents

1. [Getting Started](#1-getting-started)
2. [Roles and Permissions](#2-roles-and-permissions)
3. [Main Navigation](#3-main-navigation)
4. [Visibility Section](#4-visibility-section)
5. [Financial Intelligence Section](#5-financial-intelligence-section)
6. [Cloud Cleanup Section](#6-cloud-cleanup-section)
7. [Governance Section](#7-governance-section)
8. [Administration Section](#8-administration-section)
9. [FinOps Copilot (AI Assistant)](#9-finops-copilot-ai-assistant)
10. [Account Security (MFA)](#10-account-security-mfa)
11. [Advanced Features and Integrations](#11-advanced-features-and-integrations)
12. [Best Practices](#12-best-practices)
13. [Multi-cloud: Azure and AWS](#13-multi-cloud-azure-and-aws)

---

## 1. Getting Started

### 1.1. Access and login

The platform is a B2B SaaS with **two ways to sign in**, depending on your organization's cloud provider.

**If you use Azure**, authentication is integrated with **Microsoft Entra ID** (Azure Active Directory):

1. Go to the platform URL.
2. Click **"Sign in with Microsoft"**.
3. Authenticate with your corporate account. The platform automatically recognizes your Azure tenant and identity.
4. **Demo Mode:** if you want to try the platform without connecting your real environment, choose one of the preconfigured demo profiles from the main screen — they come with realistic simulated data and metrics, so you can explore every module risk-free. The demo form lets you pick **whether you want to see the platform with Azure or AWS data**: each cloud shows its own services, regions and recommendations (for example, Savings Plans and Reserved Instances on AWS instead of Azure Reservations). Figures are scaled to the same level in both clouds, so you can compare them directly. Demo credentials are `demo` / `demo`.

**If you use AWS**, your organization does not sign in through Microsoft: you log in with **email and password** from the same login form. See [section 13](#13-multi-cloud-azure-and-aws) for details.

### 1.2. The onboarding wizard (first time)

If you're an administrator and this is your organization's first time using the platform, upon login the **Setup Wizard** (`/onboarding`) automatically opens — a 5-step linear wizard with a progress bar:

| Step | What you do | Result |
|---|---|---|
| **1. Welcome & Company Info** | Confirm company name, primary cloud provider (Azure), display currency (USD/EUR/GBP), and timezone | Your initial preferences are saved |
| **2. Connect Azure Subscription** | Paste **Client ID**, **Client Secret**, and **Azure Tenant ID** from the Service Principal (generated with the PowerShell script provided by CSCloudSolutions) and click **"Validate"** | The system checks live whether the Service Principal has the minimum required roles; if any is missing, it shows exactly which one in red |
| **3. Run First Data Sync** | Click **"Run Sync"** | Fetches your first set of cost data from Azure (can take up to 60 seconds) |
| **4. Create Your First Budget** | Fill in name, monthly limit ($), and alert threshold (%) | Your first active budget is created |
| **5. Set Up Notifications** | Click **"Configure"** (opens `/admin/notifications` in a new tab) | Add at least one channel (email, Slack, or Teams) to receive alerts |

You can **skip** any step and return later — the wizard keeps appearing until you complete or skip all 5. Progress (%) is calculated as `(completed + skipped) / 5 × 100`. If you prefer the advanced setup form instead of the wizard, `/admin/onboarding` remains available in parallel.

### 1.3. Verifying your Azure connection

When you connect your Azure subscription (step 2 of the onboarding wizard, or from `/admin/onboarding`), the Service Principal needs certain Azure roles assigned so the platform can read your cost data. This section helps you verify and troubleshoot that connection.

**Azure roles required, by contracted tier:**

| Tier | Built-in roles | Custom role |
|---|---|---|
| Essential | Reader, Cost Management Reader, Monitoring Reader, Billing Reader | — |
| Professional | Essential + Tag Contributor | — |
| Business | Professional + Tag Contributor | VM Start/Stop/Restart/Deallocate + tags |
| Enterprise | Business + Tag Contributor | Business + delete disk/snapshot/NIC/Public IP/NSG |

> ⚠️ **The 4 Essential roles are the absolute minimum** for the Real Consumption page to show data. If `Cost Management Reader` or `Billing Reader` is missing, Azure silently returns 0 rows.

> ⚠️ **EA/MCA subscriptions** (Enterprise Agreement / Microsoft Customer Agreement) additionally require the customer's Billing Admin to assign `Enrollment Reader` or `Billing Account Reader` to the Service Principal at the billing account scope — the script can't do this automatically, it must be coordinated with the customer.

**Verifying permissions were correctly assigned**, after the customer runs the script:

- **Quick option (recommended):** `GET /api/admin/check-sp-roles?tenantId=<tenant-id>` — returns how many subscriptions have all required roles ✅, which are partial ⚠️, and which have none ❌, with the exact detail of what's missing in each.
- **Manual option:** in Azure Portal → Subscription → **Access control (IAM)** → **Role assignments** → filter by the App Registration `CSCloudSolutions-FinOps-Agent` and confirm the tier's roles appear.

**Troubleshooting — "Real Consumption shows no data":**

| Error message | Cause | Fix |
|---|---|---|
| `NO_COST_PERMISSION` | Missing `Cost Management Reader` | Assign the role to the SP on that subscription |
| `NO_SUBSCRIPTION_ACCESS` | Missing `Reader` | Assign `Reader` or re-run the script |
| `SUBSCRIPTION_INACTIVE` | The subscription has no spend in the current month or the last 30 days | Verify it's the correct subscription |
| `NO_SUBSCRIPTIONS` | The SP sees no subscriptions | Assign `Reader` on at least one |
| `NO_CONSUMPTION` | Everything OK but no spend in the current cycle | Wait for the billing cycle to close or check another subscription |

---

## 2. Roles and Permissions

The platform separates **two independent concepts** that combine but don't replace each other:

### 2.1. Role (what you can DO)

| Role | Capability |
|---|---|
| **Owner** | Tenant owner. Full access, including plan changes and billing. |
| **Admin** | Complete financial visibility, configuration changes, corrective actions (shutting down VMs, deleting resources). |
| **Colaborador (Collaborator)** | Sees financial intelligence and visibility; can suggest changes but doesn't manage billing or users. |
| **Reader** | Read-only in dashboards and reports. Cannot apply changes or view sensitive configuration. |

### 2.2. Domain permissions (which pages you SEE)

Beyond the role, each user can be assigned one or more **domain permissions**, which determine which sidebar sections they see — independent of their role:

| Permission | Who benefits | What it enables to view |
|---|---|---|
| **FinOps** | FinOps Analyst | Cost and recommendation pages |
| **CloudAdmin** | Cloud Administrator | Infrastructure execution/write pages |
| **Security** | Security Auditor | Compliance auditing, credentials, governance |
| **ProductOwner** | Project/product lead | Visibility by Cost Center or application |

**How they combine:** a user with the **Reader** role and the **FinOps** permission can *view* FinOps pages, but can't modify or delete anything in them — the role still governs actions. Permission filtering is opt-in: if a user has no permission assigned, they see everything their role and tier allow (default behavior, no domain restriction). **Admin/Owner** roles always see everything their tier allows, regardless of assigned permissions. The **Dashboard** (`/`) and **Support** (`/support`) are always visible to everyone.

**How to assign permissions:** go to `/admin/users` → select the user → toggle the permission switches in the table, or assign them when manually creating a new user. (Note: users bulk-imported from Entra ID have no permissions assigned by default — assign them afterward from the main table.)

> ⚠️ Domain permissions **do not** enable write actions on the backend — that remains exclusively controlled by the role. A user with the `CloudAdmin` permission but `Reader` role can *view* those pages, but any write action will return a 403 error if their role doesn't authorize it.

---

## 3. Main Navigation

The left sidebar groups everything into 5 pillars (collapsible sections — the active page's section auto-expands):

- **Visibility** — dashboards, academy, FinOps maturity
- **Financial Intelligence** — billing, budgets, optimization
- **Cloud Cleanup** — zombie resources, TTL
- **Governance** — tags, policies, approvals
- **Administration** — users, configuration, billing, API

A **search bar** at the top of the sidebar lets you find pages by name or content without manually navigating categories.

### 3.1. "History" button — time evolution of any metric

On Dashboard, Commitment Discounts, Rightsizing, Anomalies, Budgets, and High Availability you'll find a **History** button in the top right corner. When opened:

1. Choose a date range (up to **1 year back**).
2. See the daily evolution of that page's metrics as a **line chart** and **table**.

The platform automatically saves a daily snapshot of every page (retention ~13 months) — you don't need to enable anything, it's already running in the background.

### 3.2. Your profile

Click your **avatar** (circle with your initial, top right) to open:

- **Full name** — editable via the pencil icon.
- **Email and role** within the tenant (read-only).
- **Display currency** — currency selector.
- **Appearance** — Light / Dark / Automatic (follows the OS theme).
- **Sign out.**

---

## 4. Visibility Section

### 4.1. Dashboard (White Board)

Your executive landing panel. Summarizes Total Potential Savings, detected Zombie Resources, and Governance rating at a glance.

**How to use it:**
1. Select the period at the top (current month, last 3/12 months).
2. Filter by subscription if you have several connected.
3. Pin/unpin cards for what you want to always keep at hand (pin icon on each card).
4. Any card locked by your current tier appears blurred — click it to see an upgrade modal with the detail of what it unlocks.

### 4.2. Costs and Projection (`/intelligence/cost-projection`, Professional+ tier)

Combines two tools in one page:

- **Cost Histogram:** daily spending distribution, with a range selector from the last month up to **13 months back** (everything Azure Cost Management allows querying), cached in Redis for instant response.
- **Cost Projection:** calculate how much you'll spend in the future.
  1. The system takes the monthly average of the last 12 months as a base.
  2. You enter an **expected annual growth %** (negative values allowed to simulate an optimization/savings scenario).
  3. Choose the horizon: 3, 6, 12, or 24 months.
  4. The result shows: base average, equivalent monthly rate, and projected total, with a real vs. projected line chart.

There's a summary card of this on the Dashboard with a **"See full detail"** link.

### 4.3. Azure Advisor

Direct sync with Microsoft's native recommendations, classified into Cost, Security, and Operational Excellence. Recommendations display in the language you have active on the platform (not Azure's original language).

**How to use it:** filter by category, review each recommendation's potential savings impact, and apply it directly from the platform or dismiss it with a justification if it doesn't apply to your case.

### 4.4. FinOps Maturity

Interactive assessment that places your organization at Crawl / Walk / Run across 5 pillars (visibility, optimization, governance, intelligence, operations). Answer the questionnaire to get a score per pillar plus a personalized improvement roadmap.

### 4.5. FinOps Academy

Interactive learning center on FinOps and Azure cost optimization — structured courses, videos, glossary, and downloadable resources.

> ⚠️ **Mandatory gate:** new users must complete the Academy before accessing the rest of the platform (with a disclaimer explaining why). Progress is tracked **per user**, not per organization — every new person on the tenant has to complete it, and once completed it can't be re-run.

### 4.6-4.10. Historical Progress, TOP Expenses, Resources, Green FinOps, Captured Savings, Financial Leaks (Professional/Business+)

- **Historical Progress:** monthly trend charts, savings milestones reached, month-over-month and year-over-year comparisons. You can add manual annotations explaining a change (e.g., "migrated to reservations").
- **TOP Expenses:** ranking of your largest spending sources by service, subscription, or resource group, with drilldown to individual resource level.
- **Resources** (Business+): complete inventory — advanced filtering and search, bulk tagging, export.
- **Green FinOps** (Professional+): carbon footprint estimate by service, comparison of most efficient regions, sustainability recommendations.
- **Captured Savings** (Professional+): tracking of real savings already achieved via RIs, Savings Plans, and Hybrid Benefit, with ROI calculation.
- **Financial Leaks** (Professional+): identifies wasted money (abandoned resources, over-sizing, unnecessary redundancy) with a remediation calendar.

---

## 5. Financial Intelligence Section

### 5.1. Real Consumption (`/intelligence/billing`, Essential+)

The real-time, detailed billing dashboard, straight from Azure.

**How to use it:**
1. Filter by period, subscription, and resource group.
2. Zoom into a specific service to see its breakdown.
3. Download the invoice or export data to Excel from the corresponding button.
4. Create threshold alerts from the same page (takes you to the Self-Service Alerts form with context pre-filled).

### 5.2. Budgets (`/intelligence/budgets`, Essential+)

1. **Create a budget:** name, period (monthly/quarterly/annual), limit in $.
2. **Alert threshold:** define at what % of the budget you want to be notified (e.g., 75%).
3. The system tracks automatically — see real consumption vs. budget in real time, with history of previous periods.

### 5.3. Cost Groups (`/intelligence/cost-groups`, Business+)

Custom cost grouping according to your own business logic (by project, line of business, application, or environment).

1. Create a group with naming rules (what resources belong, by name pattern or tag).
2. Manually assign resources if adjustment is needed.
3. Clicking a group opens a modal with tabs: **Costs**, **Actions**, **Resources**, **Governance** — each with detail specific to that group.
4. Compare groups against each other from the list view.

### 5.4. Active Reservations — Commitment Discounts (`/intelligence/commitments`, Enterprise+)

Besides overall coverage and utilization, the **Active Reservations** table replicates Azure's *Reservations* blade: Name, Status, Expiration, Scope, Type, Product, Region, Renewal, Quantity, and last-day and last-7-day utilization.

- Click the **Renewal** button → modal to **enable/disable auto-renewal** for that reservation. The change applies directly in Azure — requires tenant Admin/Owner role **and** `Reservations Contributor/Owner` permissions in Azure.
- Click any **utilization percentage** → modal with last-day / 7-day / 30-day detail and daily trend.

### 5.5. Savings Plan vs Reservation (`/intelligence/commitment-simulator`, Professional+)

Simulate both purchase options with your real numbers and compare 1-year and 3-year savings before committing.

### 5.6. What-If Simulator (`/intelligence/simulator`, Enterprise tier for save/compare)

Simulate the impact of scaling compute/storage, varying network traffic, or enabling Azure Hybrid Benefit on your current cost — **before applying the real change**.

**Full flow:**
1. Move the sliders: compute scale, storage scale, network traffic increase %, enable/disable AHB.
2. Click **"Run Simulation"** — see the breakdown: base cost, projected cost, delta, and % change.
3. **Save the scenario:** click **"Save current"** → give it a name and optional notes. The scenario is frozen with those numbers (it won't recalculate later even if your real base cost changes over time — this lets you compare saved scenarios from different moments consistently).
4. Repeat 2-3 times with different sliders to have several saved scenarios.
5. **Compare:** check 2 to 4 scenarios with the checkboxes → click **"Compare"** → a side-by-side modal opens with each scenario as a card, marking which is the baseline.
6. **Export:** choose the format (CSV, PDF, or Markdown) next to the download buttons — you can export a single scenario, all saved ones, or the full comparison with each one's delta against the baseline.
7. **Delete:** trash icon on each row (only the creator or an Admin/Owner can delete it).

> The assumed cost mix is Azure-first: 60% of cost is compute, 25% storage, 15% network; AHB applies a flat 18% discount on the total if enabled.

### 5.7-5.29. Other Financial Intelligence modules

| Module | Tier | What it's for and how to use it |
|---|---|---|
| **Cost Center Budget** | Enterprise | Define cost centers, assign resources (manual or bulk), and the system automatically allocates spending to generate internal departmental chargeback. |
| **Network Analysis** | Business | Bandwidth, gateway, load balancer, and public IP costs; identifies transfer spikes and idle IPs to decommission. |
| **Hybrid Benefit (AHB)** | Business | Shows which VMs could use Software Assurance licenses and how much you'd save by enabling it; tracks what's already using it. |
| **AKS Control** | Enterprise | Active nodes, real utilization vs. over-provisioning, cost per pod, auto-scaling recommendations. |
| **AKS Chargeback** | Enterprise | Assign namespaces to teams and the system calculates how much each team spends on the cluster, for internal billing. |
| **Container Apps** | Business | Azure Container Apps cost control: monthly cost per app, environment, CPU/memory and replicas. Detects *scale-to-zero* opportunities (apps with a minimum replica ≥ 1 that could shut down when idle) and estimates the potential savings. Also available as a White Board card. |
| **Log Analytics** | Business | Log Analytics Workspaces cost control: monthly cost, retention and estimated ingestion per workspace. Detects unnecessary bulk ingestion (workspaces without a daily cap), excessive retention and *Commitment Tier* opportunities, with estimated potential savings. Also available as a White Board card. |
| **Unit Economics** | Enterprise | Define your own unit metric (cost per transaction, per user, per MB processed) and the system automatically calculates unit cost from your Azure data. |
| **Users and Licenses** (merged with "Licenses") | Professional | 3 tabs: **Dashboard** (M365/Entra ID KPIs), **User Activity** (filterable table), **License Optimization** (resources without Hybrid Benefit via Resource Graph + per-SKU metrics via Microsoft Graph). |
| **CSV Ingestion** | Business | Upload a CSV with third-party billing under the FOCUS standard to analyze alongside your Azure data. |
| **Self-Service Alerts** | Business/Professional | Create budget or anomaly alert rules yourself, without asking support — condition + notification channel. |
| **Scorecard** | Business | 0-100 score of your financial health with individual indicators (savings, reserve coverage, efficiency); you can set targets. |
| **Tenant Health** | Business | Overall status — detected issues, billing consistency, reservation coverage, policy compliance. |
| **Rightsizing** (+ VMSS/App Service/SQL/Storage verticals) | Enterprise | Analyzes 30 days of real usage and recommends the optimal SKU; shows estimated savings before approving the change. Dedicated verticals at `/intelligence/rightsizing/{vmss,appservice,sqldb,storage}`. |
| **Storage Efficiency** | Business | Simulates the savings from moving blobs between Hot/Cool/Archive tiers before applying it. |
| **Compute $/Core** | Professional | Cost-per-vCPU breakdown to compare VM families against each other. |
| **Anomaly Detection** | Enterprise | Automatically identifies abnormal spending spikes or drops and lets you create alerts by adjusting sensitivity. |
| **Optimization Index (COIN)** | Enterprise | Composite 0-100 score, comparable against industry benchmarks. |
| **Compute Efficiency** | Enterprise | Real CPU/memory/disk utilization per VM, with resize recommendation and calculated savings. |
| **Rate Optimization** | Enterprise | Compares your current rates against market benchmarks to prepare a negotiation with Microsoft. |
| **Zero Cost** | Everyone | Which resources are free in your subscription (free tier, credits) to maximize their use. |
| **Allocation** | Enterprise | Rules for distributing shared costs across multiple areas (by real usage, proportional, or fixed). |
| **MACC Tracking** | Enterprise | Tracking of the minimum annual commitment (EA/MCA) — consumed vs. committed, with compliance projection. |
| **AI Cost Analytics** | Enterprise | Cost per AI model and token consumption in Azure OpenAI, with call optimization recommendations. |

---

## 6. Cloud Cleanup Section

### 6.1. Zombie Resources (`/cleanup/zombies`, Essential+; remediation Business+)

Detects orphaned resources generating unnecessary spend: unattached disks, unused public IPs, empty App Service Plans, VMs disconnected for 30+ days.

**Usage flow:**
1. List with filter by resource type.
2. Review each resource's last recorded use.
3. Optional: take a snapshot of the resource before touching anything (in case you need to recover it later).
4. **Delete** — requires Business+ role and Azure deletion permissions (see the script's role table in section 1.3).
5. You can create an **auto-cleanup policy** so zombie resources of a certain type get flagged or deleted automatically going forward.

### 6.2. Networking Zombies (`/cleanup/zombies/networking`, Essential+; remediation Business+)

Same as above but focused on network resources: empty Load Balancers, unassociated NSGs, orphaned Public IPs, VPN gateways with no active connections.

### 6.3. TTL Expirations (Business+)

Control of ephemeral environments (sandboxes, test environments) with an expiration date.

1. Create a TTL policy: what resource type, how many days of life.
2. Tag affected resources with the expiration date (manually or automatically by rule).
3. The system alerts you before automatic deletion.
4. Check the history of what was deleted and when.

---

## 7. Governance Section

### 7.1. Tag Compliance (`/governance/tags`, Essential+; remediation Business+)

1. Define your organization's mandatory tags (e.g., `CostCenter`, `Owner`, `Environment`).
2. The system audits your entire infrastructure and shows you which resources lack them.
3. With **auto-tagging** (Business+) you can automatically apply missing tags based on rules.
4. Generate compliance reports to show internal audit.

### 7.2. Governance Reporting (`/governance/reporting`, Enterprise+)

Unified executive dashboard: overall compliance status, security and tagging findings, prioritized recommendations, and historical evolution. (This page merges what used to be a separate "Governance Status" page as an additional section within the same report.)

### 7.3. Power Schedules (`/governance/power`, Business+)

Automated VM power on/off routines outside productive hours.

**Two modes:**
- **Single date:** executes the action (power on/off/restart) **once** at the exact date and time.
- **Recurring (range):** define a **"From–To"** time range and the days of the week (e.g., Mon-Fri 08:00-20:00). The system automatically creates a power-on schedule at the "From" time and a power-off schedule at the "To" time, with the same days.

**Important operational details:**
- The timezone is auto-detected from your browser when you open the form — you can change it manually if you need a different one.
- The system checks pending schedules every **2 minutes**, plus an immediate check when you save. The VM action can take an additional 20-40 seconds to confirm against Azure.

### 7.4. High Availability (`/governance/ha`, Business+)

Detects production VMs without an assigned Availability Zone or Availability Set — single point of failure risk.

### 7.5. Expiring Credentials (`/governance/credentials`, Business+)

Proactive alert for App Registrations / Service Principals whose secrets or certificates expire in 30/60/90 days. Each credential shows status: **Expired**, **Expiring soon** (≤30 days), or **Enabled**.

**How to create an alert:**
1. **"Create expiration alert"** button.
2. Define how many days in advance you want the notice (1-365).
3. Choose the channel: email, Slack, or Teams (via webhook).
4. The system evaluates daily and sends **at most one notification per day** while there are credentials within the threshold (including already-expired ones).

These rules can also be managed from **Self-Service Alerts**, under the "Credential expiration" type.

### 7.6. Auto-Block Policies (Enterprise+)

Automatic policies that block actions before they happen: creating VMs above a certain size, creating resources without a mandatory tag, exceeding a maximum daily spend per subscription, or creating resources outside an allowed schedule.

### 7.7. Approvals (Business+)

Approval flow for infrastructure changes: a user requests the change, a specialist reviews and approves/rejects with comments, and everything is audited (who approved what and when).

---

## 8. Administration Section

### 8.1. Support (`/support`, all plans from Essential)

Any tenant user can open tickets to CSCloudSolutions and follow the conversation within the platform.

**How to create a ticket:**
1. Fill in subject, category (Technical / Billing / Inquiry / Feature Request), priority, and initial message.
2. You can attach screenshots or files (`jpg`, `jpeg`, `png`, `txt`, `json`; max 5 MB per file, 10 per ticket) — kept for 60 days and then auto-deleted.
3. Support team replies appear marked with 🛟 in the thread. You can reply while it's open, and close/reopen it yourself.
4. **Quick access:** the lifebuoy icon next to your username in the header opens Support from any page. When your ticket gets a reply, you'll see a notification in the bell 🔔.

**Quotas by plan:**

| Plan | Tickets/month | First-response SLA |
|---|---|---|
| Essential | 5 | 48 h |
| Professional | 20 | 24 h |
| Business | Unlimited | 8 h |
| Enterprise | Unlimited | 4 h |

### 8.2. Users and Permissions (`/admin/users`)

See section 2 for details on role vs. permissions. From here you add users, edit their role, toggle their domain permissions, or fully deactivate them.

### 8.3. Configuration (`/admin/config`)

General tenant profile administration: name, logo, default language for new users, timezone for reports, billing cycle.

### 8.4. Billing — Plan Change (`/admin/billing`, Essential+, Owner role)

1. Choose the new plan (Essential / Professional / Business / Enterprise).
2. Choose frequency (monthly/annual) and proration mode.
3. The system shows a **preview summary** with the real amount calculated by the payment gateway before confirming: *"You'll be charged $X now"* (upgrade) or *"You'll receive a $X credit"* (downgrade), the new recurring total, and the next billing date.
4. The change **only applies** when you click **Confirm change** — until then you can cancel at no cost.

### 8.5. Notification Configuration (`/admin/notifications`, Professional+)

Three supported channels: **Slack**, **Microsoft Teams**, **Email (SMTP)**.

**Configure Slack:**
1. Go to `https://api.slack.com/apps` → create or select an app → **Incoming Webhooks**.
2. **"Add New Webhook to Workspace"** → choose the destination channel.
3. Copy the webhook URL (starts with `https://hooks.slack.com/services/...`).
4. In the platform: **Notifications** → **Add Channel** → **Slack** → paste the URL → save.

**Configure Microsoft Teams:**
1. In the Teams channel → **⋯** → **Connectors** → search for "Incoming Webhook".
2. Configure the webhook and give it a name.
3. Copy the generated URL.
4. In the platform: **Notifications** → **Add Channel** → **Microsoft Teams** → paste the URL → save.

**Configure Email:**
- Uses SMTP. If your organization doesn't specify its own server, the platform's default SMTP configuration is used.
- You can define multiple recipients and, optionally, override host/port/user/password per channel.

**Severity filter:** each channel can filter what it receives — `info`, `warning`, `error`, or combinations (e.g., `warning,error` to skip informational messages).

**Test the channel:** a test button on each configured channel — sends a test notification before you rely on it in production.

**Tier availability:** Professional allows 2+ channels; Enterprise allows unlimited channels + per-channel SMTP overrides.

**If notifications aren't arriving**, check in this order: channel enabled (`enabled = true`) → severity filter matches the alert level → you tested the channel from the UI → there's at least one channel configured for the tenant. The send log (with errors) is available for diagnosis.

### 8.6. Executive Report (Business+)

Automated generation of high-level periodic reports, designed for presenting to leadership — downloadable executive summary.

### 8.7-8.17. Other Administration modules

| Module | Tier | Usage |
|---|---|---|
| **Azure Lighthouse Onboarding** | Enterprise | Generation of ARM template for cross-tenant delegation, at `/admin/onboarding/lighthouse`. |
| **AI Configuration** | Professional | Enable/disable AI features, choose model, adjust detection sensitivity and what data is shared. |
| **Invoicing Report** | Enterprise | JSON/CSV/PBIT stub export with detail by billing profile, invoice section, and customer, at `/admin/report`. |
| **Workbooks** | Enterprise | Custom reports: own layout, charts, data tables, exportable to PDF and shareable via link. |
| **Audit Trail** | Professional | Complete log of who changed what and when, filterable by user/action/date, exportable for compliance. |
| **MCP API Keys** | Enterprise | API keys for MCP-style integrations — generate, rotate, and revoke. |
| **Public API** | Enterprise | Documented REST API (OpenAPI/Swagger), with rate limits and usage monitoring. |
| **Power BI Templates** | Enterprise | Downloadable `.pbit` templates, pre-connected to your SaaS data. |
| **FOCUS 1.1 Export** | Professional | Export your data in the standard FOCUS format, schedulable for automatic daily generation. |
| **SSO SAML** | Enterprise | Configure your Identity Provider, map attributes (roles, emails), test, and activate for the whole organization. |
| **Partner Markup (CSP)** | Enterprise | Configurable margins per service for CSP partners, automatically applied in billing. |
| **M365 Copilot** | Enterprise | Tenant configuration + assisted chat over your own FinOps data, at `/admin/copilot-m365`. |

---

## 9. FinOps Copilot (AI Assistant)

Floating icon in the bottom corner of the screen, available on Professional+.

- **Automatic context awareness:** the Copilot reads the content of the page you're on — you don't need to tell it which module you're in. When you open it, without typing anything, it generates an **executive report** of what's being shown: module context, key findings, savings opportunities prioritized by impact, risks, and a 7-day action plan.
- **Targeted questions:** besides the automatic report, you can ask it directly. E.g., in Budgets: *"Summarize the current state of our budgets"*.
- **Corrective actions:** with your prior authorization, it can guide you through deleting zombie resources or applying missing tags via automated scripts — it never executes anything without your confirmation.

---

## 10. Account Security (MFA)

TOTP-based two-factor authentication (Google Authenticator, Microsoft Authenticator, Authy, etc.), optional per user, required only for **sensitive operations** (deleting a tenant, canceling a subscription, changing billing configuration).

**How to enable it:**
1. Go to your profile → **Security Settings** → **"Enable 2FA"**.
2. The system shows you a QR code — scan it with your authenticator app.
3. Enter the 6-digit code shown by the app to confirm.
4. You receive **10 recovery codes** — download and store them somewhere safe. They're shown only once.

**When it's requested:** when you attempt an operation marked as sensitive, a modal appears asking for your 6-digit code (or a recovery code if you've lost access to the authenticator). Each recovery code is single-use; if you use up all 10, you must disable and re-enable 2FA to generate a new set.

**If you lose access to your authenticator:** use any of your 10 recovery codes to log in and reconfigure 2FA from scratch. If you've also lost the recovery codes, an Admin can force-disable your MFA (logged in the audit trail).

---

## 11. Advanced Features and Integrations

This section is for technical users (Cloud Admin, DevOps) who need to integrate the platform with other tools or configure advanced access.

### 11.1. SSO SAML (`/admin/sso`, Enterprise, via WorkOS)

Lets Enterprise customer users log in with their own Identity Provider (Okta, Auth0, AD FS) instead of — or alongside — Microsoft Entra ID.

**Configuration per customer:**
1. Go to **Admin → SSO SAML** (only visible on Enterprise tier).
2. Get the `workos_org_id` and `workos_connection_id` from the WorkOS dashboard (CSCloudSolutions creates the Organization/Connection there if they don't exist).
3. Fill in the form: **Domain** (e.g., `acme.com`), **WorkOS Organization ID**, **WorkOS Connection ID** → enable the **Enable SSO** toggle → save.
4. **"Generate Admin Portal"** button → opens a WorkOS link in a new tab; the customer's IT admin receives an email to configure their own IdP.
5. (Optional) **"Test SSO"** button → redirects you to the IdP to validate the login works before announcing it to end users.

**How the end user logs in:** on the login screen, they choose "Login with SSO" instead of "Sign in with Microsoft" → the system redirects them to their own IdP → after authenticating, they're automatically returned to the dashboard.

> ⚠️ Only **one IdP connection per tenant** is supported by current design. SSO coexists with Microsoft Entra ID login (MSAL) without replacing it — both methods work simultaneously, so you don't lose existing access when enabling SSO. The SSO session lasts 12 hours.

**Common errors:** "SSO not configured" (platform credentials missing), "SSO not enabled for this tenant" (the toggle is off), "Missing workos_connection_id" (the portal hasn't been generated yet, or the customer hasn't configured their IdP).

### 11.2. Audit Trail — advanced usage (`/admin/audit`, Professional+)

Beyond the filterable log (by email, action type, status, and date range, 10 rows per page), you have 4 export formats: **CSV (current page)**, **Full filtered CSV (streaming)**, **JSON**, **NDJSON**.

**Typical use cases:**
- **Compliance audit (SOC2):** export the full quarterly range with the filtered export button.
- **Investigate an incident:** filter by the suspicious user's email + `FAILURE` status.
- **Operational monitoring:** filter by action type `DELETE` + a recent date range to see what was deleted.

> ⚠️ The full export has a **100,000-row cap** — for larger datasets, narrow the date range and export in parts. Log retention is currently indefinite (no automatic purge yet).

### 11.3. Public REST API v1 (`/admin/api-keys`, Enterprise)

Read-only programmatic access to your data (costs, budgets, recommendations, anomalies) to connect BI tools or your own scripts.

**How to generate and use it:**
1. **Admin → Public API** → generate a new key, choosing only the **scopes** you need (`read:cost`, `read:resources`, `read:budgets`, `read:recommendations`, `read:anomalies`) — request the minimum necessary, e.g., `read:cost` if it's only to feed a BI dashboard.
2. Authenticate each request with the header `X-API-Key: pak_live_xxx` (or `Authorization: Bearer pak_live_xxx`).
3. Example endpoints: `GET /cost/summary?from=...&to=...&groupBy=service`, `GET /cost/timeseries?granularity=daily|monthly`, `GET /resources?type=...&limit=100`, `GET /budgets`, `GET /recommendations`, `GET /anomalies?severity=low|medium|high`.
4. Interactive documentation (Swagger) available at `/api/v1/docs`.

> ⚠️ Default limit: **60 requests/minute** per key (`X-RateLimit-*` headers show your remaining quota; hitting the limit returns a 429 error). If you need more for a batch job, request it from Admin → Public API or via support (up to 1000 req/min). Monetary values always travel as **strings** (e.g., `"1234.56"`), not numbers — parse them as text to avoid losing precision.

### 11.4. Showback/Chargeback PDF Export (`/admin/report`, Business+)

Generate and email showback/chargeback invoices to each customer or internal cost center.

- **Download a single invoice:** from the billing report, select the customer/center and period → the PDF downloads directly.
- **Download all at once:** same flow without selecting a specific customer → a ZIP with all the period's invoices downloads.
- **Send via email:** fill in the recipient's email and name → it's automatically sent with the PDF attached via Microsoft 365 (requires CSCloudSolutions to have email sending configured for your tenant — if unavailable you'll see a clear error asking you to contact support).

Every send and download is logged in the audit trail.

### 11.5. FOCUS 1.1 Export — advanced usage

Beyond manual download from `/admin/focus-export` (see section 8.7), you can automate extraction with your own MCP API Key (generated at `/admin/mcp-keys`):

```
curl -H "Authorization: Bearer mcp_xxx" \
  ".../api/exports/focus?tenantId=...&format=ndjson"
```

Available formats: CSV, JSON, NDJSON. Cap of **500,000 rows** per export (default 100,000). Useful for automatically feeding external FinOps tools (Power BI, CloudHealth, etc.) without manual intervention.

### 11.6. Status Page

A public page (no login required) where you and your users can check at any time whether the platform is operational: `/es/status` (or `/en/status`, `/status`). Shows the status of API, database, Azure sync, AI provider, and billing, plus an incident history. Useful to share with your team if something seems broken — before opening a ticket, check whether an incident is already reported there.

### 11.7. Paddle Billing — technical detail

The plan change (see section 8.4) has 3 possible proration modes when upgrading/downgrading:

- **Immediate proration:** the difference is charged or credited right now.
- **Next-cycle proration:** the full price change is charged only at the next renewal.
- **No immediate charge:** the plan change applies without generating any charge until the next cycle.

From `/admin/billing` you also access the **payment management portal** (update card) and the **downloadable invoice history**.

### 11.8. 7-day free trial (self-service)

If you signed up yourself from the pricing page (not through an onboarding assisted by the CSCloudSolutions team), your account starts with a **7-day trial** on the plan you chose. You'll see a trial status banner at the top of the platform:

- 🔵 Blue: 5 or more days remaining.
- 🟡 Yellow: between 3 and 4 days remaining.
- 🔴 Red: 2 days or fewer — this one can't be dismissed.

You can upgrade to a paid plan at any time from **Billing** — the trial immediately converts to an active subscription. If the trial expires without an upgrade, the account switches to limited access until you activate a paid plan.

---

## 12. Best Practices

- **Weekly review:** check the **Dashboard** and **Zombie Resources** at least once a week to catch financial leaks before they pile up.
- **Automate early:** enable **Power Schedules** on your Development/Testing environments as a first step — it's common to see 60% savings in idle compute hours with no other change.
- **Enforce tag compliance:** without consistent tags, the chargeback/showback module can't fairly distribute the monthly bill across teams — it's the foundation everything else relies on.
- **Use the What-If Simulator before committing:** before purchasing a Reservation or Savings Plan, simulate the scenario and save it — it gives you a concrete number to justify the decision to finance.
- **Set up at least one notification channel from day one** (Slack/Teams if your team already lives there, or email if you prefer simplicity) — budget alerts are useless if nobody sees them in time.

---

## 13. Multi-cloud: Azure and AWS

The platform supports **two cloud providers**: Microsoft Azure and Amazon Web Services. Plans and pricing are **identical** for both — the only difference is how you create the account and what data is collected.

### 13.1. Choosing your provider at signup

On the plans page (`/signup`) you first choose **which cloud you want to analyze**:

| Provider | How the account is created |
|---|---|
| **Microsoft Azure** | You sign in with your Microsoft account. The platform recognizes your Entra ID tenant automatically. |
| **Amazon Web Services** | AWS has no corporate sign-in equivalent to Entra ID, so you create an account with **email and password**. You receive an email to verify your address. |

> **Why the difference:** IAM Identity Center is *your own organization's* SSO, not a global directory we can query, and "Login with Amazon" is consumer identity (shopping accounts). There is no enterprise "sign in with AWS". That is why the AWS path uses platform-native credentials.

### 13.2. Signing in

The login screen offers both options:

- **Sign in with Microsoft** — for Azure tenants.
- **Email and password** — for AWS tenants. Below the form you have **"Forgot your password?"**, which sends you a time-limited recovery link.

If your administrator invited you, you will receive an email with a link to **choose your password** and get in. Invited users always start with the **Reader** role; your administrator can widen it later from **Users and Permissions**.

### 13.3. Using both providers at once (Enterprise only)

The **Enterprise** plan is the only one that can have Azure and AWS connected in the same account. When that is your case, an **AWS/Azure switch appears in the top bar**: changing it makes the sidebar and the pages show that provider's data.

If you only have one provider the switch is not rendered — there would be nothing to choose.

> **Important:** the sidebar changes with the active provider. Many pages are Azure-specific (AKS, Hybrid Benefit, Azure Policies, Defender for Cloud, and so on) and do not appear while AWS is active. This is intentional: we would rather not show you a page that cannot work with your data.

### 13.4. Connecting your AWS account

From **Administration → Cloud Accounts** you register each AWS account you want
to monitor. Onboarding has two steps:

1. **Enter the account details**: the 12-digit ID, the ARN of the role you are
   about to create, and an alias to recognize it. If you have a **CUR** (Cost &
   Usage Report) configured, also provide its bucket, prefix and report name —
   with CUR you get per-resource detail; without it we use Cost Explorer, which
   gives detail per service and region.
2. **Create the role in your AWS account** using the template we show you. Pick
   whichever format you normally use: **CloudFormation**, **Terraform** or **AWS
   CLI** commands. The *Copy* button puts it on your clipboard.

Once done, use **Test connection** to confirm the role works without waiting for
the first sync.

#### Why the template asks for so few permissions

The template grants **only four actions**, and the S3 permissions are scoped
exclusively to the bucket holding your CUR:

| Permission | What we use it for |
|---|---|
| `sts:AssumeRole` | Assume the role you created, so you never hand us permanent keys |
| `ce:GetCostAndUsage` | Read your daily costs by service and region |
| `ec2:DescribeInstances` | See your instance inventory for recommendations |
| `s3:GetObject`, `s3:ListBucket` | Read your CUR files, **in that bucket only** |

We do not ask for broad managed policies such as `AmazonS3ReadOnlyAccess`, which
would grant read access to **every** bucket in your account when we only need
one. If your security team reviews the role, they will find exactly these four
actions and nothing else.

#### The ExternalId

When you register the account we generate an **ExternalId**: a secret value
included in the role's trust condition that prevents the *confused deputy*
attack — someone guessing your role ARN and getting us to assume it on their
behalf. The template already includes it; if you lose the screen, you can
regenerate it from the same account without deleting and recreating it.

### 13.5. What happens to your data if you downgrade

If you are on Enterprise with **both providers** and you move to a lower plan, you lose the multi-cloud entitlement. **Nothing is deleted at that moment.** What happens is:

1. **One provider is retained and the other is archived.** If you do not choose, we automatically retain the one where you spend the most (and, on a tie, the one with more connected accounts).
2. **The archived provider becomes read-only for 90 days.** You can still browse it and **export everything** from `/admin/focus-export` — the export stays enabled for the whole window even if your new plan does not include it, because your data is yours.
3. **We notify you** by email and by in-app notification **30 days and 7 days before** deletion.
4. **Only when the 90 days expire** is that provider's data permanently deleted.

While the window is open you will see a **banner at the top** with the remaining days and three ways out:

- **Export data** — takes you to the FOCUS exporter.
- **Keep the other provider instead** — flips the choice (Admin/Owner only). Note: **flipping does not reset the countdown**; the deletion date stays the same.
- **Go back to Enterprise** — if you return before the deadline, **everything is restored with no loss whatsoever**. That is exactly why the window exists.

> **Tip:** if the downgrade was accidental (a declined card, for example), you do not need to do anything other than fix the payment. Nothing is deleted until day 90.

---

## Support and Contact

For any additional assistance, open a ticket from **Support** (`/support`) within the platform, or write to **soporte@cscloudsolutions.com.ar**.

---

**User Manual — FinOps SaaS**
**Version 2.0 | English | July 2026**
