# Residencia de datos — qué falta para que sea real

## Dónde está el producto hoy

Más avanzado de lo que parece. Ya existe:

- `Tenants.data_residency` — `ENUM('EU','US','LATAM','APAC','GLOBAL')`.
- `DataResidencyChanges` — auditoría de cada cambio, con usuario y motivo.
- `data_residency_locked_at` — bloqueo que sólo un SUPERADMIN destraba.
- `src/modules/storage/regionPool.ts` — `getTenantPool(region)` y
  `resolveTenantPool(tenantId)`, con **todas las regiones apuntando al mismo
  pool**.
- La UI en `/admin/data-residency`, hoy fuera del Sidebar.

Y `docs/data-residency.md` es honesto sobre el límite: *"la región declarada es
una señal de compliance/auditoría, no una garantía técnica"*.

## Qué agrega esta infraestructura

El módulo `stamp` es la celda regional completa: app, MySQL, Redis, Key Vault,
Blob, jobs y logs. La clave del mapa `stamps` **es** el valor de
`Tenants.data_residency` que ese stamp atiende.

```hcl
stamps = {
  us = { location = "westus2",    ... }
  eu = { location = "westeurope", ... }   # el segundo despliegue físico
}
```

## Los tres cambios de aplicación que faltan

Con un segundo stamp desplegado:

| # | Cambio | Dónde | Tamaño |
|---|---|---|---|
| 1 | `POOL_BY_REGION` deja de apuntar todo al mismo pool | `regionPool.ts` | ~10 líneas |
| 2 | Las queries pasan a `resolveTenantPool(tenantId)` en vez del pool global | transversal | el grande |
| 3 | El login redirige al stamp del tenant | middleware | ~30 líneas |

El punto 2 es el trabajo real y no hay que subestimarlo: son 48 tablas y
docenas de rutas que hoy importan `pool` directo. La abstracción existe, pero
usarla en todos lados es una refactorización, no un flag.

Un cuarto punto que no está en el roadmap del repo y conviene agregar: **un
guard que rechace servir un tenant cuya `data_residency` no coincida con la
región del stamp**. Sin eso, si el ruteo falla, la app sirve datos de la región
equivocada en silencio. Con eso, devuelve 404 — que es lo que convierte la
residencia en una invariante verificable en vez de una promesa.

## Qué exige el GDPR y qué exige el cliente

- El GDPR **no** exige que los datos se queden en la UE: exige base legal para
  la transferencia (Cap. V). **Argentina tiene decisión de adecuación**
  (Art. 45), así que operar desde Argentina no es el problema.
- **EE.UU. no la tiene en general**: hace falta el EU-US Data Privacy Framework
  (Microsoft está adherido) o SCCs + Transfer Impact Assessment. Desplegar en
  West US 2 **no** es ilegal, pero sí es lo que hay que poder explicar en un
  cuestionario de seguridad.
- Los compradores enterprise europeos piden residencia en la UE igual. Es un
  requisito **comercial**, y para vender es igual de vinculante.

Lo que sí evita multas y hoy no existe: registro de actividades de tratamiento
(Art. 30), DPIA (Art. 35 — este producto hace monitoreo sistemático), y el
flujo de derechos del interesado en un mes (Art. 12(3)). Es documentación, no
infraestructura, y es más urgente que el stamp europeo.

## Consecuencia inmediata del cambio de región

`docs/data-residency.md` declara hoy: *"sólo operamos un datacenter real (Azure
Brazil South)"*, y la tabla de subprocesadores lista Brazil South para LATAM.
Desplegar en West US 2 lo vuelve falso. Ese documento está enlazado desde
`/legal/subprocessors` y el DPA, así que hay que actualizarlo **antes** del
corte — es una declaración con efecto contractual, no una nota interna.
