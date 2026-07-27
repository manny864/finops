# Política de datos al bajar de tier con dos proveedores

> **Estado**: implementada.
> **Resuelve**: riesgo abierto #7 de [`aws-multicloud-handoff.md`](./aws-multicloud-handoff.md) —
> *"No está definido qué pasa con los datos del proveedor que se pierde cuando un
> Enterprise con `provider = 'both'` baja de tier."*

---

## 1. El problema

Solo Enterprise puede tener Azure y AWS a la vez (`Tenants.provider = 'both'`).
Cuando un tenant así baja a Business o menos, pierde el derecho a uno de los dos.
La pregunta es qué pasa con los datos ya ingeridos del proveedor que se cae:
`CostSnapshots`, `FocusLineItems` (grain recurso/hora) y, si el que se cae es
AWS, las credenciales de `AwsAccounts`.

Las tres respuestas ingenuas están mal:

| Respuesta ingenua | Por qué falla |
|---|---|
| Borrar en el downgrade | El downgrade llega por un **webhook asíncrono** de Paddle/Marketplace. No hay nadie mirando una pantalla que pueda confirmar un borrado masivo e irreversible. |
| Retener para siempre | `FocusLineItems` son millones de filas por cuenta por mes (riesgo #2 del handoff). Retención infinita de un proveedor que el tenant ya no paga es costo puro. |
| Dejarlo indefinido | Es el estado actual: el tenant sigue sincronizando y pagándole a Cost Explorer USD 0.01 por request por un proveedor que ya no contrató, y `provider` queda en `'both'` para un tier que no lo permite. |

Además hay un caso frecuente que cualquier política tiene que sobrevivir: el
**downgrade transitorio**. Una tarjeta rechazada baja el plan y se resuelve en
horas. Borrar datos ahí sería destruir la información de un cliente que vuelve.

---

## 2. La decisión

**Archivado reversible con ventana de gracia. El downgrade nunca borra datos en
el acto.**

```
                        ┌──────────────────────────────────────┐
   Enterprise           │  downgrade (webhook / PATCH admin)   │
   provider='both'  ────┤  → elige proveedor a RETENER         │
                        │  → el otro pasa a ARCHIVADO          │
                        └───────────────┬──────────────────────┘
                                        │
                        ┌───────────────▼──────────────────────┐
                        │  GRACE — 90 días                     │
                        │  · datos intactos                    │
                        │  · ingesta CORTADA                   │
                        │  · export FOCUS ABIERTO              │
                        │  · avisos en T-30 y T-7              │
                        └───────┬──────────────────┬───────────┘
                                │                  │
              vuelve a Enterprise│                  │vence el plazo
                                │                  │
                    ┌───────────▼──────┐   ┌───────▼────────────┐
                    │ RESTORED         │   │ PURGED             │
                    │ cero pérdida     │   │ borrado auditado   │
                    └──────────────────┘   └────────────────────┘
```

### Lo que se corta de inmediato (T0)

- **La ingesta**, que es donde está el costo real. Cost Explorer cobra USD 0.01
  por request; cuenta deshabilitada = cero requests = cero costo. Esto es lo que
  hace que bajar de plan tenga efecto económico **sin** borrar nada.
- Las cuentas AWS quedan con `disabled_at` / `disabled_reason`. Las rutas de
  sync y el alta de cuentas nuevas devuelven **409** con un mensaje accionable.

### Lo que se conserva durante la gracia

- **Todos los datos históricos** del proveedor archivado.
- **Las credenciales** (`role_arn`, `external_id_encrypted`). No se borran hasta
  la purga: obligar a un re-onboarding completo (crear de nuevo el rol IAM en la
  cuenta del cliente) a alguien que volvió a Enterprise a los tres días es
  fricción gratuita. Sin sync activo, una credencial parada no genera gasto.
- **El export FOCUS**, incluso si el tier ya no lo habilita → §4.

### Lo que se borra al vencer la gracia

`FocusLineItems`, `CostSnapshots` y, si el archivado era AWS, las filas de
`AwsAccounts` con sus credenciales. Todo queda asentado en `ActionLogs`
(`PROVIDER_DATA_PURGED`) con el conteo de filas por tabla.

---

## 3. Por qué 90 días

Es un cierre trimestral completo. El caso real es el cliente que baja de plan en
enero y en abril necesita el Q1 entero para cerrar el ejercicio contable.

No es reconstruible después: Cost Explorer retiene 12-14 meses y el CUR depende
de que el bucket S3 del cliente siga existiendo, cosa que no controlamos.

Configurable con `PROVIDER_ARCHIVE_RETENTION_DAYS`. El valor se **clampea** entre
7 y 730 días en vez de rechazarse: lo consumen un webhook y un cron, y una
variable de entorno mal escrita no puede hacer que el sistema purgue mañana ni
que retenga para siempre.

---

## 4. Portabilidad: el export queda abierto

Durante la ventana de gracia, `GET /api/exports/focus` **acepta al tenant aunque
su tier ya no sea Enterprise**, siempre que tenga una transición abierta y siga
exigiendo rol `ADMIN`/`OWNER`.

Sin esta excepción, bajar de plan equivaldría a secuestrarle los datos al
cliente: se le avisa que en 90 días se borran, pero no se le da forma de
llevárselos. Además de ser mal producto, choca con el derecho de portabilidad
(GDPR art. 20). El único caso en que se le puede borrar información a un cliente
es después de haberle dado una vía real para retirarla.

---

## 5. Quién elige qué proveedor se conserva

El downgrade llega por webhook: no hay nadie a quien preguntarle en ese
instante. Hace falta un default determinista.

**Elección automática** (`autoElectRetainedProvider`), en orden:

1. Mayor **gasto** en los últimos 90 días — donde el cliente gasta más es donde
   el producto le sirve más.
2. Más **cuentas conectadas** — más trabajo de onboarding invertido.
3. `azure` — default histórico de la columna y de todos los tenants previos.

La comparación de gasto usa `Decimal`, nunca `number` (Regla Cero). Cuando el
resultado de una comparación es *"cuál de estos dos datasets se borra"*, una
diferencia de centavos no puede resolverse por error de coma flotante.

**La elección automática no es definitiva.** Durante toda la ventana, un
`ADMIN`/`OWNER` puede invertirla desde `POST /api/admin/provider-transition`.
Invertir no borra nada (todavía no se borró nada) y **no reinicia el reloj**: la
fecha límite la fija el downgrade, no la elección. Si reiniciara, un tenant
podría alternar la elección indefinidamente y retener gratis para siempre.

---

## 6. Reversibilidad

Volver a un tier con derecho a los dos proveedores **antes** de la purga
restaura todo automáticamente, sin intervención: `provider` vuelve a `'both'`,
la transición pasa a `RESTORED`, la ingesta se reanuda y no se perdió un solo
registro. Es el caso que justifica que exista la ventana entera.

Después de la purga no hay vuelta: la restauración requiere re-onboarding y los
datos históricos no se recuperan. Por eso los dos recordatorios previos.

---

## 7. Implementación

| Pieza | Archivo |
|---|---|
| Política pura (sin I/O, testeable) | `src/lib/providerPolicy.ts` |
| Efectos y transiciones | `src/services/providerLifecycleService.ts` |
| Esquema | `migrations/20260725-005-provider-archive.sql` |
| Cron de avisos + purga | `src/app/api/cron/provider-archive-purge/route.ts` |
| Estado + cambio de elección | `src/app/api/admin/provider-transition/route.ts` |
| Tests | `__tests__/unit/providerPolicy.test.ts` |

### Choke point

`applyTierChange()` es el **único** punto que reconcilia el modelo de proveedor,
y lo llaman los cuatro lugares que escriben `Tenants.tier`:

- `src/app/api/webhooks/paddle/route.ts` (created + updated)
- `src/app/api/webhooks/marketplace/azure/route.ts` (`ChangePlan`)
- `src/app/api/webhooks/marketplace/aws/route.ts` (`subscribe-success`)
- `src/app/api/admin/tenants/route.ts` (PATCH de superadmin)

Antes de esto, bajar de tier no tenía **ningún** side-effect. Cualquier vía
nueva de cambio de tier debe pasar por acá o el estado queda incoherente.

Es idempotente: reprocesar un webhook no abre una segunda transición, porque la
decisión se evalúa sobre el estado actual (`provider` ya no es `'both'`) y no
sobre el tier previo.

### Trampa de `ProviderName` (importante para la purga)

`CostSnapshots.ProviderName` se agregó tarde
(`ADD COLUMN ProviderName VARCHAR(100) DEFAULT 'Azure'`) y las filas Azure
históricas quedaron con `NULL` o con `'Azure'` indistintamente. El mapper de AWS,
en cambio, siempre escribe exactamente `'AWS'`.

Consecuencia: **filtrar Azure por `ProviderName = 'Azure'` deja filas sin
purgar**, y filtrar AWS por "distinto de Azure" borra filas legacy. La única
lectura segura en ambas direcciones es anclar en `'AWS'`, que sí es confiable:

```sql
-- archivado = aws
ProviderName = 'AWS'
-- archivado = azure
(ProviderName IS NULL OR ProviderName <> 'AWS')
```

Está centralizado en `providerPredicate()`. No reimplementar el filtro a mano.

### Purga por lotes

Se borra en lotes de 5.000 filas con transacciones cortas por tabla. Un `DELETE`
plano sobre `FocusLineItems` puede ser de millones de filas y bloquear la tabla
el tiempo suficiente para tumbar el sync de todos los demás tenants.

---

## 8. RBAC

| Operación | Guard mínimo | Por qué |
|---|---|---|
| `GET /api/admin/provider-transition` | `requireTenantAccess` | Cualquier miembro necesita ver que hay una cuenta regresiva, para no perder datos por sorpresa. |
| `POST /api/admin/provider-transition` | `requireTenantRole(['ADMIN','OWNER'])` | Define qué dataset se borra en N días. Es decisión de titularidad, no de consulta. |
| `POST /api/aws/accounts`, sync AWS | `requireTenantRole(['ADMIN','OWNER'])` + `requireTenantTier('Enterprise')` + `assertProviderIngestable` | El tier solo no alcanza: un Enterprise puede ser `'azure'` puro o tener AWS archivado. |
| `GET /api/cron/provider-archive-purge` | `Authorization: Bearer $CRON_SECRET` | No es tenant-scoped y no lee `tenantId` del cliente. |

`ProviderDisabledError` (409) se distingue a propósito de `AuthError` (403): no
es un problema de permisos del usuario sino un estado del tenant, y el mensaje
tiene que explicar cómo recuperarlo.

---

## 9. Operación

Agregar al crontab del VPS (diario; los avisos T-30/T-7 son idempotentes):

```cron
0 5 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  https://finops.cscloudsolutions.com.ar/api/cron/provider-archive-purge \
  >> /var/log/finops-cron.log 2>&1
```

Auditoría — todo cambio queda en `ActionLogs` con `resource_type='tenant_provider'`:
`PROVIDER_ARCHIVED`, `PROVIDER_ELECTION_CHANGED`, `PROVIDER_RESTORED`,
`PROVIDER_DATA_PURGED` (con el conteo de filas borradas por tabla).

```sql
-- Tenants con una cuenta regresiva abierta
SELECT tenant_id, archived_provider, retained_provider, purge_at,
       DATEDIFF(purge_at, UTC_TIMESTAMP()) AS dias_restantes
  FROM TenantProviderTransitions
 WHERE status = 'GRACE' ORDER BY purge_at;

-- Qué se borró y cuánto
SELECT tenant_id, archived_provider, resolved_at, purged_rows
  FROM TenantProviderTransitions WHERE status = 'PURGED';
```

---

## 10. Pendiente (Fase 3 / Fase 7)

- **Banner de UI** con la cuenta regresiva y el selector para invertir la
  elección, consumiendo `/api/admin/provider-transition`. Requiere i18n en
  `messages/{es,en,pt-BR}.json`.
- Los emails y notificaciones in-app se generan hoy en español, igual que el
  resto de las plantillas de `emailHelper.ts`. Internacionalizarlas es un
  trabajo transversal a todas las plantillas, no específico de esta política.
