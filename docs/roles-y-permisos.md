# Roles de negocio y permisos de dominio (2026-07-11, corregido 2026-07-12)

## Resumen

Se fusionaron las páginas "Usuarios y Licencias" y "Licencias" en una sola
(`/intelligence/licenses`, tier Professional, categoría Inteligencia
Financiera), y se creó un sistema de **etiquetas de página** que clasifica
todas las páginas del SaaS en 5 dominios.

**Corrección de diseño (2026-07-12):** el diseño original conflaba dos
conceptos distintos en un solo campo `role` (4 "roles de negocio" tipo
"Admin Cloud"). Se separaron en dos campos **ortogonales**, ambos
asignables al mismo usuario de forma independiente:

- **Rol** (`Users.role`) = **capacidad** — qué acciones puede ejecutar
  (Reader = solo ver, Colaborador/Admin/Owner = distintos niveles de
  modificar/eliminar).
- **Permisos** (`Users.permissions`, JSON) = **visibilidad de dominio** —
  qué páginas etiquetadas puede ver (FinOps, CloudAdmin, Security,
  ProductOwner), sin importar su rol.

Un usuario Reader con permiso `FinOps` puede *ver* las páginas de FinOps
pero no modificar ni eliminar nada en ellas. Un usuario Admin con permiso
`Security` puede ver y actuar en las páginas de Security. Los dos campos
se combinan, no se sustituyen.

## 1. Fusión de páginas

- `/overview/users-licenses` → redirige a `/intelligence/licenses`.
- `/intelligence/licenses` ahora usa `M365UsersBoard` (mismo componente que
  antes vivía solo en Users & Licenses) con **3 pestañas**:
  1. **Dashboard** — KPIs M365/Entra ID, donuts de actividad, top listas.
  2. **Actividad de Usuarios** — tabla filtrable de usuarios.
  3. **Optimización de Licencias** (nueva) — fusiona el contenido de la
     antigua página "Licencias": recursos sin Azure Hybrid Benefit (AHUB,
     vía Resource Graph) y métricas por SKU (vía Microsoft Graph
     `subscribedSkus`). Tablas con columnas redimensionables y paginación
     (directiva de tablas, ver memoria persistente).
- Tier: **Professional** (el que tenía "Licencias"; "Users & Licenses" tenía
  Business, se bajó al fusionar).

## 2. Etiquetas de página (`src/lib/pageRoleTags.ts`)

Cinco etiquetas (`RoleTag`), usadas para clasificar **páginas** (no
usuarios):

| Etiqueta | Semántica |
|---|---|
| **FinOps** | Páginas de costos y recomendaciones. |
| **CloudAdmin** | Páginas de ejecución/escritura sobre infraestructura. |
| **Security** | Páginas de auditoría de cumplimiento, credenciales y gobernanza. |
| **ProductOwner** | Páginas de visibilidad por Centro de Costos / aplicación. |
| **Platform** | Administración del SaaS (no es un dominio FinOps/Cloud/Seguridad). |

`PAGE_ROLE_TAGS` mapea las **70 rutas** del sidebar a 1+ etiquetas (una ruta
sin entrada cae a `Platform` por defecto — fail-closed, no fail-open).

Las etiquetas **no se muestran** en el Sidebar (son uso interno para
filtrado, no informativas para el usuario final).

### DIRECTIVA — toda página nueva debe etiquetarse

Al agregar una entrada nueva a `Sidebar.tsx.categories[].items`, agregar
también su `href` a `PAGE_ROLE_TAGS` en `src/lib/pageRoleTags.ts` en el
mismo cambio. Sin esto, la página cae a `Platform` (solo Admin/Owner la ven
si además tienen permisos asignados) aunque debiera ser visible para otro
permiso.

## 3. Rol (capacidad) — `Users.role`

Columna de texto libre, sin constraint. Jerarquía (de menor a mayor
capacidad): `Reader` < `Colaborador` < `Admin` < `Owner` (además de
`Operator`/`SuperAdmin` internos). Determina **qué puede hacer** el usuario
(ver vs. modificar/eliminar), independientemente de qué páginas puede ver.
Gestionado en `requireTenantRole(...)` en cada endpoint de escritura.

| Rol | Capacidad |
|---|---|
| `Reader` | Solo lectura de dashboards y reportes. No aplica cambios ni ve configuración sensible. |
| `Colaborador` | Ve inteligencia financiera y visibilidad; puede sugerir cambios, pero no administra facturación ni usuarios. |
| `Admin` | Visibilidad financiera completa, modificación de configuraciones, acciones correctivas (apagar VMs, eliminar recursos) y gestión de usuarios. |
| `Owner` | **Dueño del tenant.** Superset de Admin: acceso completo incluyendo cambio de plan y facturación. Es el contacto de billing/trial. |

**Asignación del rol `Owner`:**
- El **creador del tenant** (primer usuario, vía `/api/onboard`) recibe
  `Owner` automáticamente. Los usuarios siguientes entran como `Reader`.
- Promover a otro usuario a `Owner` (transferencia de propiedad) solo lo
  puede hacer un `Owner` existente o un `SuperAdmin` — un `Admin` no puede
  autopromoverse. Enforced en `/api/admin/config/users` (POST y PATCH) y en
  la UI (`/admin/users`, opción deshabilitada si `!canAssignOwner`).
- `Owner` se acepta en TODO gate donde se acepta `Admin`
  (`requireTenantRole([..., 'Admin', 'Owner'])`, chequeos `role === 'Admin'
  || role === 'Owner'`, y los JOINs SQL `role IN ('Admin','Owner')` de las
  alertas de billing/trial y la métrica de MFA de admins).

> **Nota de migración**: los tenants creados ANTES de este cambio tienen a su
> creador con rol `Admin` (no `Owner`) — siguen funcionando porque `Admin`
> conserva todas sus capacidades previas. Para que un tenant existente tenga
> un `Owner` real, un `SuperAdmin` (o el propio flujo de transferencia) debe
> promoverlo desde `/admin/users`.

## 4. Permisos (dominio) — `Users.permissions`

Columna `JSON` nullable, array de `RoleTag`. Determina **qué páginas
etiquetadas** puede ver el usuario en el Sidebar, independientemente de su
rol. Definidos en `ASSIGNABLE_PERMISSIONS` (`src/lib/pageRoleTags.ts`):

| Valor | Label en UI |
|---|---|
| `FinOps` | FinOps (Analista FinOps) |
| `CloudAdmin` | Cloud Admin |
| `Security` | Auditor de Seguridad |
| `ProductOwner` | Product Owner / Líder de Proyecto |

`parsePermissions(raw)` parsea y valida el JSON (tolera string o array,
descarta valores no reconocidos). `hasAnyTag(userPermissions, pageTags)`
determina si un usuario puede ver una página dada.

### Navegación (Sidebar)

El filtrado por permisos es **opt-in**: solo se aplica si el usuario tiene
≥1 permiso asignado **y** su rol no es `Admin`/`Owner` (estos dos roles ven
todo lo que su tier permite, sin importar permisos). Si el usuario no tiene
permisos asignados, no se filtra por dominio (compatibilidad con usuarios
existentes). `/` (Dashboard) y `/support` (Soporte) siempre son visibles.
El filtrado por permisos se aplica **encima** del filtrado por rol ya
existente (Reader/Colaborador con categorías restringidas), no lo
reemplaza. Implementado en `Sidebar.tsx` (`roleCategories`).

### Backend (autorización de API)

Los permisos de dominio **no** se usan para autorizar escritura en el
backend — eso sigue siendo responsabilidad exclusiva de `role` vía
`requireTenantRole([...])`. Los permisos solo controlan qué aparece en la
navegación. Los allow-lists de `requireTenantRole` en todos los endpoints
tocados durante el diseño original (que temporalmente incluían los 4
"roles de negocio" conflados) fueron revertidos a su estado original
(`['Admin','Owner']`, `['Admin','Owner','Reader','Colaborador']`, etc.) al
corregir el diseño — un usuario con permiso `CloudAdmin` pero rol `Reader`
puede *ver* las páginas de CloudAdmin, pero las llamadas de escritura
seguirán fallando con 403 salvo que su `role` lo autorice.

### API — `PUT /api/admin/config/users`

Acepta `role` y/o `permissions` como campos **independientes y opcionales**
en el body (junto a `tenantId`, `userId`); al menos uno debe estar
presente. Cada campo se actualiza solo si viene definido en el body — no
es necesario enviar ambos. `permissions: null` limpia los permisos
asignados.

### Límite conocido — NO implementado en este cambio

- **"Visibilidad restringida a su Centro de Costos" (permiso
  ProductOwner) — NO implementado a nivel de datos.** Existe la columna
  `Users.cost_center` (nullable) para guardar la asignación, pero ningún
  endpoint filtra resultados por ella todavía. Filtrar cada query de
  costos/recomendaciones por el cost center del usuario logueado es un
  trabajo de seguimiento más grande (toca decenas de endpoints).
- **El modal de importación masiva desde Entra ID no tiene UI de
  permisos.** Solo el formulario de alta manual y la tabla principal en
  `/admin/users` permiten asignar/editar permisos; los usuarios importados
  en bloque quedan sin permisos y se les puede asignar después desde la
  tabla principal.

## 5. Archivos tocados

- `src/lib/pageRoleTags.ts` — registro de etiquetas de página,
  `ASSIGNABLE_PERMISSIONS`, `parsePermissions`, `hasAnyTag`.
- `src/components/Sidebar.tsx` — filtrado por rol + permisos (sin badges).
- `src/components/TenantProvider.tsx` — `userPermissions` en el contexto.
- `src/app/[locale]/admin/users/page.tsx` — columna "Permisos" (toggles) en
  la tabla, selector de permisos en el alta manual; selectores de rol
  vueltos a solo Reader/Colaborador/Admin/Owner.
- `src/app/api/admin/config/users/route.ts` — GET/POST/PUT con
  `permissions` independiente de `role`.
- `src/modules/storage/db.ts` — columnas `Users.cost_center`,
  `Users.permissions`.
- Fusión de páginas: `intelligence/licenses/page.tsx`,
  `overview/users-licenses/page.tsx` (redirect),
  `components/dashboard/M365UsersBoard.tsx` (3ra pestaña).
