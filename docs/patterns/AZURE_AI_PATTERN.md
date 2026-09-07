# Patrón Azure AI: Módulo multi-servicio con tabs y cron de pre-calentamiento

## Objetivo del patrón

Exponer múltiples servicios AI de Azure (o cualquier proveedor multi-servicio) como un dashboard unificado con:

1. **Vista por pestaña:** cada servicio/capability en una pestaña separada
2. **Métrica única por servicio:** costo mensual, uso actual, recursos subyacentes
3. **Pre-calentamiento en cache:** cron job que llena SWR cache antes de que el usuario llegue
4. **Demo-mode:** soporte para tenants de demo con datos sintéticos determinísticos
5. **i18n:** traducciones ES/EN/PT-BR automáticas

## Decisiones arquitectónicas

### 1. **API unificada vs. endpoint por servicio**

**Decisión:** Una sola ruta `GET /api/intelligence/azure-ai?tenantId=X` que devuelve **todos** los servicios en paralelo.

**Justificación:**
- Reduce latencia percibida (7 paralelos < 7 secuenciales)
- Simplifica cache (1 SWR key vs. 7)
- Cliente nunca ve partes del dashboard (no hay tabs vacíos esperando)
- Trade-off: cliente debe esperar el más lento de los 7; aceptable para cache de 20 minutos

**Alternativa rechazada:** Endpoint per-servicio (`/api/.../search`, `/api/.../document-intel`, ...) → complejo, requiere coordinación de tabs, peor UX.

### 2. **Tabbed UI: cliente vs. servidor**

**Decisión:** Componente **cliente** con `AzureAIDashboard.tsx` renderiza tabs.

**Justificación:**
- Tabs son interactivos puro (cambio de estado local, no afecta el servidor)
- Cada tab tiene su propia Card con spinner local
- SWR refetch es transparent
- Suspense/lazy-load del componente completo (server-first page wrapper)

**Alternativa rechazada:** 7 sub-rutas (`/azure-ai/search`, `/azure-ai/doc-intel`, ...) → necesitaría 7 pages.tsx, más complejidad de layout.

### 3. **Capabilities: hardcoded vs. descubiertos en tiempo de ejecución**

**Decisión:** Hardcoded en `route.ts` con metadata constante.

```typescript
const CAPABILITY_METADATA = {
  search: { name: "Azure AI Search", icon: "Search", tier: "Professional+" },
  document_intel: { name: "Document Intelligence", icon: "FileText", tier: "Professional+" },
  // ...
};
```

**Justificación:**
- Capabilities no cambian (son servicios managed de Azure)
- Metadata es controlada por el team (traducción, tier, descripción)
- Evita reflexión de runtime innecesaria
- Fácil de grabar en tests

**Alternativa rechazada:** Descubrir capabilities dinámicamente desde `UsageMetrics.resource_type` → frágil, requiere schema conocido.

### 4. **Mock-first para demo, fallback a DB para prod**

**Decisión:** En `route.ts`, primero check `isMockTenant(tenantId)` → return `MOCK_CAPABILITIES`, else query `CostMeterSnapshots`.

```typescript
if (isMockTenant(tenantId)) {
  return { success: true, mock: true, capabilities: MOCK_CAPABILITIES, ... };
}
const data = await querySnapshots(tenantId);
```

**Justificación:**
- Demo funciona offline, sin credenciales Azure
- Prod hits DB (o fallaría sin regresar a mocks)
- UI siempre muestra algo (amber `data.mock` banner si es synthetic)

**Alternativa rechazada:** Hacer introspection contra ARM cada request → lento, requiere permisos elevados, falla gracefully.

### 5. **Cron job: cada 20 minutos con SWR TTL de 1 hora**

**Decisión:** 
- Cron `sync-azure-ai` corre `*/20 * * * *` UTC
- Cliente SWR tiene `revalidateOnFocus: true, revalidateOnReconnect: true` + refresh manual
- Datos siempre tienen <= 40 minutos de edad (peor caso)

```typescript
// En AzureAIDashboard.tsx
const { data, error, isLoading } = useSWR(
  apiUrl, 
  fetcher, 
  { 
    revalidateOnFocus: true, 
    revalidateOnReconnect: true,
    dedupingInterval: 60000,
  }
);
```

**Justificación:**
- 20 min = balance entre coherencia y carga DB
- SWR 1h = usuario no paga costo extra en request if he navigates away/back
- TTL < Cron interval = siempre hay datos frescos

**Alternativa rechazada:**
- Cron cada 5 min → demasiada presión DB
- SWR con `revalidateOnMount: true` sin cache local → 7 requests por mount

### 6. **Contrato de respuesta API**

**Estándar obligatorio:**

```json
{
  "success": boolean,
  "mock": boolean,
  "capabilities": [
    {
      "capability": "search" | "document_intel" | "speech_language" | "vision_video" | "content_safety" | "aml" | "databricks",
      "name": "Azure AI Search",
      "description": "...",
      "monthlyCostUSD": "123.45",
      "usage": [
        { "metric": "queries_executed", "value": "5432", "unit": "count" },
        { "metric": "storage_gb", "value": "10.2", "unit": "GB" }
      ],
      "resources": [
        { "id": "/subscriptions/.../search", "name": "search-prod", "region": "eastus2" }
      ],
      "lastUpdated": "2026-08-07T14:23:00Z",
      "source": "CostMeterSnapshots" | "mock"
    }
  ],
  "totalCostUSD": "861.30",
  "timestamp": "2026-08-07T14:24:00Z"
}
```

**Reglas:**
- `monthlyCostUSD` es DECIMAL preciso (nunca float)
- `usage[]` es completamente opcional (telemetría best-effort)
- `resources[]` puede estar vacío si no se detectan recursos
- Si `mock: true`, es Azure Sandbox / demo tenant
- `lastUpdated` es el momento de la última lectura de CostMeterSnapshots

### 7. **Internacionalización (i18n)**

**Decisión:** Translations en `messages/{es,en,pt-BR}.json` bajo key `AzureAI`.

```json
{
  "AzureAI": {
    "title": "Inteligencia Artificial en Azure",
    "subtitle": "Servicios de IA para búsqueda, documentos, lenguaje, visión y análisis",
    "tabs": {
      "search": "Búsqueda de IA",
      "document_intel": "Document Intelligence",
      ...
    }
  }
}
```

**Regla:** Mantener paridad de keys en los 3 archivos (ES/EN/PT-BR). ESLint advierte si key falta en uno.

## Cómo replicarlo para otro proveedor (AWS, GCP, Azure OpenAI, etc.)

### Paso 1: Definir Capabilities

Crear tabla en `src/app/api/intelligence/<provider>-ai/route.ts`:

```typescript
const CAPABILITY_METADATA = {
  capability_a: {
    name: "Capability A",
    description: "...",
    tier: "Professional+",
    icon: "IconComponent",
  },
  capability_b: { ... },
};
```

### Paso 2: Crear API Route

```typescript
// src/app/api/intelligence/<provider>-ai/route.ts

export async function GET(request: NextRequest) {
  const { tenantId } = await validateRequest(request);
  
  if (isMockTenant(tenantId)) {
    return NextResponse.json({
      success: true,
      mock: true,
      capabilities: MOCK_CAPABILITIES,
      totalCostUSD: "...",
    });
  }

  // Query DB for real tenant
  const capabilities = await Promise.all([
    queryCapability("capability_a", tenantId),
    queryCapability("capability_b", tenantId),
  ]);

  return NextResponse.json({
    success: true,
    mock: false,
    capabilities,
    totalCostUSD: sumCosts(capabilities),
  });
}
```

### Paso 3: Crear Page + Dashboard Component

**Server page** (`src/app/[locale]/intelligence/<provider>-ai/page.tsx`):
```typescript
import dynamic from "next/dynamic";
import { Suspense } from "react";

const Dashboard = dynamic(
  () => import("./components/<Provider>AIDashboard"),
  { ssr: false }
);

export default async function ProviderAIPage() {
  const t = await getTranslations("<ProviderAI>");
  return (
    <div className="content animate-in fade-in px-6 py-8">
      <div className="mb-6">
        <h2 className="text-xl font-semibold">
          {t("title")}
        </h2>
        <p className="text-sm text-slate-500">{t("subtitle")}</p>
      </div>
      <Suspense fallback={<div>Loading...</div>}>
        <Dashboard />
      </Suspense>
    </div>
  );
}
```

**Client dashboard** (`src/app/[locale]/intelligence/<provider>-ai/components/<Provider>AIDashboard.tsx`):
- Fetch dari `/api/intelligence/<provider>-ai`
- Render tabs (hardcoded o looped)
- Capability Card per tab con cost + usage + resources
- Error states (403 tier gate, 500 server error)

### Paso 4: Add i18n Keys

Dalam `messages/es.json`, `messages/en.json`, `messages/pt-BR.json`:

```json
{
  "<ProviderAI>": {
    "title": "...",
    "subtitle": "...",
    "tabs": { "cap_a": "...", "cap_b": "..." }
  }
}
```

### Paso 5: Create Cron Job

**Route handler** (`src/app/api/cron/sync-<provider>-ai/route.ts`):
```typescript
export async function GET(request: NextRequest) {
  // Timing-safe compare CRON_SECRET
  // Query Tenants WHERE tier >= 'Professional' (or Enterprise only)
  // For each tenant: fetch /api/intelligence/<provider>-ai?tenantId=...
  // Collect results (cached, not cached, errors)
  // Return summary
}
```

**Terraform config** (in `infra/terraform/environments/prod/terraform.tfvars`):
```hcl
sync_<provider>_ai = {
  cron            = "*/20 * * * *"
  timeout_seconds = 300
  auth_mode       = "header"
  name            = "sync-<provider>-ai"
  async_poll      = false
}
```

### Paso 6: Test Locally

```bash
# Mock mode
curl "http://localhost:3000/api/intelligence/<provider>-ai?tenantId=mock-enterprise"

# Real tenant (if DB is set up)
curl -H "X-Tenant-Id: <real-tenant-id>" "http://localhost:3000/api/intelligence/<provider>-ai"

# Cron job (locally)
CRON_SECRET=test npm run dev
curl -H "Authorization: Bearer test" "http://localhost:3000/api/cron/sync-<provider>-ai"
```

### Paso 7: Update Sidenav/Menu (if needed)

If new provider is a major feature, add link in `RouteTierGate` or sidenav config.

## Extensiones futuras

### Agregación multi-provider

Crear endpoint `GET /api/intelligence/all-ai` que aggregate todas los providers:

```typescript
const azure = await fetch("/api/intelligence/azure-ai?tenantId=...");
const aws = await fetch("/api/intelligence/aws-ai?tenantId=...");
const gcp = await fetch("/api/intelligence/gcp-ai?tenantId=...");

return {
  success: true,
  providers: { azure, aws, gcp },
  totalCostUSD: sum([azure.totalCostUSD, aws.totalCostUSD, gcp.totalCostUSD]),
};
```

### Recomendaciones automáticas

Agregar reglas de negocio en `deriveRecommendations`:
- Si `usage.queries < 100/mes` → "Downsize or consolidate"
- Si `costPerQuery > $0.50` → "Negotiate volume discount"
- Si `costTrend UP 20% MoM` → "Optimize prompts or architecture"

### Webhooks / Alertas

Integrar con `src/modules/notifications/` para alertar si costo > umbral o capability indisponible.

## Testing

### Unit test para API route

```typescript
describe("GET /api/intelligence/azure-ai", () => {
  test("returns mock capabilities for demo tenant", async () => {
    const res = await GET(mockRequest({ tenantId: "mock-enterprise" }));
    const json = await res.json();
    expect(json.mock).toBe(true);
    expect(json.capabilities.length).toBe(7);
  });

  test("applies tier gate for Essential tenant", async () => {
    const res = await GET(mockRequest({ tenantId: "essential-tenant" }));
    expect(res.status).toBe(403);
  });
});
```

### Component test para Dashboard

```typescript
describe("<AzureAIDashboard />", () => {
  test("renders all 7 tabs", () => {
    render(<AzureAIDashboard />);
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("Document Intelligence")).toBeInTheDocument();
    // ... x5 more
  });

  test("tab click switches active capability", async () => {
    const user = userEvent.setup();
    render(<AzureAIDashboard />);
    await user.click(screen.getByRole("tab", { name: "Document Intelligence" }));
    expect(screen.getByText("Document Intelligence")).toHaveAttribute("aria-selected", "true");
  });
});
```

## Troubleshooting

### "Cron job not firing"

1. Check `CRON_SECRET` env var in prod
2. Verify Terraform job config syntax (must be valid cron expression, UTC only)
3. Check Container Apps Job logs: `az containerappsjob logs show --name sync-azure-ai --resource-group ...`

### "DB query timeout"

If many capabilities or tenants, consider:
- Split into per-capability cron jobs (*/20 for search, */25 for doc-intel, ...)
- Add DB connection pool tuning in `src/modules/storage/db.ts`
- Cache longer (SWR 2h instead of 1h) if acceptable

### "Demo tenant shows costs but says `mock: true`"

By design. To disable, set `DEMO_TENANTS=` (empty string) or remove tenant from `isMockTenant()` function.

## Resumen de archivos clave

| Archivo | Propósito |
|---------|-----------|
| `src/app/api/intelligence/azure-ai/route.ts` | API unificado: todos los servicios en paralelo |
| `src/app/[locale]/intelligence/azure-ai/page.tsx` | Page server-side: translations + lazy load dashboard |
| `src/app/[locale]/intelligence/azure-ai/components/AzureAIDashboard.tsx` | Cliente: tabs + SWR fetch + capability cards |
| `src/app/api/cron/sync-azure-ai/route.ts` | Cron: pre-calientan cache cada 20 min |
| `infra/terraform/environments/prod/terraform.tfvars` | Configuración Container Apps Job schedule |
| `messages/{es,en,pt-BR}.json` | i18n keys bajo `AzureAI` |
| `src/lib/mockData.ts` | MOCK_CAPABILITIES por tier |

---

**Última actualización:** 2026-08-07  
**Autor:** CSCloudSolutions Arquitectura  
**Versión del patrón:** 1.0
