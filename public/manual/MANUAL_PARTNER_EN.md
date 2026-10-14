# 📘 Partner and Sales Team Manual — FinOps SaaS (CSCloudSolutions)

**Version:** 1.0
**Language:** English
**Last updated:** October 2026
**Audience:** partners and affiliates, salespeople and the pre-sales team. You do not need to know Azure or FinOps to use it: it explains what the platform is, how it works inside, what the customer sees and how to sell it.

---

## How to use this manual

This manual does two things at once: it **explains how the SaaS works** —from the point of view of the users who will use it every day— and it **gives you the aids to sell it**: discovery questions, a demo script, answers to objections, plans and prices, and how you get paid.

**If you are short on time, go straight to what you need:**

| Situation | Read |
|---|---|
| I have a meeting tomorrow | 1, 6 and 7.3 (demo script) |
| I was asked about security or about the permissions in Azure | 3.2, 3.4 and 8 |
| I want to know what each plan costs and includes | 6 |
| The customer says "we already have Azure Cost Management" | 7.4 and 7.5 |
| I want to know how much I earn and when I get paid | 9 |
| I do not understand a term | 10 (glossary) |

> **One rule for the whole manual:** sell what the platform does today. In the feature sections we clearly mark the **limits** (what it does not do yet and what depends on the plan), because a customer who was promised too much is a customer lost in month two.

---

## 📑 Table of Contents

1. [The platform in two minutes](#1-the-platform-in-two-minutes)
2. [Who you sell it to](#2-who-you-sell-it-to)
3. [How it works inside, in sales language](#3-how-it-works-inside-in-sales-language)
4. [The customer journey: from demo to value](#4-the-customer-journey-from-demo-to-value)
5. [What the user sees: a tour of the platform](#5-what-the-user-sees-a-tour-of-the-platform)
6. [Plans, prices and limits](#6-plans-prices-and-limits)
7. [How to sell](#7-how-to-sell)
8. [Frequently asked questions from customers](#8-frequently-asked-questions-from-customers)
9. [The partner program: how you earn](#9-the-partner-program-how-you-earn)
10. [Glossary](#10-glossary)
11. [Appendices](#11-appendices)

---

## 1. The platform in two minutes

### 1.1. What it is

A **FinOps SaaS platform for Microsoft Azure**. It shows a company **where its cloud spend goes**, **where it is being wasted**, and gives it **the buttons to fix it**, with approvals and an audit log of every change.

**The pain it solves is concrete and silent:** orphaned disks and IPs that keep billing, oversized machines or machines left on overnight that nobody uses, gateways with no traffic, untagged resources nobody knows the owner of, reservation commitments that all expire in the same month. Nobody looks at it… until the invoice arrives.

### 1.2. Why it beats doing it by hand

- **It does not replace Azure Cost Management: it uses it as a source** and adds what that dashboard does not do by itself —say **what to do**, **who does it** and **how much was really saved**—. (Details in 7.5.)
- **From data to action in the same place.** Every finding comes with its remediation (CLI, PowerShell or Terraform scripts and, depending on the plan, direct execution from the platform with approval).
- **Fixed, public pricing.** Unlike platforms that charge a percentage of cloud consumption, here the fee **does not rise because the customer's infrastructure grows**. They know what they pay before they sign.
- **AI Copilot in Spanish, English and Portuguese.** An assistant that reads the screen the user is on, spots savings and answers questions. It is in all three plans.
- **International standard.** **FOCUS 1.1** export, the FinOps Foundation format: useful for customers who already have their own tools or who report to a parent company.
- **The whole team, not just IT.** There is an executive view for Management, cost-by-team dashboards for Finance and technical cockpits for whoever operates the cloud.

### 1.3. The pitch, in three sizes

> **In 30 seconds.** "Your Azure bill has money going into things nobody uses. This platform connects to your Azure in read mode, shows you where that money is and gives you the buttons to recover it, with approval and audit. Fixed plan, no percentage of your consumption, and you try it free for 7 days."

> **In 2 minutes.** Add to the above: *how it connects* (a script that creates a read-only identity; the customer runs it and can revoke it whenever they want), *what each person sees* (Management an executive view; Finance budgets and cost allocation by team; Operations zombie resources, power schedules and rightsizing) and *how it pays for itself* (the Potential Savings shown on the first screen, against the plan price).

> **For a CFO.** "Predictability and allocation: you see how much each team spends, how much it will spend by month end, and you get the report by email every Monday without having to go and look for it. Spend stops being a surprise."

### 1.4. What the platform is NOT (say it yourself before the customer finds out)

- **It is Azure only.** It does not cover AWS or Google Cloud. (With *CSV Ingestion* in FOCUS format you can add third-party billing to analyze it alongside Azure, but it is not a multi-cloud dashboard.)
- **It neither asks for nor uses the Contributor role.** The ceiling of what it can execute is a narrow **custom role** (power VMs on and off, tag and, in Enterprise, delete certain orphaned resources). Whatever needs more permissions **is shown and recommended, but not executed**.
- **The AI advises, it does not execute.** The Copilot analyzes and recommends; it does not modify the customer's infrastructure.
- **It is not consulting.** It is a product. Our engineers accompany the onboarding and the technical demo, but the platform is used autonomously.
- **A single deployment region** today (Azure West US 2). Choosing a data region is not offered.

---

## 2. Who you sell it to

### 2.1. The ideal customer

An organization that **already uses Azure** and whose monthly bill justifies watching it closely: the platform pays for itself with what it finds (see 7.6). The more subscriptions, the more teams deploying on their own and the less tagging, the more value shows up from the first week.

| Size and profile | Plan that usually fits |
|---|---|
| Mid-size company that wants to **understand trends and report** | **Professional** |
| Growing company, **several environments** (development, test, production) and a need to **automate** | **Business** |
| Corporation with **complex topologies** (Hub & Spoke), many teams, a need for cost allocation and strong governance | **Enterprise** |
| **MSP or Microsoft partner** that manages its customers' cloud | **Enterprise** (Lighthouse, CSP markup, Power BI for end customers) |

### 2.2. The people who buy (and what each one cares about)

| Persona | What worries them | What to show them | A phrase that works |
|---|---|---|---|
| **CFO / Finance** | Predictability, budget, spend allocation between areas, surprises on the invoice | White Board, Budgets, Spend & Forecast, email reports, showback/chargeback | "Cloud spend stops being a month-end surprise." |
| **CTO / IT Management** | Control, risk, governance, keeping the cloud from getting messy | White Board, Governance (tags, policies, end of support), FinOps Maturity, Copilot | "An executive view and rules that prevent waste before it exists." |
| **Cloud Admin / DevOps / SRE** | Getting rid of manual work, not breaking anything | Zombie Resources, Power Schedules, Rightsizing, TTL, Shift-Left | "Every finding comes with the script and, if you want, it runs with approval." |
| **FinOps Analyst** | Reliable data, allocation, commitments | Perspectives, Unit Economics, Commitments (ESR), FOCUS, Allocation | "Everything in the FOCUS standard and with auditable allocation: the sum always adds up." |
| **Team lead / Product Owner** | "How much does mine cost and am I spending well?" | Team scope, Leaderboard, Cost Groups | "They sign in and see only their slice, not the whole company's spend." |
| **MSP / CSP partner** | Operating many customers, billing them with margin | Lighthouse, Partner Markup, billing Power BI, multi-tenant | "You connect your customer's tenant without asking for their credentials." |

### 2.3. What triggers a purchase

- The **Azure bill grew** and nobody knows why.
- **Fiscal year-end** or **budget planning** arrives and Finance asks for forecasts and allocation by area.
- There was a **recent migration to Azure** and nobody governs what was deployed.
- The **renewal of an EA/MCA** or of a commitment (MACC) approaches and the number has to be met.
- Management asks for **showback/chargeback** and there are no reliable tags.
- An **audit** or a security incident requires knowing who changed what.
- A **one-off overspend** (a test environment left on all month) put the topic on the agenda.

### 2.4. When it is NOT for them (and it is better to say so)

- **They do not use Azure** (only AWS or Google Cloud, or only on-premises): the platform is Azure.
- **Very low cloud spend**: the Professional list price is US$ 299.99 per month; if the Azure spend is very small, there is nothing to recover it from (7.6 teaches how to do the math with the customer's numbers).
- They need a tool to **execute changes with broad permissions** on their cloud: here the ceiling is a narrow role, on purpose.

---

## 3. How it works inside, in sales language

### 3.1. The model, in four steps

| Step | What happens | Who does it |
|---|---|---|
| **1. Connect** | The customer runs a **script** (generated by the platform itself) and creates a **read identity** (a *Service Principal*) with the roles that correspond to their plan. Enterprise alternative: **Azure Lighthouse**, with no credentials, but without the identity modules (Microsoft 365 and Entra ID). | The customer, with our help |
| **2. Read** | The platform brings in **costs**, **resource inventory**, **metrics**, **Azure Advisor recommendations** and identity data (expiring credentials, licenses), on a schedule. | The platform, on its own |
| **3. Analyze** | Its own engines detect waste, anomalies, missing tags, misused commitments, versions about to be retired, etc., and the AI explains them. | The platform, on its own |
| **4. Act** | Every finding comes with its **remediation**: copy-and-paste scripts and, depending on the plan, **direct execution with approval** and audit. | The customer decides; the platform executes |

### 3.2. What permissions it asks for and what it can (and cannot) do in Azure

It is the number one security question. Answer it with the table:

| Plan | Azure roles | What it can do with them |
|---|---|---|
| **Professional** | Reader, Cost Management Reader, Monitoring Reader, Billing Reader, Security Reader and, at tenant level, Reservations Reader (to see reservations) | **Read only.** It cannot modify or delete anything. |
| **Business** | Those of Professional + Tag Contributor + a **custom role** (*CSCloudSolutions Remediation Role*) | Tag; **power VMs on, off, restart and deallocate**; manage Azure budgets; and **delete orphaned resources** (VMs, disks, snapshots, App Service plans, NICs, public IPs, NSGs and the other network types Cloud Cleanup detects). |
| **Enterprise** | Those of Business + Monitoring Contributor | Business plus creating resource groups. |

Four points to reassure the customer:

1. **The Contributor or Owner role is never requested** on the subscription. Whatever needs more permissions than the custom role **is shown but not executed**.
2. **Infrastructure changes proposed by the optimization engines go through an approval flow** (four-eyes principle: whoever requests it does not approve it) and **every action is recorded in the audit log**. Before deleting a disk you can require a **backup snapshot**, and if the snapshot fails, the deletion is not carried out.
3. **The roles are management-plane roles** (costs, inventory, metrics, billing): they do not give access to the content of the customer's databases or files.
4. **The customer keeps control:** they can remove the roles or revoke the identity whenever they want, and with Lighthouse they delegate and revoke from their own directory.

In addition, the script grants **Microsoft Graph read permissions** (directory, reports, users and organization) and, depending on the plan, a few specific ones: rotating App Registration secrets (Business+, only on the apps the identity *owns*), sign-in activity for the licensing module and the Copilot M365 connector (Enterprise).

> **EA or MCA accounts** (Enterprise Agreement / Microsoft Customer Agreement): the customer's billing administrator must also assign a read role at the *billing account* level (`Enrollment Reader` or `Billing Account Reader`). The script cannot do this on its own; it has to be coordinated with the customer. It is the most common reason for an empty Consumption screen on day one.

### 3.3. Where the data comes from and how often it is updated

- **Costs:** from Azure Cost Management, synced **every night**. The platform stores history up to **13 months** back, so the 30- and 90-day ranges answer instantly and do not spend Azure query quota.
- **The current month** is queried live, with the platform's database as a fallback if Azure does not respond, and there is a **Refresh** button that bypasses the cache.
- **Inventory and recommendations:** Azure Resource Graph and Azure Advisor.
- **Usage metrics** (CPU, memory, RU, bandwidth…): Azure Monitor. If Azure does not return a metric, the screen says **"no data"** and not a zero: a zero would read as "idle" and lead someone to turn off something that may be working.
- **The first sync** brings in the first set of costs in up to a minute from the onboarding wizard.

### 3.4. Security and trust

What you can state, in the words of the platform's public **Trust Center**:

| Topic | What to say |
|---|---|
| **Encryption** | TLS 1.2 or higher in transit; AES-256 at rest for the database and backups. Keys are managed separately in **Azure Key Vault**. |
| **Access** | Sign-in with **Microsoft Entra ID**; **own 2FA with TOTP** (Google Authenticator, Microsoft Authenticator…), required for sensitive operations —deleting a tenant, canceling the subscription, changing billing—; **SAML SSO** for Enterprise (via WorkOS); control by **roles** and by **domain permissions**. |
| **Audit** | All user actions are recorded and kept for **7 years**; the log can be exported. |
| **Infrastructure** | Microsoft Azure, **West US 2 region**; managed MySQL database with automatic backups; Redis with high availability; Cloudflare in front as CDN/WAF. |
| **Continuity** | Geo-redundant backups; recovery objective **RTO under 4 hours** and **RPO under 1 hour**; **99.9% SLA** availability for paid plans (excludes scheduled maintenance). |
| **Incidents** | Security incidents are investigated within **2 hours** of detection and, for a confirmed data breach, affected customers are notified within **72 hours**. |
| **Subprocessors** | Microsoft Azure (compute, storage, networking), Paddle (payments), WorkOS (SSO) and Google Gemini (optional language models). The full list is in the Trust Center. |
| **Privacy** | Declared **GDPR** compliance; **DPA** available; the Trust Center gathers the privacy policy, the terms, the DPA, the security sheet and the subprocessor list. |

> ⚠️ **What you must NOT say.** The platform **does not have SOC 2 certification today**: it is **preparing for SOC 2 Type II, targeted for the third quarter of 2027**, and **ISO 27001 is planned for 2028**. The report that is published is a *summary of the readiness status*, not a third-party audit report. If the customer requires it as a condition, say so as it is and let us know: do not promise it.
>
> Also do not offer **data residency by region**: there is a single deployment region.

### 3.5. The AI: what it does, what it sees and who pays for it

- **FinOps Copilot.** A floating assistant, available in all three plans, that **reads the content of the screen the user is on** and generates an executive report (findings, prioritized savings, risks and a 7-day action plan), besides answering questions. It answers in the platform's language (Spanish, English or Portuguese) and **remembers the conversation** even if the user changes page.
- **It advises, it does not execute:** it does not modify the customer's infrastructure.
- **Monthly query quota:** Professional **50**, Business **150** and Enterprise **unlimited**. With the customer's **own AI key** (BYOK) there is no cap.
- **Who pays for the AI:** AI consumption with the platform's key **is absorbed by CSCloudSolutions; it is not billed to the customer** today.
- **Customer control:** a tenant Admin can **turn off the AI features**, choose whether **resource names** and **tags** are shared with the provider, and adjust the anomaly-detection sensitivity. CSCloudSolutions also has a master switch that turns the AI off for everyone in case of an incident with the provider.

---

## 4. The customer journey: from demo to value

### 4.1. The interactive demo (without connecting anything)

It is the best first step: the prospect **sees the platform working with synthetic data** and without connecting their Azure.

1. On the pricing page, each plan's **Request Demo** button opens a contact form: sales receives the request, with the **plan the prospect looked at**, and arranges the demonstration. To let the prospect see the platform right away, send the direct link `https://finops.cscloudsolutions.com.ar/demo`; the `?tier=` parameter chooses which plan to show: `professional`, `business` or `enterprise`.
2. The demo first asks for **contact details** (name, email, phone and company) with reCAPTCHA verification: it is also a way for CSCloudSolutions to record the interest.
3. Then you sign in with the user `demo` and the password `demo`.
4. A **demo mode** banner appears across the platform. Actions that modify something **are not saved** (for example, Perspectives are examples).

> 💡 Always demo the **plan that suits the customer**, not the highest one: showing Enterprise to a Professional customer creates desire for what they will not be able to use.

### 4.2. Buying and trying it free for 7 days

1. The customer picks a plan on the **pricing page** (monthly or annual; annual has a 12% discount) and the platform asks for a **work email**: free providers (Gmail, Outlook…) are not accepted. That email becomes the tenant's **administrator account**.
2. If they came in through **your referral link** (`/signup?ref=YOURCODE`), the attribution is recorded (see 9.2).
3. The **checkout** is processed by **Paddle**. It is by going through the checkout that the **7-day free trial** is activated; without going through it, the tenant has no access.
4. While the trial lasts, a banner shows the days remaining (blue, yellow at 4 days and red at 2). If the trial expires without a paid plan, the account stays on limited access until a plan is activated.

### 4.3. Onboarding: what the customer does and what we do

On first entry, the administrator sees a **5-step wizard** (it can be skipped and resumed):

| Step | What the customer does | Result |
|---|---|---|
| **1. Welcome** | Confirms the company name, the display currency and the time zone | Initial preferences |
| **2. Connect Azure** | Pastes the **Client ID**, the **Client Secret** and the **Tenant ID** of the Service Principal they created with the script, and validates | The connection is ready |
| **3. First sync** | Presses *Run sync* | Brings in their first set of costs (up to a minute) |
| **4. First budget** | Defines name, monthly limit and alert threshold | First active budget |
| **5. Notifications** | Adds a channel (email, Slack or Teams) | Receives alerts |

**What the customer has to prepare on the Azure side** (checklist in appendix B):
- A user with permissions to **run the script** and assign roles on their subscriptions.
- To know **which subscriptions** they want to monitor (the plan sets the cap: 2, 3 or unlimited).
- If they have **EA/MCA**, for the billing administrator to assign the read role at the *billing account* level.
- If they will use **Lighthouse** (Enterprise), a directory administrator who accepts the delegation.

**What we do:** we accompany the technical demo, the architecture and the onboarding. The platform also includes a **FinOps Academy** (courses, videos, glossary) that every new user goes through when starting.

### 4.4. The first 30 days: how value shows up

| When | What the customer sees | What to ask them to do |
|---|---|---|
| **Day 1** | The White Board with the month's cost, the forecast, zombie resources and the **Potential Savings** | Review the Potential Savings number: it is the return argument |
| **Week 1** | Concrete zombie and orphaned resources, with their monthly cost; Advisor recommendations; tag compliance | Remediate the first findings and **set up a notification channel** |
| **Week 2-3** | Power schedules for development and test environments, Cost Groups by team, budgets | Schedule off-hours shutdowns; assign budgets |
| **Month 1** | First executive report, anomalies with an owner, **Captured Savings** | Subscribe Management and Finance to a periodic report |

> A good practice from the user manual itself: *"it is common to see 60% savings on idle compute hours"* when scheduling shutdowns in development and test environments. Use it as orientation, not as a promise: the real saving depends on each customer.

---

## 5. What the user sees: a tour of the platform

This is the map of what the customer will use every day. For each screen: **the problem it solves**, **what the user sees** and **how to tell it**. The side menu groups everything into five pillars; almost every entry is a *hub* with tabs. The minimum plan appears on each row (**P** = Professional, **B** = Business, **E** = Enterprise; "+" means "from that plan").

> The detail of every screen, step by step, is in the **User Manual** (downloadable from the platform's help icon). This manual is the selling version.

### 5.1. Visibility — "how are we doing?"

| Screen | Problem it solves | What the user sees | How to tell it | Plan |
|---|---|---|---|---|
| **White Board** | "How is spend going this month and where is there money to recover?" | Cost of the period (current month, 30 or 90 days), forecast, zombie resources, **Potential Savings**, environmental impact, budgets, the services that weigh most and **Quick Wins** with an *Optimize* button | The screen for Management: in ten seconds they know whether there is a problem | P+ |
| **Azure Advisor** | Microsoft's recommendations are scattered and nobody follows up on them | Azure's native recommendations in your language, with estimated savings, and the ability to **snooze** or **dismiss** with a record | "What Azure already recommends, organized and followed up" | P+ |
| **FinOps Maturity** | "How well are we managing the cloud?" | Crawl / Walk / Run assessment across 6 dimensions, with a score and a roadmap; the customer chooses whether the team's self-assessment, Azure telemetry or an average wins | A Management conversation: where we are and what is next | P+ |
| **Historical Progress** | "Are we improving?" | Monthly trend, savings milestones, month-over-month and year-over-year comparisons, annotations | Proof of results for the committee | P+ |
| **TOP Expenses** | "What weighs the most?" | Ranking by service, subscription or resource group, with detail per resource | Where to focus effort | P+ |
| **Resources** | "What do I have deployed and at what cost?" | Full inventory with filters, bulk tagging and export | The inventory Azure does not give you, with cost beside it | B+ |
| **Green FinOps** | "What is the footprint of my cloud?" | Carbon estimate by service and comparison of regions | A sustainability argument | P+ |
| **Captured Savings** | "How much did we really save?" | The savings already achieved, including those made **directly in Azure**, with ROI calculation | **The proof of return** | P+ |
| **Financial Leaks** | "Where is the money leaking?" | Abandoned resources, over-sizing and redundancy, with a remediation calendar | A list of actions, not a report | P+ |
| **FinOps Academy** | "My team doesn't know FinOps" | Courses, videos and glossary; new users go through it when starting | Training included | P+ |

### 5.2. Financial Intelligence — "where is the money and what do I do?"

| Hub | Problem it solves | What the user sees | How to tell it | Plan |
|---|---|---|---|---|
| **Consumption & Budget** | Understanding real spend, budgeting it and forecasting it | Real consumption by service and resource, by category, **budgets with alerts**, **Cost Groups** by project or line of business, cost-center budget with **rollover of unspent balance**, **forecast** for 3-24 months, FOCUS CSV ingestion | "From the invoice to the budget, in one place" | P+ (advanced tabs B/E) |
| **Optimization & Savings** | Paying less for the same thing | **Rightsizing** (the optimal SKU from 30 days of real usage), **Reservations** and Savings Plans with a break-even simulator, **effective savings rate (ESR)**, a warning for reservations expiring together, **automatic notices 90, 60 and 30 days before each reservation expires**, Hybrid Benefit, zero cost, Optimization Index | "Every purchase decision with its number" | E |
| **Databases** | Databases are among the most volatile line items | Cosmos DB (with **RU/s optimizer**), SQL, PostgreSQL, MySQL, MongoDB, Redis and Fabric, with real metrics | "Where there is spare capacity and where there is a shortage" | B+ |
| **Compute** | Oversized or idle VMs, containers and serverless | VMs, App Services, Functions, **Azure Virtual Desktop** (cost per user), containers, VMSS, **Kubernetes** (with chargeback by namespace) and OpenShift | The operations team's cockpit | B+ |
| **Storage** | Accounts, disks and backups that grow without an owner | Storage Accounts, disks, backups and Data Lake, with potential savings and efficiency | "Which storage does not need to be where it is" | E |
| **Networking** | Network costs that do not show up in the cost of the resources | Network analysis, hybrid connectivity, balancing, **egress** (where the money for moving data goes) and **link capacity** (oversized ExpressRoute/VPN) | "The hidden network costs, in plain view" | B+ |
| **Users & Licenses** | Unused M365 licenses | M365 and Entra ID KPIs, user activity and license optimization | Savings on licenses, not just on Azure | E |
| **Azure AI** | AI spend grows fast and without control | Cost per model and token consumption (Foundry/OpenAI), AI Search, Document Intelligence, Speech, Vision, ML, Databricks | "AI spend, under control" | E |
| **Azure Integration Services** | Integrations (Logic Apps, APIM, Service Bus…) that cost more than expected | Operation and cost of Logic Apps, APIM, Service Bus, Event Grid, Event Hubs and Data Factory | For customers with many integrations | E |
| **Monitoring** and **Security** | Observability and security services also bill | Log Analytics, Application Insights, Sentinel, Defender, Key Vault, WAF, DDoS… with savings opportunities | "Even what it costs to watch, under control" | E |
| **Advanced Analytics** | Expert-level financial decisions | **Unit Economics** (cost per transaction or customer), shared-cost **allocation**, Scorecard, **anomaly detection**, tenant health, **What-If** simulator and **MACC** commitment tracking | What a FinOps analyst asks for | E |
| **Perspectives** | Splitting spend by team, product or environment **without depending on everything being tagged** | Ordered rules that split the cost; **the sum of the groups plus "unassigned" equals the total exactly** | "An allocation that adds up and can be audited" | E |
| **Team leaderboard** | Rewarding whoever optimizes, not whoever spends least | Ranking by **improvement**, cost-of-goods / operating-expense split (each team is classified from the table) and **gross margin** | "Gamification with judgment" | E |

### 5.3. Cloud Cleanup — "stop paying for what nobody uses"

| Screen | Problem it solves | What the user sees | Plan |
|---|---|---|---|
| **Zombie Resources** | Orphaned disks, IPs, NICs, plans and VMs that keep billing | A sweep of 25 resource types, **hard** waste (direct money) vs **soft** waste (governance), remediation with a prior snapshot | P+ (remediation B+) |
| **Networking Zombies** | Unused gateways, IPs and network endpoints | Idle VPN/ExpressRoute gateways, orphaned IPs, disconnected Private Endpoints, unused NAT and firewalls | P+ (remediation B+) |
| **TTL Expirations** | Test environments that stay alive forever | Lifetime policies, an expiration tag, an expiry traffic light and extensions | B+ |
| **Orphaned Backups** | Backups of resources that no longer exist | Detection, exact cost, safe purge and exemptions for legal compliance | P+ (remediation B+) |

### 5.4. Governance — "so it doesn't happen again"

| Screen | Problem it solves | What the user sees | Plan |
|---|---|---|---|
| **Tag Compliance** | Without tags there is no cost allocation | Audit of the 4 structural tags, **suggestions from naming conventions** for the missing ones and inheritance from the resource group | P+ (auto-fix B+) |
| **Self-Service Alerts** | Finding out about a deviation after it has happened | Rules by budget, fixed threshold, anomaly or forecast, delivered to Teams, Slack, email, webhook or ServiceNow | P+ |
| **Power Schedules** | Machines on at night and on weekends | Scheduling of power on and off with **Smart Shutdown** (it does not shut down a VM that is working) and calculated savings | B+ |
| **High Availability** | Not knowing how exposed the critical things are | Redundancy gaps, current vs achievable SLA in minutes of downtime per month | B+ |
| **End of support** | Versions Azure retires, with no budget to migrate | What runs on a version being retired, when, and **what it costs today** | B+ |
| **Expiring Credentials** | The outage from an expired secret | Inventory of Entra ID secrets and certificates, early alerts and rotation | B+ |
| **Approvals** | Changes without control | **Four-eyes** flow over the changes the engines propose, with an auditable history | B+ |
| **Auto-Block Policies** | Preventing the cost before it exists | Azure Policy with templates (restrict sizes, regions, require tags) | E |
| **Governance Reporting** | "How secure and orderly are we?" | **Financial Security Score** 0-100, policy compliance, RBAC and zombie resources | E |
| **Shift-Left FinOps** | Cost is decided when someone writes the code | The cost of a Terraform, OpenTofu or Bicep plan **inside the Pull Request**, with thresholds by amount or by budget | B+ |

### 5.5. Administration and cross-cutting

| Screen or function | What the user sees | Plan |
|---|---|---|
| **Users & Access** | User sign-up (with Entra ID search), roles, per-module permissions, 2FA, SAML SSO (E), onboarding and Lighthouse (E) | P+ |
| **Reports & Export** | **Executive report** in PDF, history, invoicing report, Workbooks, Power BI templates, **FOCUS 1.1** export and **email subscriptions** at the cadence chosen | P+ (some B/E) |
| **Integrations & API** | Public REST API, MCP keys for AI assistants, Copilot M365 | E |
| **Billing & Audit** | Plan, quotas, plan change with proration, exportable **audit trail** | P+ |
| **Marketplace** | À-la-carte modules and capacity with temporary passes | All |
| **Support** | Tickets with the team inside the platform, with SLA | P+ |
| **Mobile app (PWA)** | Summary, alerts, approvals, support and profile from the phone | All |
| **Multi-language and multi-currency** | Spanish, English and Portuguese; the user sees amounts in their currency | All |
| **Team scope** | Each owner sees **only their slice** of spend, enforced on the server; it is assigned from the users screen | E |

---

## 6. Plans, prices and limits

Prices are list prices, in **US dollars**, valid as of October 2026. **All plans start with a 7-day free trial.**

### 6.1. The three plans

| | Professional | Business | Enterprise |
|---|---|---|---|
| **Monthly price** | US$ 299.99 | US$ 999.99 | To be agreed |
| **Annual price** | US$ 3,167.88 | US$ 10,559.88 | To be agreed |
| **Savings paying annually** | 12% | 12% | — |
| **Azure subscriptions** | Up to 2 | Up to 3 | Unlimited |
| **Users** | Up to 3 | Up to 5 | Unlimited |
| **Who it is for** | Mid-size companies that need to understand trends and report | Growing companies with several environments | Corporations with complex topologies, and MSPs |

> **Business is not bought for the volume of subscriptions** (it includes 3 and costs almost 3.3 times Professional): it is paid for **capabilities** —remediation, automation, FOCUS, markup, API—. If the customer only needs more subscriptions or users, there are cheaper add-ons (6.3).

### 6.2. What each plan includes

✓ = included · — = not included

**Capacity and accounts**

| | Professional | Business | Enterprise |
|---|---|---|---|
| Azure subscriptions | Up to 2 | Up to 3 | Unlimited |
| Users | Up to 3 | Up to 5 | Unlimited |
| Multi-currency | ✓ | ✓ | ✓ |
| Multi-tenant delegations | — | ✓ | ✓ |

**Cost visibility and control**

| | Professional | Business | Enterprise |
|---|---|---|---|
| White Board (executive view) | ✓ | ✓ | ✓ |
| History, billing and budgets | ✓ | ✓ | ✓ |
| Real consumption (detailed dashboard) | ✓ | ✓ | ✓ |
| Multichannel alerts (budget, anomalies, thresholds) | ✓ | ✓ | ✓ |
| FinOps Maturity | ✓ | ✓ | ✓ |
| FOCUS 1.1 export | ✓ | ✓ | ✓ |
| Historical progress, TOP expenses, Green FinOps, captured savings, financial leaks | ✓ | ✓ | ✓ |
| Resources (inventory) and costs by category | — | ✓ | ✓ |
| Cost Groups (budget and forecast by business unit) | — | ✓ | ✓ |
| CSV ingestion | — | ✓ | ✓ |
| Executive report | — | ✓ | ✓ |
| 12-month Spend & Forecast, cost-center budget | — | — | ✓ |
| Perspectives, Leaderboard and team scope | — | — | ✓ |
| Shared-cost allocation | — | — | ✓ |

**Savings and remediation**

| | Professional | Business | Enterprise |
|---|---|---|---|
| Zombie resources and Networking zombies | Detects | Detects and remediates | Detects and remediates |
| Tag compliance and audit | Audits | Audits and fixes | Audits and fixes |
| Orphaned backups | Detects | Detects and remediates | Detects and remediates |
| Automatic VM power on/off | — | ✓ | ✓ |
| TTL expirations | — | ✓ | ✓ |
| Expiring credentials (Entra ID) | — | ✓ | ✓ |
| High availability, End of support, Shift-Left | — | ✓ | ✓ |
| Action Center (Quick Fixes with scripts) and recommendation suppression | ✓ | ✓ | ✓ |
| Remediation approvals (four-eyes flow) | — | ✓ | ✓ |
| Compute and database rightsizing | — | — | ✓ |
| Reservations, Savings Plans and break-even simulator | — | — | ✓ |
| Hybrid Benefits (AHB) | — | — | ✓ |
| Zero-cost inventory | — | — | ✓ |
| What-If simulator | — | — | ✓ |
| Storage and compute efficiency | — | — | ✓ |
| MACC tracking and burn-rate | — | — | ✓ |

**Databases, compute, networking and services (hubs)**

| | Professional | Business | Enterprise |
|---|---|---|---|
| Databases, Compute and Networking | — | ✓ | ✓ |
| Kubernetes (AKS), chargeback by namespace and Unit Economics | — | — | ✓ |
| Storage, Users & Licenses, Azure AI, Integration Services, Monitoring, Security, Advanced Analytics | — | — | ✓ |

**Artificial intelligence**

| | Professional | Business | Enterprise |
|---|---|---|---|
| FinOps Copilot (queries per month) | 50 | 150 | Unlimited |
| Anomaly detection (Z-Score) | — | — | ✓ |
| AI Cost Analytics (Azure OpenAI and Cognitive Services) | — | — | ✓ |
| Microsoft 365 Copilot costs and MCP keys | — | — | ✓ |

**Automation, governance and integrations**

| | Professional | Business | Enterprise |
|---|---|---|---|
| Full audit log | ✓ | ✓ | ✓ |
| Notifications (Slack, Teams, email, webhook) | ✓ | ✓ | ✓ |
| 2FA for sensitive operations | ✓ | ✓ | ✓ |
| Azure Key Vault (managed encryption) | ✓ | ✓ | ✓ |
| Preventive policies (Auto-Block) and Governance Reporting | — | — | ✓ |
| Azure Lighthouse (multi-tenant MSP) | — | — | ✓ |
| Billing engine for CSP partners and resale markup | — | — | ✓ |
| Power BI templates and billing Power BI | — | — | ✓ |
| Federated SSO (SAML 2.0) | — | — | ✓ |
| Public REST API | — | — | ✓ |

**Support**

| | Professional | Business | Enterprise |
|---|---|---|---|
| Tickets included | 20 per month | Unlimited | Unlimited |
| First response (SLA) | 24 h | 8 h | 4 h |
| Dedicated support | — | — | ✓ |

> **Azure Lighthouse is the heavyweight argument with MSPs.** It lets you connect a customer's tenant without asking for credentials or running scripts in their environment: the customer delegates access from their own directory and revokes it whenever they want.

> **Azure Marketplace.** Purchasing through the Azure Marketplace (useful for Enterprise customers who want to draw down their commitment with Microsoft) is technically built, but **the offer is published through a separate administrative process**. Before offering it to a customer, check its status with us. A customer billed through the Azure Marketplace also cannot buy additional modules from the platform.

### 6.3. Add-ons and the platform Marketplace

If the customer needs **a feature or a quota** their plan does not include, there is no need to jump plans. In **Administration → Marketplace** standalone add-ons are bought, with a **prorated monthly subscription** or a **temporary pass** of 1, 3, 6, 9 or 12 months (paid once and, when it expires, it switches off on its own, without touching the plan). Reference list prices, per month; the Marketplace shows the current one.

| Add-on | US$ / month |
|---|---|
| **Additional Azure subscription** | 40 |
| **Extra user seats (+5)** | 35 |
| **Additional tenant** (another Azure tenant with the same account) | 90 (Professional) · 240 (Business) |
| Commitment Simulator for RIs & Savings Plans | 49 |
| Advanced Zombies & Networking Audit | 59 |
| Executive PDF Reports | 39 |
| **Approvals** module | 39 |
| **TTL**, **Power Schedules** and **High Availability** modules | 59 each |
| **Resource Inventory**, **Expiring Credentials** and **Networking** modules | 79 each |
| **Databases** and **Compute** modules | 129 each |
| Enterprise modules (**Optimization & Savings**, **Storage**, **Users & Licenses**, **Azure AI**, **Integration Services**, **Monitoring**, **Security**, **Advanced Analytics**, **Policies & Auto-Block**, **Governance Reporting**) | 129 each |

The **additional tenant** costs approximately **30% of the base plan** (not a flat amount): a fixed amount would be 50% of the plan for Professional and 19% for Business. **Enterprise** does not use per-unit add-ons: its capacity is negotiated by contract, because a per-unit invoice makes unpredictable exactly what that buyer rejects.

### 6.4. Billing

- Charges are processed by **Paddle**; prices are confirmed there. Monthly or annual (annual has a **12%** discount).
- Changing plans shows **before confirming** the real amount calculated by the gateway ("You'll be charged $X now" or "You'll receive a $X credit"), with immediate proration, on the next cycle or with no immediate charge. Until confirmed, it can be canceled at no cost.
- The customer downloads their invoices and updates their card from **Billing**.
- The amounts the platform shows can be displayed in the **user's currency** (with an exchange rate), but **list prices are in dollars**.

### 6.5. When to recommend each plan

| If the customer… | Recommend |
|---|---|
| Wants to **understand and report** the spend of 1 or 2 subscriptions, with few users | **Professional** |
| Wants to **act** (shut down, remediate, tag), has several environments or needs to allocate costs by business unit | **Business** |
| Needs to **allocate by team with its own rules**, optimize commitments, anomalies, SSO, API, or is an **MSP** | **Enterprise** |
| Is on a plan and is missing **just one thing** | An **add-on** from the Marketplace, rather than a plan jump |

A customer can **start small and move up**: the platform tells them when something is outside their plan (with a lock and a modal that explains what it unlocks), and the plan change with proration takes a couple of clicks.

---

## 7. How to sell

### 7.1. Discovery questions

Do not sell features: **listen for the pain** and show the screen that solves it. These questions open the conversation; write down the answers, you will use them in the demo.

| Topic | Questions |
|---|---|
| **Context** | How many Azure subscriptions and tenants do you have? How do you contract: EA, MCA or CSP? Roughly how much do you spend per month and how is the trend? |
| **Visibility** | Who looks at the Azure invoice and how often? When spend deviates, how do you find out and how many days does it take? |
| **Allocation** | How do you split spend between areas or customers today: spreadsheet, tags, nothing? What percentage of resources is tagged? |
| **Waste** | What do you do with resources nobody uses? Are development and test environments shut down outside working hours? When was the last cleanup? |
| **Commitments** | Do you have Reservations or Savings Plans? When do they expire? Who decides the renewal? |
| **Control** | Who approves a change in production? Are you asked for evidence in an audit? |
| **Team** | Is there someone dedicated to FinOps or does IT do it "in spare time"? |
| **Decision** | Who decides a purchase like this? Is there a budget? Is there a date (year-end, EA renewal, planning) that sets the timing? |

**Extra questions per persona:** to the **CFO**, "How often does the cloud bill surprise you?". To the **CTO**, "How do you know that what gets deployed complies with your rules?". To the **head of operations**, "How many hours per month do you spend looking for resources with no owner?".

### 7.2. Qualification: is it worth moving forward?

| Green signals | Warning signals |
|---|---|
| They use Azure with several subscriptions or teams | Only AWS, Google Cloud or on-premises |
| The bill grew or surprises them | Very low spend, no prospect of growing |
| Little tagging and nobody owns the resources | They want a tool to execute changes with broad permissions |
| There is a date (closing, renewal) creating urgency | They demand today a SOC 2 certification or data residency by region |
| The decision-maker is in the conversation | No person with a decision or a budget in sight |

### 7.3. A 20-minute demo script

**Before:** pick the demo of the **plan that suits the customer** (`?tier=`), walk through the script once (it uses synthetic data and some write actions are not saved) and have the discovery answers at hand.

| Min | Screen | What to show | What to say |
|---|---|---|---|
| 0-2 | — | Pick up their pain in their own words | "You told me the invoice surprises you. Let's see what that looks like solved." |
| 2-5 | **White Board** | Cost for the period (switch between month, 30 and 90 days), forecast, **Potential Savings**, zombies, Quick Wins | "This is the Management view. And this number is money that can be recovered." |
| 5-9 | **Cleanup → Zombie Resources** | The 25 types, hard vs soft waste, the remediation button with a prior snapshot, and **Approvals** | "Every unused resource, with its monthly cost. And nothing is deleted without another person approving it." |
| 9-11 | **Governance → Power Schedules** | A shutdown rule and **Smart Shutdown** (it does not shut down a VM that is working) | "Turning off test environments at night and on weekends is about the most profitable thing there is." |
| 11-13 | **Governance → Tags** and **Cost Groups** | Tag suggestions from naming conventions and the allocation by business unit | "Without tags there is no fair allocation. This sorts it almost on its own." |
| 13-15 | **Consumption & Budget** and **Self-Service Alerts** | A budget with a threshold, an alert that reaches Teams or Slack | "You find out about the deviation when it happens, not when the invoice arrives." |
| 15-17 | **Copilot** | A live question about the current screen | "You ask it in your language and it analyzes what you are looking at." |
| 17-19 | **Reports** | The executive report and the **email subscriptions** | "Management and Finance get it on their own, every Monday." |
| 19-20 | **Plans** | The corresponding plan and the 7-day trial | "You try it free for 7 days. Shall we set up the onboarding this week?" |

**Variants.** *Enterprise:* add **Perspectives and Leaderboard** (the allocation that adds up, the ranking by improvement), **Reservations** with ESR and reservations expiring together, **Shift-Left** (the cost in the Pull Request) and, if it is an MSP, **Lighthouse**. *For Finance:* fewer resources, more Budgets, Spend & Forecast and Reports. *For Operations:* more Zombies, Compute and Schedules.

### 7.4. Handling objections

| Objection | What is behind it | How to answer |
|---|---|---|
| "We already have Azure Cost Management / Advisor" | They think it is already covered | "They are the starting point, and we use them as a source. What we add is saying what to do, who does it and how much was saved: zombies with remediation and approval, tag suggestions, shutdowns, allocation by team, budgets with alerts and reports that arrive on their own." |
| "It's expensive" | They do not see the return | "Let's do the math with your spend" (7.6). "And the price is fixed: it does not rise when your consumption grows." |
| "We don't want to give a third party permissions" | Security risk | 3.2: **read-only** roles on Professional, no Contributor or Owner on any plan, revocable, and with Lighthouse no credentials. "You can start with read-only." |
| "What if it executes something and breaks production?" | Fear of automation | Changes go through **four-eyes approval**, with a prior snapshot and audit; the role is narrow on purpose; **the Copilot does not execute**. |
| "We don't have time to implement another tool" | Adoption cost | "It connects with a script and the first sync brings data in a minute. You try it for 7 days with no commitment, and our engineers accompany the onboarding." |
| "We'll build it ourselves with Power BI or spreadsheets" | Prefers to build | "You can, but someone has to maintain it. Here you already have the engines, the FOCUS standard and the Power BI templates. And your team spends its time deciding, not maintaining queries." |
| "We already use another FinOps platform" | Switching cost | Ask what it is missing. Differentiators: **fixed price** (not a percentage of consumption), remediation with approval, Copilot in three languages, FOCUS 1.1. "You don't have to decide today: try it in parallel for 7 days." |
| "Our spend isn't that big" | They do not see the return | Do the math (7.6). If it really is very small, tell them: an honest "not yet" is better than a customer who leaves. |
| "Where is our data?" | Compliance | 3.4: **West US 2** region, TLS 1.2+ and AES-256, Key Vault, 7-year audit, public DPA and subprocessor list. |
| "We need SOC 2" | Formal requirement | Honestly: **in preparation (target Q3 2027)**. Offer the Trust Center, the DPA and a meeting with our engineers; and let us know. |
| "We use more than one cloud" | Scope | "Today it is Azure. With FOCUS-format CSV ingestion you can add other providers' billing to analyze alongside." |
| "Does the AI see our data?" | Privacy | 3.5: it reads what is on screen, the customer chooses whether to share resource names and tags, can **turn the AI off**, and it does not execute changes. |
| "Let's wait until year-end" | No urgency | "The trial is 7 days with no commitment. What is wasted each month is not recovered." |

### 7.5. Positioning against the alternatives

| Alternative | What it does well | Where it falls short | How to position |
|---|---|---|---|
| **Azure Cost Management and Advisor** (native) | They show spend and Microsoft's recommendations, at no extra cost | They say *what* is happening, but do not organize *who* fixes it, nor execute it with approval, nor allocate by team with its own rules, nor send the report on their own | "A complement: we use their data and close the loop all the way to captured savings" |
| **Own spreadsheets and Power BI** | Total flexibility | Someone has to maintain them; every Azure change breaks them; they do not act | "Your team decides instead of maintaining" |
| **Other third-party FinOps platforms** | Broad coverage, many are multi-cloud | Many charge a **percentage of consumption**, so the fee rises with the customer | "Fixed and public price; deep focus on Azure; remediation with approval" |
| **Consulting or one-off audit** | An expert snapshot | It goes stale as soon as it ends | "The platform does it every day; it can complement the consulting" |

> Be fair to the competition: do not discredit it or claim what you cannot demonstrate. The customer compares.

### 7.6. How to quantify the value

The platform pays for itself with what it finds. The math, with the customer's own numbers:

1. **Look at the Potential Savings** on the White Board (in the demo, with the synthetic data; in the 7-day trial, with theirs). Add what you see in **Zombie Resources** (the monthly cost of what is orphaned), the **shutdown of environments** for development and test (off-hours times the cost of those machines) and, if Enterprise, what **Reservations** and the break-even simulator show.
2. **Apply a prudent estimate** of how much materializes (for example, half).
3. **Compare it against the plan's annual price** (Professional: US$ 3,167.88; Business: US$ 10,559.88).
4. **After the trial, use Captured Savings**: the real saving, with the date and who did it.

> **Illustrative example, with made-up numbers to show the math (it is not a promise or any customer's data).** If the White Board showed Potential Savings of US$ 2,000 per month and only half materialized, that would be US$ 1,000 per month, US$ 12,000 per year, against US$ 3,167.88 for the annual Professional plan: about 3.8 times what it costs.

**What NOT to do:** promise a savings percentage. The saving depends on the customer. Show their data.

### 7.7. Ready-to-use messages

**First contact (short email)**

> **Subject:** [Company]'s Azure bill
>
> Hi [Name]: I work with a FinOps platform for Azure that shows companies like yours where cloud spend goes and where there is money to recover —resources nobody uses, machines left on too long, misused commitments—, with approvals and audit. It has fixed pricing and a 7-day free trial. Would it be OK if I showed you in 20 minutes what it looks like with sample data? — [Your name]

**After the demo**

> Hi [Name]: thanks for your time. To recap what we saw: [pain 1 → screen], [pain 2 → screen]. To try it with your data, this is the sign-up link: [your referral link]. It is 7 days free and we will accompany you with the onboarding. Shall we set it up this week?

**Short message (LinkedIn or chat)**

> Hi [Name], how is the Azure bill going? If you are interested in seeing where money slips away without anyone noticing, I have a 20-minute demo of a FinOps platform. No commitment.

> Remember: always use **your referral link** (`…/signup?ref=YOURCODE`) when you share the sign-up, so the customer is attributed to your name (9.2).

---

## 8. Frequently asked questions from customers

### Product

**What is it and what is it not?** A FinOps platform **for Azure**: visibility, optimization, governance and reports. It is not multi-cloud and it is not consulting.

**Does it replace Azure Cost Management?** No: it uses it as a data source and adds analysis, remediation with approvals, allocation by team, reports and the AI.

**Does it work with EA, MCA and CSP?** Yes. On EA and MCA a read role at the *billing account* level is also needed, assigned by the customer's billing administrator. With CSP, the Enterprise plan adds the billing engine for partners, the resale *markup* and billing Power BI.

**How much historical data does it bring in?** Up to **13 months** of costs.

**How often is the data updated?** Costs, **every night**; the current month is queried live and the user can force an update with the *Refresh* button.

**What languages is it in?** Spanish, English and Portuguese (Brazil), including the manuals and the Copilot.

**Can it be used from a phone?** Yes: there is an installable web app (PWA) with summary, alerts, approvals, support and profile.

**Can the data be exported?** Yes: **FOCUS 1.1** export (CSV, JSON, NDJSON), PDF reports, Power BI templates and, in Enterprise, a **public REST API** and MCP keys for AI assistants.

### Connection and permissions

**How long does it take to be up and running?** The customer runs a script, loads the credentials in the wizard and presses *Run sync*: the first sync brings in the first costs in up to a minute.

**What permissions does it need?** See 3.2. On Professional, read-only. Business and Enterprise add a narrow custom role to act. Never Contributor or Owner.

**And if the customer has many subscriptions?** The plan sets the cap (2, 3 or unlimited). If there are more than it allows, those left outside appear dimmed with the "Over plan limit" mark and **do not feed any dashboard**; the customer chooses which ones to monitor or expands the quota with an add-on.

**Can it be connected without giving us credentials?** With **Azure Lighthouse** (Enterprise): the customer delegates access from their own directory and revokes it whenever they want.

**Does a new subscription in Azure require redoing the onboarding?** No: the read roles are assigned at the root management group and inherited; it shows up on its own when syncing. You only need to assign the remediation role by hand if you want to *act* on it.

### Security and data

**Where is the data stored?** In Azure, **West US 2** region. There is a single deployment region.

**How is the information protected?** TLS 1.2+ and AES-256 encryption, keys in Azure Key Vault, 2FA for sensitive operations, SAML SSO on Enterprise, roles and per-module permissions, and an audit log with 7-year retention.

**Do you have SOC 2?** Not yet: **in preparation, targeted for the third quarter of 2027**. ISO 27001, planned for 2028. There is a public Trust Center, DPA and subprocessor list.

**Which external providers are involved?** Microsoft Azure, Paddle (payments), WorkOS (SSO) and Google Gemini (optional models).

**Who can see my organization's data?** Only the tenant users that the customer itself adds, with the role and permissions they define. An administrator can also **restrict** a person to their slice of spend, and the server enforces the restriction.

### Billing and support

**How much does it cost?** See 6. Professional US$ 299.99 per month, Business US$ 999.99, Enterprise to be agreed; annual has a 12% discount.

**Is there a free trial?** Yes, **7 days**, activated by going through the checkout.

**Can I change plans?** Yes, with proration calculated by the gateway and visible before confirming. You can also add modules or quotas from the Marketplace.

**What support is included?** Tickets inside the platform: 20 per month with a 24-hour response (Professional), unlimited with 8 hours (Business) or 4 hours (Enterprise, with dedicated support).

**Where do I see whether the platform is working?** On the public **status page** (`/status`), with the state of each component and the incident history.

### Artificial intelligence

**Does the AI modify my infrastructure?** No. It analyzes and recommends.

**Does the AI see my data?** It works with what is on the screen. The customer can choose whether resource names and tags are shared, use **their own** AI key or **turn off** the AI features.

**How much does it cost me to use the AI?** Today the AI consumption with the platform's key is absorbed by CSCloudSolutions: it is not billed separately. There is a monthly Copilot query quota per plan (50, 150 or unlimited).

---

## 9. The partner program: how you earn

No exclusivity, no minimum quota and no need for you to do a technical demo: we do that. You choose how involved you want to be in each account and you can use both modalities with different customers.

### 9.1. The two modalities

| | **Referral** | **Co-selling** |
|---|---|---|
| **Commission** | **15%** | **20%** |
| **On what** | Each of the customer's charges | The annual value of the sale |
| **For how long** | The customer's first **12 months** | See below |
| **What you do** | You share your link | You introduce the account and co-lead the opportunity |
| **What we do** | Everything else | Technical demo, architecture and onboarding |

**The 12-month window is counted per customer, not from when you sign.** If you bring in one account in March and another in November, each one earns commission for its twelve months from its own first charge. It is measured in months and not in number of charges: "up to 12 charges" would give twelve years to a customer who pays annually.

**How co-selling accrues**, depending on how the customer pays:

- **Monthly contract:** one installment per month, equal to 20% of each monthly charge, up to 12 installments. The first month is not settled (onboarding period) and falls due together with the second: after the second charge the first two installments are settled, and from the third month on each charge accrues its installment.
- **Annual contract:** a single installment, 20% of the annual charge, due from the **second month** of the sale. The following year's renewal does not pay it again.
- If the customer leaves, the installments that were not yet due are cancelled; what was already due or paid is left untouched.

**What it means in money** (on list prices, assuming the customer pays all twelve months):

| Plan your customer buys | Referral (15%) | Co-selling (20%) |
|---|---|---|
| Professional — US$ 299.99/month | US$ 540 | US$ 720 |
| Business — US$ 999.99/month | US$ 1,800 | US$ 2,400 |
| Enterprise — to be agreed | Per contract | Per contract |

Amounts are calculated on the **pre-tax subtotal** of each charge. Taxes, withholdings and payment gateway fees are not commissioned.

### 9.2. Your referral link and how a customer ends up in your name

We give you your own link with your code:

```
https://finops.cscloudsolutions.com.ar/signup?ref=YOURCODE
```

1. You share the link wherever you want: email, LinkedIn, your own website.
2. Someone enters through it and their browser stores your code for **60 calendar days**.
3. If they sign up within that window, the customer is **attributed to you**.
4. From their first charge, each of their payments accrues commission for you for 12 months.

**The four rules:**

- **First touch wins.** A customer belongs to a single partner and the attribution is not reassigned. If they came in through your link and then through someone else's, they are yours.
- **Attribution happens at sign-up.** A company that was already a customer before does not get attributed by entering a referral link later.
- **Your percentage is frozen on each charge.** If we renegotiate the % later, what has already accrued is not touched: the new one applies from the next charge.
- **No self-referrals.** A customer is not attributed when your email matches that of someone at that company. The system rejects it on its own.

> **The limit you should know about.** Attribution depends on the visitor keeping their browser cookies. Private browsing, clearing site data, switching device or blockers can prevent it. If you are working an important account, **let us know before they register** and we attribute it by hand: it is the safe way not to depend on a cookie.

### 9.3. Your panel

When we sign you up you receive by email a **personal read-only link** to your panel. You need no user or password: **the link is the credential**. If you also close sales as a sales rep, either of your two links shows everything together.

```
https://finops.cscloudsolutions.com.ar/partner#k=…
```

It opens in your browser's language, and you can switch it with the **language selector** at the top right (Spanish, English or Portuguese) without losing access.

**What you see:**

- What you have **earned in total**, how much you have **to collect** and how much we **have already paid you**, and the earnings per program: **referrals** and **direct sales**, each with its percentage.
- Your **referred customers**, with the date until which each one earns commission.
- Your **direct sales**, if you close sales as a sales rep: company, sale date, contract and installments.
- The detail of each commission: company, program, date, when it falls due, base, percentage, amount and status.
- **This manual**, in Spanish, English and Portuguese, to download as PDF or Markdown, from the *Partner manual* button in the panel.

**What you do NOT see** (on purpose): the cloud spend of the customers you brought in, their Azure identifiers or anything about other partners. Only the company name, the dates and your own amounts.

**Take care of the link:** whoever has it sees your numbers. Do not paste it into a group. If you lose it, ask us for a new one: the previous one stops working. If we stop working together, we revoke it and the panel closes.

### 9.4. How and when you get paid

Each commission goes through these statuses, and you see all of them in your panel:

| Status | What it means |
|---|---|
| **Pending** | Accrued. The customer paid and your commission was recorded. It falls due **2 months after the customer's sale date**; what they pay after that period falls due with each payment. |
| **Due** | Ready to settle. |
| **Approved** | Reviewed on our side. |
| **Paid** | Already transferred to you, with its receipt. |
| **Reversed** | The customer asked for a refund and the commission was voided. |
| **Cancelled** | Voided by hand. |

- Transfers are put together **in batches**: we group everything owed to you into one payment, not one transfer per commission. If there is a **minimum**, a balance that does not reach it rolls over to the next payment.
- **If a customer asks for a refund**, the commission is voided if we have not yet settled it with you. If we already paid you, it is deducted from the next settlement.
- A **Paid** commission is not reverted from the system: a correction is an accounting operation.

**What we agree on when we sign.** We would rather say it now than have you discover it later. These four things are **not** fixed in advance and are defined with you in the agreement:

1. **How often we settle.** Today there is no automatic calendar.
2. **The payment method.** Transfer, or whatever we agree; we record it in your profile.
3. **Whether there is a minimum** below which the balance rolls over to the next payment.
4. **Tax documentation.** Who issues a receipt and under what condition. We do not withhold or process taxes on your behalf.

> The percentages in this manual are those of the **standard program** and are confirmed in the signed agreement.

### 9.5. How to get started

1. **A 15-minute call:** we see whether your network fits and answer whatever is missing.
2. **We sign the agreement**, with your percentage and the settlement conditions.
3. **We sign you up:** you receive by email your referral link and the link to your panel.
4. **We hand you the sales material** and coordinate the first demo when you need it.

You do not need to know Azure or FinOps. You need access to CTOs, CFOs, technology directors or infrastructure managers.

### 9.6. Good practices for selling without overreaching

- **Promise what the platform does today.** The limits are marked in 1.4, 3.4 and 6.2.
- **Do not promise a certification** (SOC 2, ISO 27001) or data residency by region.
- **Do not guarantee a savings percentage:** show the customer's own data (7.6).
- **Confirm prices and conditions before quoting.** Those in this manual are list prices as of October 2026; any special condition (discount, term, pilot) is coordinated with CSCloudSolutions before offering it.
- **Always share your referral link** and let us know about important accounts before they register.
- **On a technical or security doubt, escalate it:** our engineers are there for that.

---

## 10. Glossary

| Term | What it means |
|---|---|
| **FinOps** | The practice of managing cloud spend with data shared between Finance, Technology and Business. |
| **FOCUS** | *FinOps Open Cost and Usage Specification*: the FinOps Foundation's standard format for cost data. The platform exports in FOCUS 1.1. |
| **Service Principal** | The application identity the customer creates in Entra ID so the platform reads their Azure with just the right roles. |
| **Azure Lighthouse** | An Azure mechanism to **delegate** access to a tenant without sharing credentials; the customer revokes it whenever they want. |
| **RBAC** | Role-based access control. In Azure, which roles an identity has; in the platform, what each user can do. |
| **EA / MCA / CSP** | Contract models with Microsoft: *Enterprise Agreement*, *Microsoft Customer Agreement* and *Cloud Solution Provider* (through a partner). |
| **MACC** | *Microsoft Azure Consumption Commitment*: a minimum annual consumption commitment with Microsoft. |
| **Reservation (RI)** | A 1- or 3-year commitment on a specific resource in exchange for a discount versus pay-as-you-go. |
| **Savings Plan** | An hourly spend commitment, more flexible than a reservation. |
| **Pay-as-you-go (PAYG)** | Paying for usage with no commitment: the highest rate. |
| **ESR** | *Effective Savings Rate*: how much is really saved against paying everything at list price, discounting the commitment that went unused. |
| **Azure Hybrid Benefit (AHB)** | A discount for using Windows Server or SQL Server licenses the customer already owns. |
| **Rightsizing** | Adjusting a resource's size to its real usage. |
| **Zombie resource** | A resource that keeps billing without serving any function (unattached disk, orphaned IP, unused VM…). |
| **Hard waste / Soft waste** | Direct monetary waste / governance misalignment (for example, missing tags). |
| **TTL** | *Time-To-Live*: the lifetime of an ephemeral resource before it expires. |
| **Tag** | A key-value metadata on a resource (Environment, Cost center…), the basis of cost allocation. |
| **Showback / Chargeback** | Showing each area how much it spends / charging it back internally. |
| **Cost Group / Cost center** | Grouping of costs by project, line of business or area. |
| **Perspective** | A split of spend by ordered rules (team, product, environment) in which each resource falls into a single group. |
| **Unit Economics** | Cost per business unit (per transaction, per user, per customer). |
| **Anomaly** | A deviation in spend outside the normal range, detected statistically (Z-Score). |
| **Forecast / projection** | An estimate of future spend. |
| **MTD** | *Month-To-Date*: what has accumulated in the current month. |
| **Shift-Left** | Moving cost control to an earlier stage: the Pull Request, before deployment. |
| **Budget Gate** | A threshold that fails a Pull Request if the change adds more cost than allowed. |
| **BYOK** | *Bring Your Own Key*: the customer uses their own AI key. |
| **PAL / CPOR** | Microsoft mechanisms to associate a partner with a customer (*Partner Admin Link*, *Claiming Partner of Record*). |
| **PWA** | A web application installable on a phone. |
| **Tenant** | The customer's organization inside the platform (and, in Azure, their Entra ID directory). |

---

## 11. Appendices

### Appendix A. Meeting checklist

**Before**
- [ ] I know which plan to aim at and have that plan's demo ready (`?tier=`).
- [ ] I walked through the demo script (7.3) once.
- [ ] I have my referral link at hand.

**During**
- [ ] I asked the discovery questions (7.1) and noted the answers.
- [ ] I showed the customer's pain, not a list of features.
- [ ] I answered the objections honestly (7.4), including the limits.
- [ ] I agreed the next step with a date.

**After**
- [ ] I sent the summary with the sign-up link.
- [ ] If it is an important account, I told CSCloudSolutions **before** they register.

### Appendix B. What the customer has to prepare for the onboarding

- [ ] A person with permissions to **run the script** and **assign roles** on the subscriptions to be monitored.
- [ ] The list of **subscriptions** to connect (within their plan's cap).
- [ ] If they have **EA or MCA**: the billing administrator assigns the read role at the *billing account* level.
- [ ] A **work email** for the tenant administrator (free providers are not accepted).
- [ ] At least one **notification channel** (email, Slack or Teams).
- [ ] If they use **Lighthouse**: a directory administrator who accepts the delegation.
- [ ] If they use **SSO** (Enterprise): the details of their identity provider.

### Appendix C. Contacts and links

| To… | Where |
|---|---|
| Talk to the sales team, your partner sign-up, important accounts | **sales@cscloudsolutions.com.ar** |
| Technical support for the platform | **soporte@cscloudsolutions.com.ar** (or a ticket from *Support*) |
| Privacy, DPA and certification status | **privacy@cscloudsolutions.com.ar** |
| The platform | https://finops.cscloudsolutions.com.ar |
| Interactive demo | https://finops.cscloudsolutions.com.ar/demo |
| Trust Center | `/legal/security` · `/legal/privacy` · `/legal/terms` · `/legal/dpa` · `/legal/subprocessors` |
| Platform status | `/status` |

---

**Partner and Sales Team Manual — FinOps SaaS**
**Version 1.0 | English | October 2026**

The prices and capabilities in this document are those in force as of October 2026. Commission percentages are those of the standard program and are confirmed in the signed agreement.
