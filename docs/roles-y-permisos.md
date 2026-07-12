# Roles de negocio y etiquetas de página (2026-07-11)

## Resumen

Se fusionaron las páginas "Usuarios y Licencias" y "Licencias" en una sola
(`/intelligence/licenses`, tier Professional, categoría Inteligencia
Financiera), y se creó un sistema de **etiquetas de rol** que clasifica
todas las páginas del SaaS en 5 dominios, junto con **4 roles de negocio
nuevos** que Sidebar usa para filtrar la navegación.

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
     (directiva de tablas, ver más abajo).
- Tier: **Professional** (el que tenía "Licencias"; "Users & Licenses" tenía
  Business, se bajó al fusionar).

## 2. Etiquetas de página (`src/lib/pageRoleTags.ts`)

Cinco etiquetas (`RoleTag`):

| Etiqueta | Semántica |
|---|---|
| **FinOps** | Visibilidad de costos y recomendaciones — sin permisos de ejecución. |
| **CloudAdmin** | Permisos de ejecución y escritura sobre infraestructura. |
| **Security** | Auditoría de cumplimiento, credenciales y gobernanza. |
| **ProductOwner** | Visibilidad restringida a su Centro de Costos / aplicación. |
| **Platform** | Administración del SaaS (no es un dominio FinOps/Cloud/Seguridad). |

`PAGE_ROLE_TAGS` mapea las **70 rutas** del sidebar a 1+ etiquetas (una ruta
sin entrada cae a `Platform` por defecto — fail-closed, no fail-open).
Verificado con un chequeo cruzado automatizado: ninguna ruta del sidebar
quedó sin etiqueta.

Sidebar muestra un **badge de color** junto a cada link con su etiqueta
primaria (hover muestra todas si tiene más de una).

### DIRECTIVA — toda página nueva debe etiquetarse

Al agregar una entrada nueva a `Sidebar.tsx.categories[].items`, agregar
también su `href` a `PAGE_ROLE_TAGS` en `src/lib/pageRoleTags.ts` en el
mismo cambio. Sin esto, la página cae a `Platform` (solo Admin/Owner la ven)
aunque debiera ser visible para otro rol.

## 3. Roles de negocio nuevos

Se agregaron 4 valores a `Users.role` (columna de texto libre, sin
constraint — no requirió migración de esquema):

| Rol (valor en DB) | Etiqueta que ve | Semántica del enunciado original |
|---|---|---|
| `Analista FinOps` | FinOps | Visibilidad de recomendaciones, sin permisos de ejecución. |
| `Admin Cloud` | CloudAdmin | Permisos de ejecución y escritura. |
| `Auditor de Seguridad` | Security | — |
| `Product Owner` | ProductOwner | Visibilidad restringida a su Centro de Costos. |

Se agregaron como opción en los 3 selectores de rol de
`/admin/users` (asignación individual, importación desde Entra ID, edición
en tabla).

### Navegación (Sidebar)

Un usuario con uno de estos 4 roles ve **solo** las páginas etiquetadas con
su dominio, más `/` (Dashboard) y `/support` (Soporte) siempre visibles
para orientación. Implementado en `Sidebar.tsx` (`roleCategories`).

### Backend (autorización de API)

- **Endpoints de ejecución/escritura** explícitamente pedidos para
  CloudAdmin (Aprobaciones de Remediación, Horarios de Apagado, Políticas
  Auto-Block, Alta Disponibilidad) ahora aceptan el rol `Admin Cloud` en su
  `requireTenantRole([...])`.
- **Endpoints de lectura** que ya estaban abiertos a cualquier miembro del
  tenant (`['Admin','Owner','Reader','Colaborador']`) se extendieron para
  incluir los 4 roles nuevos, ya que Sidebar ya les muestra esas páginas
  (Licencias, Billing/Consumo Real, Rightsizing, Chargeback, Locations,
  PowerBI export).

### Límite conocido — NO implementado en este cambio

- **No es una revisión exhaustiva de cada endpoint del SaaS.** Endpoints
  puramente administrativos (facturación del SaaS, SSO, cuentas AWS,
  workbooks, MCP keys, etc.) siguen restringidos a Admin/Owner — correcto,
  ya que estos roles nuevos no deben gestionar la plataforma, pero si en el
  futuro se identifica un endpoint de lectura legítimo que un rol nuevo
  necesite y no tenga, hay que agregarlo puntualmente (mismo patrón que los
  arriba).
- **"Visibilidad restringida a su Centro de Costos" (Product Owner) —
  NO implementado a nivel de datos.** Se agregó la columna
  `Users.cost_center` (nullable) para guardar la asignación, pero **ningún
  endpoint filtra resultados por ella todavía**. Filtrar cada query de
  costos/recomendaciones por el cost center del usuario logueado es un
  trabajo de seguimiento más grande (toca decenas de endpoints) — hoy el
  rol Product Owner tiene visibilidad de navegación restringida (solo ve
  Scorecard, AI Cost Analytics, Academia FinOps) pero, dentro de esas
  páginas, ve los datos de todo el tenant, no solo los de su cost center.
- **"Sin permisos de ejecución" para Analista FinOps no está bloqueado a
  nivel de UI/botón.** La restricción real es de navegación (no puede
  llegar a páginas de ejecución) y de backend (los endpoints de escritura
  no lo incluyen en su allow-list, así que una llamada directa a la API
  fallaría con 403) — pero si alguna página FinOps tiene un botón de acción
  visible, no se auditó botón por botón para ocultarlo.

## 4. Archivos tocados

- `src/lib/pageRoleTags.ts` (nuevo) — registro de etiquetas.
- `src/components/Sidebar.tsx` — badges + filtrado por rol.
- `src/app/[locale]/admin/users/page.tsx` — opciones de rol en los 3 selectores.
- `src/modules/storage/db.ts` — columna `Users.cost_center`.
- Backend: `power/schedule`, `power`, `admin/governance-policies`,
  `governance/ha`, `remediation`, `remediation/downgrade` (ejecución);
  `intelligence/chargeback`, `intelligence/licenses`,
  `intelligence/rightsizing`, `intelligence/billing`,
  `intelligence/export/powerbi`, `locations` (lectura).
- Fusión de páginas: `intelligence/licenses/page.tsx`,
  `overview/users-licenses/page.tsx` (redirect),
  `components/dashboard/M365UsersBoard.tsx` (3ra pestaña).
