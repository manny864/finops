# Handoff — Configuración Global, Ingesta e Integraciones

**Rama:** `feat/config-general-integrations` · **Base:** `main` · **Fecha:** 2026-08-23
**Estado:** 35 commits, nada pusheado. `typecheck` y `eslint --quiet` limpios, 1612 tests en verde.

---

## 1. Lo primero: el VPS ya no existe

La documentación del repo dice que el VPS está *"congelado desde 2026-07-28"*. **Ya no existe.** Eso deja tres cosas desalineadas:

| Qué | Dónde | Situación |
|---|---|---|
| `deploy.yml` | `.github/workflows/` | Deploy por SSH a un host inexistente. Es `workflow_dispatch`, no corre solo, pero falla si alguien lo ejecuta. |
| `restore-test.yml` | `.github/workflows/` | Corre la **prueba de restauración de backups** por SSH al VPS. Hoy no se puede ejecutar: **no hay verificación de que los backups restauren**. |
| Documentación de crons | `CLAUDE.md`, `AGENTS.md` | Dicen que los crons se invocan desde el crontab del VPS. **Es falso**: corren como Container Apps Jobs (`infra/terraform/modules/cronjobs`). |

**Lo más urgente de los tres es `restore-test.yml`.** Un backup sin prueba de restauración es una suposición, no un respaldo. Migrarlo a un Container Apps Job es el equivalente directo.

No toqué ninguno de los tres: borrar workflows y editar las directivas del repo es decisión tuya.

---

## 2. Qué se hizo, agrupado por área

### Configuración Global (5 sub-pestañas)

| Pestaña | Estado backend | Estado UI |
|---|---|---|
| General | ✅ tema + ITSM persistidos, tests de webhook/ITSM | ✅ refactorizada |
| IA | ✅ pista de API key, resultado de última prueba | ✅ refactorizada |
| Notificaciones | ✅ tipo webhook, categorías, estado de entrega | ✅ refactorizada |
| Estado de Cuenta | ✅ datos reales de ingesta | ✅ reescrita |
| Partner Markup | ✅ tarifa fija + reglas de excepción | ✅ refactorizada |

### Defectos encontrados y corregidos

Estos no estaban en el pedido; aparecieron leyendo el código:

1. **Las preferencias de "Qué datos se comparten" no se aplicaban.** El copilot y `generateFinOpsReport` mandaban nombres de VMs, resource groups y tags al proveedor de IA externo aunque el tenant hubiera apagado la compartición. Sólo `getAssessment` las respetaba.
2. **Probar un canal de notificación disparaba a todos.** Cada clic en "Probar" mandaba el mensaje a Slack *y* Teams *y* Email.
3. **La purga de tenant borraba su propia auditoría.** `ActionLogs` y `AuthAuditLogs` tenían FK con `ON DELETE CASCADE`.
4. **Dos motores de precios.** El PDF emailado recalculaba con floats en vez de usar `buildInvoicingPayload`; podía diferir en centavos del reporte en pantalla.
5. **Estado de Cuenta mentía.** 66 líneas con `Active & Connected` y `Sincronización OK` hardcodeados: decía que la ingesta estaba sana aunque llevara días caída.
6. **Reporte Ejecutivo con columnas inexistentes.** `SELECT name, tier, currency FROM Tenants` (es `company_name`, y `currency` no existe). Peor: dos queries a `CostSnapshots` con columnas mal escritas envueltas en `catch {}` mudos — el reporte informaba **gasto MTD de $0.00** sin error visible.
7. **Datos fabricados en el Reporte Ejecutivo.** `totalSavings || 9930`, `annualSavings || 119160`, tamaño de reporte constante `1258291`. Un tenant real veía USD 9.930 de ahorro inventado en un documento dirigido a dirección.
8. **93 claves i18n inexistentes** (56 en `AdminReport`, 37 repartidas). next-intl renderizaba el nombre crudo de la clave.
9. **Copilot M365 era una fachada completa.** El archivo lo declaraba: *"No real Microsoft Graph API calls are made."* `provision` generaba el ID con `Math.random()` y escribía `indexed_records = 12500` fijo.

### Ingesta de costos — la investigación más larga

El Reporte de Facturación mostraba **368,92 USD** cuando lo real superaba **677**. El reporte no tenía ningún error: devolvía exactamente lo que había en la base. **Faltaban 15 días de agosto.**

Causas encadenadas, en orden de descubrimiento:

1. `isTenantDataStale` sólo miraba `MAX(date)`. Con el último día reciente, un histórico con semanas ausentes se daba por sano. → Ahora detecta huecos internos.
2. El gap-filler del cron mira 7 días atrás; 10 de esos huecos ya habían quedado fuera para siempre.
3. Al disparar el backfill manualmente contra Azure: **429 en todas las consultas**, 0 filas. El backfill devolvía "éxito" con 0 filas y **quemaba el lock de 6 h**. → Ahora acorta a 15 min si no recuperó nada.
4. **El scope de management group gastaba cuota al pedo.** Los 4 servicios de billing lo intentan primero; en tenants donde no sirve, cada intento se lleva 3 reintentos con backoff (~11 s, 3 llamadas) antes de caer a suscripciones. → Se recuerda por tenant y se saltea.
5. La consulta de backfill pedía meses enteros: una sola llamada enorme que Azure throttlea completa. → **Relleno día por día**, con progreso incremental.
6. El job `historical-gap-backfill` se marcaba **Failed** aunque terminara bien: el ingress corta a ~240 s con 504 y el job no usaba `async_poll`. → Implementado el contrato async.

---

## 3. Migraciones nuevas (8)

Todas aplicadas y verificadas contra MySQL local.

| Migración | Qué hace |
|---|---|
| `20260822-005` | Tema e integración ITSM en `Tenants` |
| `20260822-006` | **Quita el `ON DELETE CASCADE`** de `ActionLogs` y `AuthAuditLogs` |
| `20260822-007` | Pista de API key y resultado de última prueba de IA |
| `20260822-008` | Tipo `webhook`, categorías y estado de entrega en canales |
| `20260822-009` | Tarifa fija + tabla `MarkupOverrideRules` |
| `20260822-010` | Tabla `ApiQuotaSamples` (medición real de cuota) |
| `20260822-011` | Costo y ahorro persistidos en `ExecutiveReportJobs` |
| `20260822-012` | Tabla `M365IndexLogs` |

**Criterio aplicado:** se extendió `Tenants` en vez de crear `TenantGlobalSettings` / `TenantIntegrations` / `TenantAiSettings` / `TenantAccountStatus`, porque esos hechos ya viven ahí (`webhook_url`, `logo_stored_name`, las 8 columnas `ai_*`) y una tabla 1:1 aparte sólo agrega un JOIN y una segunda fuente de verdad. Sí se crearon tablas donde la relación es 1:N (`MarkupOverrideRules`, `ApiQuotaSamples`, `M365IndexLogs`).

---

## 4. Acciones manuales pendientes

### Requieren tu intervención

1. **`terraform apply`** — el cambio de `async_poll = true` en `historical-gap-backfill` está en tu `terraform.tfvars` local, que está **gitignoreado**. Lo reflejé en `terraform.tfvars.example` (commit `0c8da43`), pero el apply es manual por directiva.

2. **Re-consentimiento de permisos en Entra ID** — se agregó `ExternalConnection.ReadWrite.OwnedBy` al script de onboarding (sólo Enterprise). Hasta que cada cliente lo consienta, crear el conector de Copilot M365 devuelve **403** con un mensaje que dice exactamente qué falta.

3. **`restore-test.yml`** — decidir si se migra a Container Apps Job o se elimina. Mientras tanto no hay prueba de restauración.

4. **Config global de IA rota** — apunta a `claude-haiku-4-5`, un deployment que **no existe** en el recurso. Los tenants con BYOK propio no la tocan, pero cualquiera que caiga al fallback global falla. Corregir en Configuración Global → IA.

5. **Los 15 días faltantes siguen faltando.** El código ahora los detecta y reintenta cada 15 min en vez de cada 6 h, pero no puede recuperarlos mientras Azure siga throttleando. Con el scope MG ya no desperdiciando cuota, vale reintentar.

### Estado inconsistente en la base

- El tenant `81ebe027-e6af-4e09-bc73-58c9012c6408` quedó con `sync_status = 'syncing'` y `last_sync_at = NULL`. No lo toqué por si había un proceso en vuelo. Si la UI muestra "Sincronizando…" indefinidamente, es esto.

---

## 5. Trabajo pendiente identificado

| Pendiente | Contexto |
|---|---|
| **Copilot M365 fases 2 y 3** | El servicio real de Graph está commiteado (`cca9ec5`), pero **las rutas API siguen apuntando al backend viejo**. El panel muestra `12.500` inventado, sólo que mejor pintado. Falta cablear rutas + refactor de UI. |
| Ambas tarjetas de Copilot M365 muestran el mismo dato | El panel reusa `config.indexedRecords` para el Graph Connector y para el Copilot Studio Agent, que son cosas distintas. |
| `mtd` y `forecast` sin fallback de scope | A diferencia de `historical` y `yesterday`, eligen el scope MG sin alternativa. Si el MG no sirve, fallan sin recuperación. |
| `POST /executive-report/jobs` sin snapshot | Recibe `metricsData` como `any` y no tiene consumidor en la UI. Documentado en el código. |
| Sensibilidad `STRICT` degradada | El ENUM en base es `('low','medium','high')`. `STRICT` se guarda como `high`; ampliarlo requiere su propia migración. |
| Cobertura parcial de quota tracking | Resource Graph queda cubierto entero (factory con 130 usos). Cost Management sólo en los call sites migrados. Sin muestras, el KPI dice "Sin medir". |

---

## 6. Cómo validar

```bash
npm run typecheck
npx eslint --quiet src/
npx vitest run
DB_HOST=127.0.0.1 DB_PORT=3307 npm run migrate
```

**MySQL local está en el puerto 3307**, no 3306. Sin `DB_PORT=3307` el runner falla con `ECONNREFUSED`.

Se agregaron **15 archivos de test**. Uno merece mención: `i18nKeyIntegrity.test.ts` recorre `src/`, extrae las 5719 claves referenciadas y verifica que existan en los tres idiomas. next-intl no falla en build ante una clave inexistente — renderiza el nombre crudo en pantalla. Ese test cierra la clase entera de bug.
