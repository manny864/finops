# RBAC, Autenticación y Multi-Tenancy Policy SOP

## Objetivo

Definir la política vinculante de acceso, autenticación y aislamiento de datos entre tenants de demostración (mock/sandbox) y tenants reales conectados a Azure. Estas reglas aplican a **todas** las rutas API (`/api/...`) y Server Actions del proyecto.

---

## POLÍTICA DE ACCESO, AUTENTICACIÓN Y MULTI-TENANCY (RBAC VS. MOCK)

### 1. Tenants de Demostración / Sandbox

**Condición de activación:** `isMockTenant(tenantId) === true` **O** query/param `mock=true` **O** `isDemoMode === true` **O** `tenantId.startsWith("demo-")`.

- **Bypass de OAuth:** Servir los datos sintéticos/demo de inmediato **sin exigir autenticación OAuth** ni tokens de Azure Entra ID.
- **Sin bloqueo de sesión:** Permitir la navegación fluida e interactiva en modo vista previa sin disparar errores 401/403.
- **Orden obligatorio en rutas API:** El check `isMockTenant(tenantId)` DEBE ejecutarse **ANTES** de `requireTenantAccess(request, tenantId)`. Nunca al revés.

### 2. Tenants Reales / Conectados

**Condición de activación:** `isMockTenant(tenantId) === false`.

- **Validación Estricta de RBAC:** Ejecutar obligatoriamente el middleware de seguridad `requireTenantAccess(req, tenantId)` antes de cualquier consulta.
- **Autenticación OAuth / Entra ID:** Exigir y validar el token Bearer, permisos de lectura (`Cost Management Reader`, `Reader`, `Monitoring Reader`) y contexto de suscripción.
- **Consumo Exclusivo de APIs Vivas:** Prohibido el uso de fallbacks mock; consultar directamente Azure Resource Graph, Cost Management y Azure Monitor.

---

## DATA ACCURACY, TENANT ROUTING & AUTHENTICATION POLICY

### DEMO / MOCK TENANTS (`isMockTenant(tenantId) === true` OR `mock=true` OR `isDemoMode === true`):
- Serve demo/mock datasets immediately without requiring OAuth authentication or Entra ID access tokens.
- Never block navigation, API routes, or UI rendering with 401/403 challenges in demo mode.

### REAL PRODUCTION TENANTS (`isMockTenant(tenantId) === false`):
- Enforce strict RBAC validation using `requireTenantAccess(req, tenantId)`.
- Validate Entra ID OAuth tokens, subscription scopes, and role assignments prior to data resolution.
- Zero-tolerance mock policy: NEVER display fallback mocks or hardcoded zeroes. Compute data dynamically via live Azure APIs:
  - Azure Resource Graph (`Microsoft.Resources`, `Microsoft.Compute`, `Microsoft.DocumentDB`, `Microsoft.DBforPostgreSQL`, `Microsoft.DBforMySQL`, `Microsoft.Sql`, `Microsoft.Cache`, `Microsoft.Storage`, `Microsoft.Fabric`, `Microsoft.RecoveryServices`).
  - Azure Cost Management API & FOCUS 1.0 Dataset.
  - Azure Monitor Metrics API.

### AUDITING & DRILL-DOWNS:
- Always preserve mapping back to Azure Resource ID, Resource Group, Subscription, and Location.

---

## DATA ACCURACY, TENANT ISOLATION & ZERO-FALLBACK POLICY (CRITICAL)

### DEMO / MOCK TENANTS:
- Servir datasets de demostración inmediatamente sin exigir autenticación OAuth ni tokens de Entra ID.
- Habilitar interacción y navegación libre sin bloqueos 401/403.

### REAL / CONNECTED TENANTS:
- Exigir validación estricta de RBAC mediante `requireTenantAccess(req, tenantId)`.
- **PROHIBIDO EL FALLBACK A MOCKS:** Si una consulta a Azure Resource Graph, Cost Management o Monitor devuelve `[]`, `$0.00` o valores nulos (por ejemplo, una suscripción recién creada o sin ese tipo de recurso aprovisionado), la UI **DEBE mostrar `$0.00` / estado vacío real (`Empty State`)**.
- **JAMÁS inyectar mocks como rescate visual de datos vacíos.** Un tenant real con costo cero o sin recursos es un estado operativo válido, no un error que deba enmascararse con datos sintéticos.

### CONSULTAS EN TIEMPO REAL:
Consumir exclusivamente endpoints vivos:
- Azure Resource Graph (`Microsoft.Resources`, `Microsoft.Compute`, `Microsoft.DocumentDB`, `Microsoft.DBforPostgreSQL`, `Microsoft.DBforMySQL`, `Microsoft.Sql`, `Microsoft.Cache`, `Microsoft.Storage`, `Microsoft.Fabric`, `Microsoft.RecoveryServices`).
- Azure Cost Management API & FOCUS 1.0 Dataset.
- Azure Monitor Metrics API.

---

## Patrón de Implementación en Rutas API

```
// Pseudocódigo — Patrón CORRECTO de auth en rutas API
export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get("tenantId");
  if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

  // ✅ PASO 1: Mock check PRIMERO (sin auth)
  if (isMockTenant(tenantId)) {
    return NextResponse.json(buildMockResponse(tenantId));
  }

  // ✅ PASO 2: Auth estricta SOLO para tenants reales
  await requireTenantAccess(request, tenantId);

  // ✅ PASO 3: Consultar APIs vivas de Azure
  const data = await queryAzureLive(tenantId);
  return NextResponse.json(data);
}
```

---

## Permisos Azure Requeridos (Tenants Reales)

| Capa | Rol Mínimo | Propósito |
|------|-----------|-----------|
| ARM / Azure Resource Graph | `Reader` (Suscripción o RG) | Listar recursos (VMs, Discos, Storage Accounts, DBs, Vaults) |
| Cost Management API | `Cost Management Reader` o `Billing Reader` | Snapshots de facturación, amortizaciones, costos MTD |
| Azure Monitor | `Monitoring Reader` | Métricas de rendimiento (CPU, IOPS, transacciones) |
| Entra ID App Registration | `user_impersonation` (delegado) o `https://management.azure.com/.default` (app) | Autenticación OAuth del Service Principal |

---

## Trampas Conocidas / Restricciones

1. **Error 401 por orden incorrecto:** Si `requireTenantAccess` se ejecuta antes de `isMockTenant`, los tenants demo reciben 401 porque no tienen sesión OAuth activa.
2. **Prefijos de tenant:** Además de `isMockTenant()`, verificar `tenantId.startsWith("mock-")` y `tenantId.startsWith("demo-")` para cubrir variantes de demo.
3. **Parámetro `mock=true`:** Algunas rutas antiguas usan el query param `mock=true` como señal de demo; mantener compatibilidad.
4. **Tenants vacíos ≠ Error:** Un tenant real con `$0.00` de costo o sin recursos es un estado válido. La UI debe mostrar un Empty State limpio, nunca inyectar mocks.
5. **Guards de auth reconocidos** (`src/lib/requestAuth.ts`): `requireTenantAccess`, `requireTenantRole`, `requireSuperAdmin`, `requireRequestIdentity`. Toda ruta API que lea `tenantId` del cliente DEBE pasar por uno de ellos antes de cualquier operación tenant-scoped (después del check de mock).
