# FinOps Intelligence Pattern: Multi-service Module Architecture

## Scope

Este patrón describe cómo implementar **FinOps-first** módulos de inteligencia que exponen múltiples servicios cloud con:

1. **Cost Attribution** por unidad de negocio / artefacto / recurso
2. **Waste Detection** automática (orphaned, underutilized, idle resources)
3. **Actionable Recommendations** con ROI y esfuerzo
4. **Bursting/Throttling Risk Detection** (prevención de anomalías)
5. **Unified Dashboard** con tabs por servicio

**Aplicado a:**
- Azure AI Services (Search, Document Intelligence, Speech, Vision, Content Safety, AML, Databricks)
- Microsoft Fabric (Data Factory, Synapse, Data Warehouse, Power BI, Real-time Intelligence)
- (Extensible a AWS AI, GCP Vertex, etc.)

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────────┐
│                     FinOps Intelligence Module                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Server Page (lazy-load) → Client Dashboard (SWR fetch) → Tabs      │
│                                                                       │
│  /api/intelligence/{service}?tenantId=X                              │
│  ├─ Mock data (demo tenant) → MOCK_CAPABILITIES or MOCK_FABRIC     │
│  ├─ Real data (prod tenant) → CostMeterSnapshots query             │
│  └─ Fallback behavior (DB error) → return mock                      │
│                                                                       │
│  Response contract: {                                                │
│    capabilities/artefacts: [{name, cost, usage, resources,          │
│      wasteMetrics, recommendations}],                               │
│    financialSummary: {mtdCost, forecastEom, wasteRisk},             │
│    totalWasteUSD, totalPotentialSavingsUSD                          │
│  }                                                                    │
│                                                                       │
├─────────────────────────────────────────────────────────────────────┤
│                          Cron Pre-warming                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  /api/cron/sync-{service}   (/20 min UTC)                           │
│  ├─ Query Enterprise tenants                                        │
│  ├─ Fetch all capabilities in parallel                              │
│  └─ Results: {total, cached, uncached, errors}                      │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

## FinOps Metrics Contract (Extensible)

### Base Capability/Artefact Object

```typescript
interface Capability {
  name: string;
  description: string;
  monthlyCostUSD: number;

  // FinOps Cost Attribution
  costBreakdown: {
    computeCost: number;
    storageCost: number;
    queryTransactionCost: number;
    overheadCost: number;
  };

  // Usage & Efficiency Metrics
  usage: Array<{
    metric: string;
    value: number;
    unit: string;
    costPer?: number;  // $/query, $/document, $/hour, etc.
  }>;

  // Resource Inventory
  resources: Array<{
    name: string;
    monthlyCost: number;
    utilizationPercent?: number;
    lastAccessedDaysAgo?: number;  // For orphan detection
  }>;

  // Waste Detection (Lazy Evaluation)
  wasteMetrics: {
    orphanedResourceCount: number;    // >45 days no access
    underutilizedResourceCount: number; // <20% utilization
    idleResourceCount: number;        // 0% 7+ days
    estimatedWasteUSD: number;        // $cost × (1 - utilization%)
  };

  // Optimization Guidance
  recommendations: Array<{
    id: string;
    title: string;
    description: string;
    potentialSavingsUSD: number;
    effort: "low" | "medium" | "high";
    roiMonths: number;
    actionType: "rightsizing" | "termination" | "optimization" | "migration" | "consolidation";
    resourceAffected: string;
    confidence: number; // 0-1 (0.8+ = high confidence)
  }>;

  lastUpdated: string; // ISO timestamp
  source: "live" | "snapshot" | "mock";
}
```

### Financial Summary

```typescript
interface FinancialSummary {
  mtdCostUSD: number;              // Month-to-date
  forecastEomUSD: number;          // Forecast end-of-month
  deltaMoMPercent: number;         // Month-over-month delta
  wasteRisk: "low" | "medium" | "high"; // Based on wasteMetrics ratio
}
```

## Patterns by Service

### 1. Azure AI Services (Search, Doc Intel, Speech, Vision, Content Safety, AML, Databricks)

**Cost Breakdown Specifics:**

- **Search**: Vector Storage + Query Capacity (replicas/partitions)
  - Orphan Detection: Indices with 0 queries/30d
  - Recommendation: Consolidate dev indices, reduce replicas off-hours
  
- **Document Intelligence**: Pages/month × unit rate
  - Waste: Unused custom models, failed batch jobs
  - Recommendation: Migrate to Capacity Tier if >400K pages/month
  
- **AML**: Compute cluster + Storage + Inference Endpoint
  - Waste: Clusters not scaling to 0, idle real-time endpoints
  - Recommendation: Expand Spot VM usage, archive inactive experiments
  
- **Databricks**: DBU consumption (cost units) + Azure VM compute
  - Waste: Clusters with auto-termination disabled, abandoned workspaces
  - Recommendation: Enforce 20-30min auto-pause, consolidate F-SKU tiers

### 2. Microsoft Fabric (Unified Capacity Model)

**Artefact Attribution:**

Each artefact (Data Factory, Synapse, DW, Power BI, Real-time Intel) shares a single F-SKU or P-SKU:
- Interactive Operations (user-driven queries): counted as CU consumption
- Background Operations (scheduled jobs): counted separately
- Storage (OneLake): per-GB beneath the capacity SKU

**Waste Detection (Fabric-specific):**

1. **Bursting Risk**: Monitor when interactive ops exceed 100% CU
   - Early warning: >85% triggers "medium risk"
   - Critical: >95% triggers throttling + "high risk"
   
2. **Orphaned Artefacts**:
   - Synapse workspaces with <10% utilization 60+ days
   - Power BI datasets refreshing but not queried
   - Real-time Intelligence clusters ingesting but no consumers
   
3. **OneLake Inefficiency**:
   - Duplicate data (same dataset in multiple workspaces)
   - Unstructured blobs (uncompressed logs, duplicated backups)
   - Data never accessed (lifecycle management opportunity)

**Recommendations (Fabric-specific):**

| Issue | Action | Savings |
|-------|--------|---------|
| Peak utilization >90% | Upgrade F-SKU → P1 or split workloads | $0 (performance) |
| Dev workspace <20% util | Consolidate with prod or pause off-hours | 50-80% SKU reduction |
| OneLake 420GB duplicates | Dedup + lifecycle policy (cold storage) | $1,850/month |
| No auto-pause policy | Enable pause 8pm-6am UTC | 40-50% off-hours cost |

## Implementation Steps

### Step 1: Define Service-Specific Capabilities

Create MOCK_CAPABILITIES or artefacts array:

```typescript
const MOCK_CAPABILITIES = [
  {
    name: "Azure AI Search",
    monthlyCostUSD: 12450.5,
    costBreakdown: { computeCost: 7200, storageCost: 3150, ... },
    usage: [
      { metric: "Search Queries", value: 45000, unit: "queries/day", costPer: 0.0275 },
      { metric: "Storage GB", value: 650, unit: "GB", costPer: 4.85 },
    ],
    resources: [
      { name: "search-prod", monthlyCost: 12450.5, utilizationPercent: 72, lastAccessedDaysAgo: 0 },
      { name: "search-dev", monthlyCost: 2100, utilizationPercent: 8, lastAccessedDaysAgo: 45 },
    ],
    wasteMetrics: {
      orphanedResourceCount: 1,
      underutilizedResourceCount: 1,
      idleResourceCount: 0,
      estimatedWasteUSD: 1800,
    },
    recommendations: [
      {
        id: "search-orphan-dev",
        title: "Terminate Orphaned Dev Search Instance",
        potentialSavingsUSD: 2100,
        effort: "low",
        roiMonths: 1,
        actionType: "termination",
        confidence: 0.95,
      },
    ],
  },
  // ... more capabilities
];
```

### Step 2: Create API Route

```typescript
// src/app/api/intelligence/{service}/route.ts

export async function GET(request: NextRequest) {
  const tenantId = request.searchParams.get("tenantId");
  await requireTenantAccess(request, tenantId);

  if (isMockTenant(tenantId)) {
    // Return MOCK_CAPABILITIES
  }

  // Query CostMeterSnapshots for real tenant
  const data = await fetchRealMetrics(tenantId);
  return NextResponse.json({
    success: true,
    capabilities: data,
    totalCostUSD: sum(data.map(c => c.monthlyCostUSD)),
    financialSummary: { ... },
  });
}
```

### Step 3: Create Tabbed Dashboard Component

```typescript
// src/app/[locale]/intelligence/{module}/components/Dashboard.tsx
"use client";

export default function Dashboard() {
  const { data } = useSWR("/api/intelligence/{service}?tenantId=...", fetcher);
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      {/* Overview: KPIs + Financial Summary */}
      {/* Details: Capability Cards by tab */}
      {/* Recommendations: Sorted by ROI */}
    </div>
  );
}
```

### Step 4: Create Cron Job

```typescript
// src/app/api/cron/sync-{service}/route.ts

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("Authorization");
  if (!timingSafeCompare(authHeader, `Bearer ${CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenants = await queryTenants("WHERE tier = 'Enterprise'");
  const results = await Promise.allSettled(
    tenants.map(t => fetch(`/api/intelligence/{service}?tenantId=${t.id}`))
  );

  return NextResponse.json({
    success: true,
    total: tenants.length,
    cached: results.filter(r => r.status === "fulfilled" && !r.value.mock).length,
  });
}
```

### Step 5: Register in Terraform

```hcl
// infra/terraform/environments/prod/terraform.tfvars

sync_azure_ai = {
  cron            = "*/20 * * * *"
  timeout_seconds = 300
  auth_mode       = "header"
  name            = "sync-azure-ai"
}

sync_microsoft_fabric = {
  cron            = "*/20 * * * *"
  timeout_seconds = 300
  auth_mode       = "header"
  name            = "sync-microsoft-fabric"
}
```

### Step 6: Update i18n

```json
{
  "ServiceName": {
    "title": "Service Title",
    "subtitle": "Service Subtitle",
    "tabs": {
      "capability1": "...",
      "capability2": "..."
    }
  }
}
```

## Key Decisions

### 1. Single Unified Endpoint vs. Per-Capability

**Chosen:** Single `GET /api/.../service?tenantId=X` returns all capabilities in parallel.

**Why:** Simpler caching (1 SWR key), no staggered tab loading, faster perceived load.

**Trade-off:** Client waits for slowest capability. Acceptable given 20-min cache TTL.

### 2. Mock-First for Demo, Fallback for Prod

**Chosen:** Check `isMockTenant()` first; if true, return deterministic mock data. Else query DB.

**Why:** Demo works offline, prod has real data, graceful degradation on DB error.

### 3. Hardcoded Capabilities Metadata

**Chosen:** Capabilities defined as constants with fixed names and descriptions.

**Why:** Metadata is stable (doesn't change per-run), easier to test, supports i18n.

### 4. Cost Per Unit (costPer) Optional

**Chosen:** Each usage metric can include `costPer` (cost per query, per document, etc.).

**Why:** Enables unit economics analysis (e.g., "cost per transcribed minute").

### 5. Utilization % Always Computed

**Chosen:** `utilizationPercent` = (active hours / 24h) × 100 or (actual queries / max queries) × 100.

**Why:** Machine-readable orphan/underutilization detection.

### 6. Recommendations Always Returned (Even if 0)

**Chosen:** Always include `recommendations: []` in response, never omit.

**Why:** Frontend can assume the field exists; better UX for "no recommendations available".

## Testing Strategy

### Unit Tests (API Route)

```typescript
describe("GET /api/intelligence/{service}", () => {
  test("returns mock for demo tenant", async () => {
    const res = await GET(mockRequest({ tenantId: "mock-enterprise" }));
    const json = await res.json();
    expect(json.mock).toBe(true);
    expect(json.capabilities.length).toBeGreaterThan(0);
  });

  test("applies tier gate for Essential", async () => {
    const res = await GET(mockRequest({ tenantId: "essential-tenant" }));
    expect(res.status).toBe(403);
  });

  test("waste metrics sum correctly", async () => {
    const json = await res.json();
    const waste = json.capabilities.reduce((sum, c) => sum + c.wasteMetrics.estimatedWasteUSD, 0);
    expect(waste).toBe(json.totalWasteUSD);
  });
});
```

### Component Tests (Dashboard)

```typescript
describe("<Dashboard />", () => {
  test("renders all tabs", () => {
    render(<Dashboard />);
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Recommendations" })).toBeInTheDocument();
  });

  test("tab click switches content", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await user.click(screen.getByRole("tab", { name: "Recommendations" }));
    expect(screen.getByText(/Orphaned Resource/)).toBeInTheDocument();
  });
});
```

### E2E (Playwright)

```typescript
test("FinOps module loads and displays waste metrics", async ({ page }) => {
  await page.goto("/intelligence/azure-ai");
  await expect(page.locator("text=Total Waste")).toBeVisible();
  await page.click("[data-testid='tab-recommendations']");
  await expect(page.locator("text=Terminate")).toBeVisible();
});
```

## Extensions & Future Work

### 1. Multi-provider Aggregation

Create `GET /api/intelligence/all-ai?tenantId=X` that aggregates Azure + AWS + GCP:

```json
{
  "azure": { capabilities: [...], totalCostUSD: 98K },
  "aws": { capabilities: [...], totalCostUSD: 45K },
  "gcp": { capabilities: [...], totalCostUSD: 22K },
  "grandTotalUSD": 165K
}
```

### 2. Time Series & Trends

Add `history: [{ date, costUSD, utilizationPercent }, ...]` to track month-over-month trends.

### 3. Automation (Action Execution)

POST endpoint `/api/intelligence/{service}/actions/{id}` to execute recommendations:
- Terminate orphaned resource
- Apply cost savings policy
- Auto-pause schedule

### 4. Anomaly Alerts

Integrate with notifications when:
- Waste % jumps >20% MoM
- New bursting risk detected (Fabric >80% CU)
- Cost-per-unit spikes 2σ from baseline

### 5. Showback / Chargeback

Allocate service costs to business units / projects via tags:
- Azure AI Search cost → "Marketing Recommendations" project
- Fabric Data Warehouse → "Analytics FinOps" team

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| All capabilities show `mock: true` for prod tenant | DB query returns empty or errors | Check CostMeterSnapshots has data for `service_name` |
| Bursting risk always "low" even at high util | Calculation formula off | Verify: risk = utilization > 75 ? "high" : "medium" |
| Recommendations missing $ values | `potentialSavingsUSD` not calculated | Add: `estimatedCost × optimizationPercent` |
| Cron job not firing | CRON_SECRET timing-safe compare fails | Verify env var matches exactly (no newlines) |
| Fabric artefacts showing wrong SKU | Resource type mapping incomplete | Add missing type in `artefactTypeMap` |

---

**Version:** 1.0 (2026-08-12)  
**Author:** CSCloudSolutions FinOps Architects  
**Related:** `docs/patterns/AZURE_AI_PATTERN.md`, `finops-cmp-database-cockpit-pattern.md`
