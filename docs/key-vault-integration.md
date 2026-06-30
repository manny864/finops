# Azure Key Vault Integration

Almacenamiento centralizado de credenciales de Service Principal por tenant en **Azure Key Vault**, con cache en memoria/disco y fallback a la DB local.

> **Constraint:** la app corre en **Hostinger (VPS, no Azure)**, así que NO usamos Managed Identity. Autenticamos contra Key Vault con un Service Principal "de plataforma" vía `ClientSecretCredential`.

---

## Arquitectura

```
                          ┌─────────────────────────────────────────────┐
                          │  Azure Key Vault (cscs-kv-finops-saas-prod) │
                          │  ─────────────────────────────────────────  │
                          │  tenant-<tid>-client-id      → SP client_id │
                          │  tenant-<tid>-client-secret  → SP secret    │
                          └────────────────┬────────────────────────────┘
                                           │ HTTPS (TLS 1.2+)
                                           │ Auth: SP plataforma
                                           │ Firewall: solo IP VPS
            ┌──────────────────────────────┴──────────────────────────────┐
            │                  VPS Hostinger (Node.js)                    │
            │  ─────────────────────────────────────────────────────────  │
            │  src/lib/secrets/keyvault.ts                                │
            │    • Singleton SecretClient                                 │
            │    • LRU cache memoria (TTL 30min fresh)                    │
            │    • Stale-while-revalidate (24h)                           │
            │    • Encrypted disk cache (AES-256-GCM)                     │
            │                                                             │
            │  src/lib/secrets/tenantCredentials.ts                       │
            │    • getTenantCredentials(tid) → KV → fallback DB           │
            │    • setTenantCredentials(tid,...) → KV + DB backup         │
            │                                                             │
            │  Callers:                                                   │
            │    • src/lib/azure.ts (getAzureCredential)                  │
            │    • src/services/tenantHealthService.ts                    │
            │    • src/app/api/cron/sync/route.ts                         │
            │    • src/app/api/admin/check-sp-roles/route.ts              │
            │    • src/app/api/admin/config/users/entra-sync/route.ts     │
            │    • src/app/api/governance/expiring-credentials/route.ts   │
            │    • src/app/api/intelligence/export/powerbi/route.ts       │
            │    • src/app/api/tenants/route.ts (PUT)                     │
            └─────────────────────────────────────────────────────────────┘
```

---

## Naming convention de secrets

```
tenant-<tenantId-normalizado>-client-id
tenant-<tenantId-normalizado>-client-secret
```

Donde `tenantId-normalizado` = lowercase, `[^a-z0-9-]` → `-`, colapsar `--`, trim. Para tenant IDs de Azure (UUIDs) eso es solo `lowercase`.

Ejemplo:
```
tenant-8b41364f-581a-4e43-b7cb-13138dac5517-client-id
tenant-8b41364f-581a-4e43-b7cb-13138dac5517-client-secret
```

---

## Variables de entorno (Hostinger `.env`)

| Variable | Requerida | Default | Descripción |
|---|---|---|---|
| `AZURE_KEYVAULT_ENABLED` | sí (activa el flujo) | `false` | `"true"` para activar KV. Si está `false`, todo cae en DB legacy. |
| `AZURE_KEYVAULT_URL` | sí | — | `https://NAME.vault.azure.net/` |
| `AZURE_KEYVAULT_TENANT_ID` | sí | — | Tenant del SP de plataforma. |
| `AZURE_KEYVAULT_CLIENT_ID` | sí | — | App ID del SP de plataforma. |
| `AZURE_KEYVAULT_CLIENT_SECRET` | sí | — | Secret del SP. **Rotar cada 6 meses.** |
| `AZURE_KEYVAULT_CACHE_TTL_SECONDS` | no | `1800` (30 min) | TTL del cache fresco. |
| `AZURE_KEYVAULT_STALE_TTL_SECONDS` | no | `86400` (24h) | Ventana stale-while-revalidate. |
| `AZURE_KEYVAULT_CACHE_PATH` | no | `~/.finops-data/kv-cache.enc` | Path del disk cache encriptado. |
| `AZURE_KEYVAULT_CACHE_KEY` | no | usa `MFA_ENCRYPTION_KEY` | Clave AES-256 para cache encriptado (hex 64 chars, base64 32 bytes, o cualquier string que se hashea). Si no hay ninguna, el disk cache se deshabilita. |

---

## Setup en Azure (one-time, vía portal)

Ver runbook completo en el ticket de implementación. Resumen:

1. **Resource Group:** `rg-finops-prod` en `Brazil South`.
2. **Key Vault:** `cscs-kv-finops-saas-prod`, Standard, **RBAC authorization**, soft-delete 90d, purge protection ON, public endpoint + selected networks.
3. **Firewall:** allow-list IP egress del VPS Hostinger (`/32`) + tu IP humana + `Allow trusted Microsoft services`.
4. **App Registration:** `sp-finops-saas-prod` (single tenant). Generar client secret 180 días.
5. **RBAC sobre el vault:**
   - Usuario humano admin → `Key Vault Administrator`.
   - SP `sp-finops-saas-prod` → `Key Vault Secrets Officer` (read+write para migración).

**Después de migración** (~30 días estables):
- Bajar SP a `Key Vault Secrets User` (solo lectura) para minimizar blast radius.

---

## Migración inicial (DB → KV)

```bash
# Desde el VPS, con .env de prod cargado
npx tsx scripts/migrate-tenants-to-keyvault.ts --dry-run
# Si el dry-run ve lo esperado:
npx tsx scripts/migrate-tenants-to-keyvault.ts
```

El script:
- Lee `Tenants` con `client_id`/`client_secret` no-nulos.
- Hace `setSecret` en KV para cada uno con el naming convencional.
- Es idempotente (skip si el secret en KV ya tiene el mismo valor).
- **NO borra** la columna en DB — sigue como backup durante la fase de validación.

---

## SQL migrations

```bash
# 1) Hacer la columna NULLable (no destructivo)
mysql -u root -p finops < migrations/20260630-tenants-secret-nullable.sql

# 2) Tras 30 días observando logs sin warnings de "KV read failed":
mysql -u root -p finops < migrations/20260801-tenants-secret-cleanup.sql
```

---

## Rollback

Si algo sale mal:

```bash
# En .env del VPS:
AZURE_KEYVAULT_ENABLED=false
# Reiniciar app. Todo vuelve a leer/escribir de DB (los secrets aún están ahí
# durante la fase de migración).
```

Si ya corriste `20260801-tenants-secret-cleanup.sql` y necesitás rollback:
- Re-popular DB desde KV con un script inverso (no incluido por defecto).
- O re-ingresar credenciales manualmente vía UI de Onboarding.

---

## Consideraciones de latencia (Hostinger ↔ Azure)

| Operación | Latencia esperada |
|---|---|
| KV `getSecret` (cold) | 150–300 ms (Hostinger LATAM ↔ Brazil South) |
| KV `getSecret` (cached) | < 1 ms |
| KV `setSecret` | 200–400 ms |
| Token issuance Azure AD (SP login) | 100–200 ms (cacheado por el SDK 23 min) |

El TTL fresco de 30 min implica ~2 cold-fetches/hora por tenant en peor caso. Para 100 tenants: ~200 fetches/hora = ~$0.001 (3 órdenes de magnitud por debajo del costo mínimo del KV Standard $1/mes).

---

## Cache encriptado en disco

Mitigación contra cold-start con Azure caído:

- File: `~/.finops-data/kv-cache.enc` (chmod 600)
- Cifrado: AES-256-GCM con clave de `AZURE_KEYVAULT_CACHE_KEY` o `MFA_ENCRYPTION_KEY` (32 bytes, hex o base64; fallback derivación SHA-256).
- Persistencia: debounce 5s después de cada escritura.
- Si NO hay clave → no se persiste a disco (solo memoria).

Esto da hasta 24h de runway operacional si Azure KV está completamente caído.

---

## Costos estimados

| Item | Costo/mes |
|---|---|
| Key Vault Standard (base) | $0 (free tier hasta 10k ops) |
| Operations (>10k) | $0.03 / 10k |
| Estimado FinOps (100 tenants × 2 secrets × 30 min TTL) | **< $1/mes** |

---

## Rotación de secrets

### Del SP de plataforma (cada 6 meses)
1. Portal → App Registration `sp-finops-saas-prod` → **Certificates & secrets** → **+ New client secret** (180 días).
2. Copiar el nuevo Value, actualizar `AZURE_KEYVAULT_CLIENT_SECRET` en `.env` Hostinger.
3. Reiniciar app. Verificar logs sin errores.
4. Volver al portal y borrar el secret viejo (después de 24h de gracia).

### De client_secret de un tenant cliente
1. El cliente regenera el secret en su propio Azure (Entra ID → App Registration → Certificates & secrets).
2. Pega el nuevo secret en UI de Admin > Onboarding.
3. `PUT /api/tenants` → `setTenantCredentials` → escribe en KV + DB backup.
4. Próximo `getTenantCredentials` lee desde cache fresh (max 30 min de propagación).

---

## Troubleshooting

| Síntoma | Causa probable | Fix |
|---|---|---|
| `[tenantCredentials] KV read failed` en logs | Network blip / firewall mal | Verificar IP egress del VPS sigue en allow-list del KV. |
| `Forbidden` al setSecret | SP perdió rol `Secrets Officer` | Re-asignar rol en portal → IAM. Esperar 5 min RBAC. |
| `ClientIpAddressNotAuthorized` | IP del VPS cambió | Actualizar firewall del KV con la nueva IP. |
| Cache nunca persiste a disco | No hay `AZURE_KEYVAULT_CACHE_KEY` ni `MFA_ENCRYPTION_KEY` | Setear una clave de 32 bytes hex. |
| Cold-start lento (~500 ms primer request) | Cache vacío + KV roundtrip | Normal. Después del primer fetch, hits sirven < 1 ms. |

---

## Testing

```bash
npx vitest run __tests__/unit/keyvault.test.ts
```

18 tests:
- `isKeyVaultEnabled()` con/sin env vars
- `normalizeSecretName()` para UUIDs y edge cases
- `getTenantCredentials()`: KV-first, fallback DB, error handling, null cases
- `setTenantCredentials()`: write-through KV+DB, KV disabled mode
- Stale-while-revalidate (cache sirve stale si KV cae)
- 404 retorna null silenciosamente

---

## Próximos pasos (cuando haya estabilidad)

1. **Bajar SP a `Key Vault Secrets User`** (solo read) tras 30 días sin escrituras.
2. **Migrar Marketplace credentials** al mismo KV (publisher tenant secrets).
3. **Considerar Azure Private Link** si la app se mueve a Azure Container Apps en el futuro (elimina exposición pública del KV).
4. **Alertas** sobre `Vault.SecretGet/Set` desde Azure Monitor → Slack canal `#security`.
