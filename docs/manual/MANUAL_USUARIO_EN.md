<div class="cover">
<img src="../../public/CSCloudSolutions.png" alt="CSCloudSolutions" class="cover-logo" width="360" />
<h1 class="cover-title">User Manual</h1>
<p class="cover-sub">FinOps SaaS · CSCloudSolutions</p>
<p class="cover-meta">Version 2.0 · August 2026</p>
<p class="cover-copyright">© 2026 CSCloudSolutions. All rights reserved.</p>
</div>

# 📘 User Manual — FinOps SaaS (CSCloudSolutions)

**Version:** 2.0 (detailed)
**Language:** English
**Last updated:** August 2026
**Audience:** technical users (Cloud Admin, DevOps, FinOps Analyst) and non-technical users (finance, management, product owners)

---

## Recent updates (August 2026)

- **New Azure Integration Services (iPaaS) module:** the hub `Intelligence → Azure Integration Services` is now available with tabs for Logic Apps, APIM, Service Bus, Event Grid, Event Hubs, and ADF.
- **Enterprise Connectors in Logic Apps:** a dedicated section now separates Standard vs Enterprise connectors and their operational/cost impact.
- **Enterprise AI (Azure IA):** global AI configuration now supports **endpoint URL** + deployment for Azure IA instead of relying only on resource name.
- **FinOps/CMP table standard (SaaS):** all standardized tables now include base filters (**Resource, Region, Type, Resource Group**), sorting (A-Z/Z-A/cost), **15/30/45/60** pagination, responsive full-width layout, and resizable columns.
- **Monitoring and Security aligned:** Monitoring and Security views now follow the same visual and operational pattern as Databases and Compute for faster FinOps decision-making.
- **AI Cost Analytics fixes:** Microsoft Foundry/Azure OpenAI analytics now prioritizes real consumption, keeps MTD trend from day 1, and fixes cache/source inconsistencies.
- **New Security prewarm cron:** `GET /api/cron/prewarm-security-finops` now prewarms Defender + Security families for faster load in staging and production.
- **Database Intelligence hardening:** Redis, MySQL, PostgreSQL, Cosmos DB, MongoDB, and SQL/Managed Instance now expose status and metrics with per-metric fallback, avoiding `N/A/unknown` when Azure telemetry is partial.
- **FinOps visual refresh:** key cards in Intelligence, Consumption, Governance, Cleanup, Overview, and Copilot M365 now use Tabler icons and no blue icon backgrounds for cleaner scanning.

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

---

## 1. Getting Started

### 1.1. Access and login

The platform is a B2B SaaS. Authentication is integrated with **Microsoft Entra ID** (Azure Active Directory):

1. Go to the platform URL.
2. Click **"Sign in with Microsoft"**.
3. Authenticate with your corporate account. The platform automatically recognizes your Azure tenant and identity.
4. **Demo Mode:** if you want to try the platform without connecting your real environment, choose one of the preconfigured demo profiles from the main screen — they come with realistic simulated data and metrics, so you can explore every module risk-free. Demo credentials are `demo` / `demo`.

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
| Professional (platform floor) | Reader, Cost Management Reader, Monitoring Reader, Billing Reader | — |
| Business | Professional + Tag Contributor | VM Start/Stop/Restart/Deallocate + tags |
| Enterprise | Business + Tag Contributor | Business + delete disk/snapshot/NIC/Public IP/NSG |

> ⚠️ **The 4 base Professional roles are the absolute minimum** for the Real Consumption page to show data. If `Cost Management Reader` or `Billing Reader` is missing, Azure silently returns 0 rows.

> ℹ️ **AI Cost Analytics (Microsoft Foundry / Azure OpenAI)** uses the same base roles (`Reader`, `Cost Management Reader`, `Monitoring Reader`, `Billing Reader`): **no extra role is required**.

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

### 1.4. Operational note

Commercial and partner-association management (PAL/CPOR) is handled internally by CSCloudSolutions and does not require tenant end-user actions.

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

Your executive landing panel. It combines Current MTD Cost, forecast, Zombie Resources, Potential Savings and Environmental Impact with budgets, dominant services, governance, Advisor and Quick Wins.

**How to use it:**
1. Review the synchronization bar and use **Refresh** to bypass the cache and query the current cycle.
2. Compare MTD spend against cost-center budgets and adjust the 12-month forecast growth rate.
3. Pin/unpin widgets with the pin icon to add them to **My Dashboard**.
4. Under **Top Quick Wins**, choose **Optimize** to open the remediation modal with CLI, PowerShell and Terraform scripts.

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

### 4.3.1. Azure AI Document Intelligence

Under `Financial Intelligence → Azure AI → Document Intelligence`, review MTD cost, processed pages, Prebuilt/Custom usage and training hours. Select MTD/30D/90D, filter the table by model, Resource Group or subscription, and open **Optimize** to evaluate Commitment Tier, F0 or Custom→Prebuilt migration. A real tenant without accounts shows an empty state and never demo data.

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

### 5.1. Real Consumption (`/intelligence/billing`, Professional+)

The real-time, detailed billing dashboard, straight from Azure.

**How to use it:**
1. Filter by period, subscription, and resource group.
2. Zoom into a specific service to see its breakdown.
3. Download the invoice or export data to Excel from the corresponding button.
4. Create threshold alerts from the same page (takes you to the Self-Service Alerts form with context pre-filled).

### 5.2. Budgets (`/intelligence/budgets`, Professional+)

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
| **Compute FinOps Cockpits (VMs, VMSS, App Services, Function Apps)** | Business/Enterprise | Granular optimization and governance modules: **Virtual Machines** (`/intelligence/computo/avm`) with active compute vs. persistent storage cost separation (deallocated waste detection), AHUB licensing, B-series rightsizing, 8x5 schedules, and abandoned VM disposal; **Function Apps** (`/intelligence/computo/fapps`) with invocation telemetry, GB-seconds, log audits, and sampling/downgrade playbooks; **App Services** (`/intelligence/computo/waas`) with app density and packing; and **VMSS** (`/intelligence/computo/vmss`) with autoscale and Spot instances. |
| **Anomaly Detection** | Enterprise | Automatically identifies abnormal spending spikes or drops and lets you create alerts by adjusting sensitivity. |
| **Optimization Index (COIN)** | Enterprise | Composite 0-100 score, comparable against industry benchmarks. |
| **Compute Efficiency** | Enterprise | Real CPU/memory/disk utilization per VM, with resize recommendation and calculated savings. |
| **Rate Optimization** | Enterprise | Compares your current rates against market benchmarks to prepare a negotiation with Microsoft. |
| **Zero Cost** | Everyone | Which resources are free in your subscription (free tier, credits) to maximize their use. |
| **Allocation** | Enterprise | Rules for distributing shared costs across multiple areas (by real usage, proportional, or fixed). |
| **MACC Tracking** | Enterprise | Tracking of the minimum annual commitment (EA/MCA) — consumed vs. committed, with compliance projection. |
| **AI Cost Analytics** | Enterprise | Cost per AI model and token consumption in Microsoft Foundry / Azure OpenAI, with call optimization recommendations. |
| **Databases** | Business | Visibility, real-time metrics, and performance diagnostics for CosmosDB, Azure SQL, PostgreSQL, MySQL, MongoDB, and Redis. Includes the special **acfr** tab for detailed monitoring of 12 critical Azure Cache for Redis metrics via area charts with average aggregation. |

---

## 6. Cloud Cleanup Section

### 6.1. Zombie Resources (`/cleanup/zombies`, Professional+; remediation Business+)

Detects orphaned resources generating unnecessary spend: unattached disks, unused public IPs, empty App Service Plans, VMs disconnected for 30+ days.

**Usage flow:**
1. List with filter by resource type.
2. Review each resource's last recorded use.
3. Optional: take a snapshot of the resource before touching anything (in case you need to recover it later).
4. **Delete** — requires Business+ role and Azure deletion permissions (see the script's role table in section 1.3).
5. You can create an **auto-cleanup policy** so zombie resources of a certain type get flagged or deleted automatically going forward.

### 6.2. Networking Zombies (`/cleanup/zombies/networking`, Professional+; remediation Business+)

Same as above but focused on network resources: empty Load Balancers, unassociated NSGs, orphaned Public IPs, VPN gateways with no active connections.

### 6.3. TTL Expirations (Business+)

Control of ephemeral environments (sandboxes, test environments) with an expiration date.

1. Create a TTL policy: what resource type, how many days of life.
2. Tag affected resources with the expiration date (manually or automatically by rule).
3. The system alerts you before automatic deletion.
4. Check the history of what was deleted and when.

---

## 7. Governance Section

### 7.1. Tag Governance — Azure Tag Governance Engine (`/governance/tags`, Professional+)

Comprehensive audit, AI suggestion, and metadata propagation panel in Azure.

**Key capabilities:**
- **Dual Compliance Audit:** Dedicated views to audit both **Individual Resources** and **Resource Groups (RGs)**.
- **4 Mandatory Policies:** Real-time compliance tracking for the 4 core FinOps tags:
  - `Environment` (prod, staging, dev, qa, test, sandbox)
  - `Role` (architectural or operational role)
  - `CostCenter` (accounting cost centre)
  - `Department` (owning business unit)
- **AI-Powered Tag Suggestions (1-click):** Engine analyzing resource type, name conventions, and subscription context to draft recommended missing tags instantly.
- **Bulk RG Tag Inheritance (Safe Merge):** Propagate tags from the parent Resource Group to child resources without overwriting or deleting pre-existing tags.
- **Optimistic Editing & Local Cache:** In-line editing with immediate persistence in local cache and asynchronous background sync to Azure Resource Manager.
- **CMP Table Standard & Customization:** Resizable column headers (`col-resize`, 100px - 600px), column visibility popover in `z-[100]`, and automatic tenant persistence in `localStorage`.

### 7.2. Governance Reporting (`/governance/reporting`, Enterprise+)

Unified executive dashboard. At its centre sits the **Financial Security Score**, a 0-100 index weighing four
pillars: Azure Policy compliance (40%), mandatory tag hygiene (30%), RBAC assignment hygiene (20%) and zombie
resource control (10%).

**When a pillar cannot be measured** —because the Service Principal lacks permissions, or because no policies
are assigned— it counts as neither 0 nor 100: it is flagged "not measurable" and its weight is redistributed
across the rest. "View pillar breakdown" shows each pillar's nominal and effective weight.

**What else you get:**
- Azure Policy compliance with an expandable detail of non-compliant resources.
- Resource inventory by type and by region, with everything outside the top grouped under "Other" so the bars
  add up to the headline total.
- RBAC assignments by principal type, including an **orphaned SID audit**: assignments whose user or
  application no longer exists in the directory. They grant nobody access today, but if Azure reuses that
  identifier the permission comes back to life on a different principal.
- Export to **executive PDF** and to **CSV** with the full dataset.

### 7.3. Virtual Machine Control — Power Schedules (`/governance/power`, Business+)

Automated VM start/stop routines outside business hours, plus live manual control.

**Two scheduling modes:**
- **One-time:** runs the action (start / stop / restart) once, at an exact date and time.
- **Recurring:** you pick the time and the weekdays. A "from–to" window is built from two rules: one to start
  and one to stop, over the same days.

**Smart Shutdown.** Before every scheduled shutdown the system checks the VM's actual CPU over the last 30
minutes. If it sits above the threshold (5% by default, adjustable), it **postpones the shutdown** and records
it as skipped rather than taking down a machine that is working. Tune the threshold with "Calibrate
Threshold": too high shuts down machines mid-job, too low lets OS background noise cancel every shutdown and
the savings never materialise.

**Off-hours savings.** The first KPI shows the monthly spend you already recover through active schedules, and
how much more is available on running VMs with no schedule. The calculation uses each VM's real window —from
its shutdown to its next start— rather than a constant: a weekend with no scheduled start extends Friday's
shutdown all the way to Monday.

**Live control.** The lower table lists every VM with its state, size, current CPU and spend. Select several
and apply Stop / Start / Restart in bulk. The state badge changes immediately while Azure processes the
operation, and corrects itself if something fails or if Smart Shutdown skipped the shutdown.

**Operational details:**
- The time zone is stored as an IANA name, so a schedule keeps firing at the correct local time across
  daylight-saving changes.
- The system checks pending schedules every few minutes, plus an immediate check on save.
- If Azure Monitor returns no metrics for a VM, the CPU column shows **"n/a"** instead of 0%: a zero would
  read as "idle" and could lead you to shut down a machine with no telemetry.

### 7.4. High Availability Recommendations (`/governance/ha`, Business+)

Detects virtual machines, databases and cloud resources without zonal or geographic redundancy, or without
backup.

**Every gap tells you the SLA you have today and the one you would reach**, translated into minutes of monthly
downtime — because "99.9%" means nothing until you turn it into 43.2 minutes a month, and 99.99% into 4.3.
The "View Architecture" drawer shows the topology, the SLA comparison and the estimated additional cost before
you decide.

**What is detected:** VMs with no zone or Availability Set, resources with no backup, databases without a
failover group or geo-redundancy, single-instance App Service Plans, and Basic SKU public IPs.

**About Basic IPs:** they show an SLA of 0, not 99.9. Microsoft publishes no SLA for that SKU — it is not that
it is low, it is that there is none.

**About backups:** a backup does not improve availability, it improves RPO (how much data you lose if
something breaks). That is why current and projected SLA match on those rows: we do not promise an improvement
that does not happen.

**What can be remediated from here:** only the public IP SKU upgrade and attaching a backup policy, both
idempotent Azure operations. Spreading across zones or enabling geo-redundancy requires recreating the
resource or choosing a secondary region — for those, "Remediate" hands you the change blueprint with the exact
command so your infrastructure team can plan it.

**Exemptions.** If a non-production workload does not warrant redundancy, exempt it with a justification. It
stops counting towards the KPIs but stays visible under the history button, and the justification is recorded
against your user — somebody will have to defend it at the next audit.

### 7.5. Expiring Credentials — Entra ID (`/governance/credentials`, Business+)

Inventory of App Registration and Service Principal secrets and certificates, across two tabs.

**Credentials tab.** Each row shows the status —**Healthy** (more than 30 days), **Expiring Soon** (30 days or
fewer) or **Expired**—, the expiry date, the exact days remaining and the App ID with a copy button. Days are
recalculated on every query: a credential moves from healthy to expiring without anyone touching it.

**Secret rotation.** The "Rotate" button generates a new secret through Microsoft Graph with the validity you
choose (6, 12 or 24 months).

> **Important:** rotation **does not revoke the previous secret**, and that is deliberate. Revoking in the same
> step would take down everything still using it — precisely the incident this module prevents. The correct
> order is: rotate, migrate the consumers to the new secret, and only then delete the old one from the Entra ID
> portal.
>
> The secret value **is shown only once**. Microsoft Graph never returns it again and the platform stores it
> nowhere. Copy it there and then, and keep it in Azure Key Vault.

Certificates are not rotated here: they are renewed by uploading the public key, a different procedure.

**Configured Alerts tab.** Advance-warning rules. Each rule accepts **several thresholds** (60, 30 and 7 days,
for example), and each one fires an independent notice — a single reminder at 7 days rarely leaves enough time
to coordinate a rotation across every consuming team. Pick the channels (Email, Teams, Slack, Webhook) and the
recipients, and enable or disable each rule with a switch.

### 7.6. Auto-Block Policies (`/governance/policies`, Enterprise+)

Cost prevention at provisioning time through Azure Policy: constraints that stop unwanted spend from coming
into existence.

**What you see:** your environment's overall compliance, the breakdown by resource category, the status of each
governance initiative, and the table of active policies with their effect (`Deny`, `Modify`, `Audit`,
`DeployIfNotExists`), their scope and how many resources each one is breaching.

Everything comes from live Azure Policy. **If your environment has no policies assigned you will see 0
evaluations** and a message explaining why — not an estimated percentage.

**Deploying a policy.** The wizard lets you pick the scope (management group or subscription) and one of the
predefined templates: restrict VM sizes, block public IPs in sandbox, inherit tags, require CostCenter,
restrict regions, or audit storage without HTTPS. Each template explains the cost it prevents.

> A `Deny` policy **blocks new deployments but does not revert what already exists**. Resources created before
> the assignment will show as non-compliant until you fix them by hand or with a `Modify` policy. Azure takes
> up to 30 minutes to complete the first evaluation.

**Remediate.** The remediation button creates an Azure Policy task that fixes existing resources. It only
appears on `Modify` and `DeployIfNotExists` policies: those are the only effects Azure can apply
retroactively. It is not offered on `Deny` or `Audit`, where the task would finish with zero resources fixed.

**View non-compliant resources** opens a side panel with each breach and its reason.

### 7.7. Remediation Approvals (`/governance/approvals`, Business+)

Control flow over the infrastructure changes proposed by the optimisation engines. It runs on the
**four-eyes principle**: whoever requests a change cannot approve it.

**Pending requests.** Each card shows the resource, the proposed action, who requested it, the monthly savings
it releases and any relevant warnings — whether the VM will reboot, whether the action is irreversible.

**Approving executes the change in Azure immediately.** It is not a status change in a list: the platform calls
Azure Resource Manager and the real outcome lands in the history. If Azure rejects the operation, the request
shows as **Failed** with the literal error, not as approved.

**Safety controls:**
- **Pre-deletion snapshot.** When deleting a disk you can request a backup snapshot. If the snapshot fails the
  deletion **does not run**: you asked for a safety net, and without it the action does not proceed.
- **"Approve everything safe"** only covers non-destructive actions that do not restart a service. Deleting a
  disk or resizing a production VM requires a conscious decision, not a bulk click.
- **Rejecting requires a reason**, which is sent to the requester. Without one, the same request comes back
  next week.

**Decision history.** Full audit trail: who resolved it, when, what Azure replied and —if one was created— the
backup snapshot identifier. The "Released Savings" KPI counts **only what Azure confirmed**: an approval that
failed released nothing and is not counted.


---

## 8. Administration Section

### 8.1. Support (`/support`, all plans from Professional)

Any tenant user can open tickets to CSCloudSolutions and follow the conversation within the platform.

**How to create a ticket:**
1. Fill in subject, category (Technical / Billing / Inquiry / Feature Request), priority, and initial message.
2. You can attach screenshots or files (`jpg`, `jpeg`, `png`, `txt`, `json`; max 5 MB per file, 10 per ticket) — kept for 60 days and then auto-deleted.
3. Support team replies appear marked with 🛟 in the thread. You can reply while it's open, and close/reopen it yourself.
4. **Quick access:** the lifebuoy icon next to your username in the header opens Support from any page. When your ticket gets a reply, you'll see a notification in the bell 🔔.

**Quotas by plan:**

| Plan | Tickets/month | First-response SLA |
|---|---|---|
| Professional | 20 | 24 h |
| Business | Unlimited | 8 h |
| Enterprise | Unlimited | 4 h |

**What you see on screen:**

- **Four indicators at the top:** open tickets (including those waiting on your reply), in progress,
  resolved, and your plan's first-response SLA.
- **Troubleshooting:** a collapsible section with FAQs and a search box. Many questions are answered
  here without opening a ticket.
- **Your ticket table** with number, subject, category, priority, status, last update and **SLA
  remaining** as a live countdown. Drag the right edge of any header to resize the column, pick which
  columns to show with *Customize columns*, and page 15 at a time (or 30/45/60). Those preferences are
  saved in your browser.
- **Conversation in a side panel:** *View conversation* opens the thread on the right without losing the
  table. You can attach several files at once by dragging them; images show an expandable preview in the
  thread and logs download.

**About SLA remaining:** the counter measures the time until the team's **first response**. Once we
reply it stops, even if the ticket stays open. If the ticket is waiting on your reply it does not run
either — the ball is on your side.

**Affected module (optional):** when creating the ticket you can state which module it concerns
(Defender, Zombie resources, Cost allocation, Alerts, Power schedules, Tag governance). It is not
required, but it speeds up routing to the right team.

### 8.2. Users and Permissions (`/admin/users`)

See section 2 for details on role vs. permissions. From here you add users, edit their role, adjust their
module scope, or remove their access. Only tenant Admins and Owners can open this screen.

**Four indicators at the top:** registered users (and how many your plan allows), admins and owners,
readers, and your team's **2FA compliance**.

**Adding a user — no more copying GUIDs.** Type the person's name or email: the platform searches your
Entra ID directory and shows the matches. Pick one and the *Entra ID (OID)* field fills in by itself,
marked with a green check. Then choose the base role and the page scope (*Full module access*,
*Visibility & FinOps only*, or *Cleanup & Governance only*).

Suggestions flag people who are **already added** to the tenant and accounts that are **disabled** in
Entra ID.

**Sync from Entra ID** opens a panel with two ways to onboard in bulk:

1. **By users:** the directory listing, with multi-select and a role per person.
2. **By security group:** pick a group (for example `FinOps-Engineers`) and a default role, and all its
   members are provisioned at once. The **Owner role cannot be assigned by group**: ownership transfer
   is done user by user, deliberately. If the group has more members than your plan allows, the excess
   is skipped and reported.

**The user table** shows the name with initials, email, the abbreviated OID with a copy button, the role
(editable in one click from the cell), page scope, 2FA status and last sign-in. Like every other table:
resizable columns, a visible-columns selector, 15/30/45/60 paging, and preferences saved in your browser.

**2FA status — three values, not two:**

| Badge | What it means |
|---|---|
| **2FA active** | The person has a second factor registered in Entra ID. |
| **Pending** | Entra ID confirmed they have **no** second factor registered. |
| **No data** | Entra ID has not answered for that user yet. It does **not** mean 2FA is missing. |

The compliance indicator is computed only over users whose status is known, and it tells you how many
have no data. If the platform lacks the Graph permission to read the authentication-methods report, the
column shows "No data" for everyone — not 0% compliance. The *Refresh 2FA* button queries Entra ID again
whenever you need it.

**Granular permissions** (the *Permissions* button on each row) opens a side panel with one switch per
module: Visibility, Financial intelligence, Cloud cleanup, Governance, Security, and Administration &
support. Turning a module off removes it from that user's menu **and** blocks access if they try to
reach it by typing the URL. Below that you can restrict which Azure subscriptions they can see: with
none selected, they see every subscription in the tenant.

### 8.3. Configuration (`/admin/config`)

General tenant profile administration: name, logo, default language for new users, timezone for reports, billing cycle.

### 8.4. Billing — Plan Change (`/admin/billing`, Professional+, Owner role)

**Plan Limits:**
| Plan | Allowed Azure Subscriptions | Users per Tenant | Support / SLA |
|---|---|---|---|
| **Professional** | Up to 2 subscriptions | Up to 3 users | 20 tickets/mo (24 h) |
| **Business** | Up to 3 subscriptions | Up to 5 users | Priority (12 h) |
| **Enterprise** | Unlimited | Unlimited | Dedicated 24/7 (99.9% SLA) |

**Change procedure:**
1. Choose the new plan (Professional / Business / Enterprise).
2. Choose frequency (monthly/annual) and proration mode.
3. The system shows a **preview summary** with the real amount calculated by the payment gateway before confirming: *"You'll be charged $X now"* (upgrade) or *"You'll receive a $X credit"* (downgrade), the new recurring total, and the next billing date.
4. The change **only applies** when you click **Confirm change** — until then you can cancel at no cost.

#### 8.4.1. Azure Subscription Quota Enforcement & Upgrade Modal
The platform automatically verifies connected Azure subscriptions:
- **Professional:** Up to 2 Azure subscriptions.
- **Business:** Up to 3 Azure subscriptions.
- **Enterprise:** Unlimited subscriptions with multi-account support.

If you attempt to link a subscription exceeding your quota, the **Dynamic Upgrade Modal** opens automatically to seamlessly upgrade your plan via Paddle.

### 8.5. Notification Configuration (`/admin/notifications`, Professional+)

Three supported channels: **Slack**, **Microsoft Teams**, **Email (SMTP)**.

#### 8.5.1. Global Notification Center (Navbar Bell)
- **Interactive Bell:** `IconBell` icon with corporate blue badge (`#0078D4`) indicating unread notifications.
- **Dynamic Filters:** Filter by *All*, *Unread*, *Info*, *Warning*, and *Critical*.
- **Quick Actions:** *"Mark all as read"* and direct deep-links to associated anomalies, reports, or support tickets.

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
- **Strategic suggestions and information:** the Copilot provides exclusively analytical recommendations, cost optimization suggestions, and informative insights to support decision-making — it does not perform corrective actions or direct modifications on your infrastructure.

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

### 11.9. Infrastructure and data residency

- **Active physical region:** Azure West US 2.
- **Production Redis:** Azure Managed Redis with HA enabled.
- **Edge/CDN:** Cloudflare is used in front of the Azure origin.

---

## 12. Best Practices

- **Weekly review:** check the **Dashboard** and **Zombie Resources** at least once a week to catch financial leaks before they pile up.
- **Automate early:** enable **Power Schedules** on your Development/Testing environments as a first step — it's common to see 60% savings in idle compute hours with no other change.
- **Enforce tag compliance:** without consistent tags, the chargeback/showback module can't fairly distribute the monthly bill across teams — it's the foundation everything else relies on.
- **Use the What-If Simulator before committing:** before purchasing a Reservation or Savings Plan, simulate the scenario and save it — it gives you a concrete number to justify the decision to finance.
- **Set up at least one notification channel from day one** (Slack/Teams if your team already lives there, or email if you prefer simplicity) — budget alerts are useless if nobody sees them in time.

---

## Support and Contact

For any additional assistance, open a ticket from **Support** (`/support`) within the platform, or write to **soporte@cscloudsolutions.com.ar**.

---

**User Manual — FinOps SaaS**
**Version 2.0 | English | July 2026**
