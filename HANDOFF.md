# Documento de Handoff — SaaS FinOps (CSCloudSolutions)

**Fecha:** 22 de Agosto de 2026  
**Rama de trabajo actual:** `staging`  
**Validación:** `npm run typecheck` ✅ 0 errores · `npm run lint` ✅ 0 errores / 2801 warnings (el CI corre con `--quiet`) · `npm run test` ✅ **1322 pasando**, 35 skipped · `npm run build` ✅ · migraciones aplicadas dos veces contra MySQL 8 real.

---

## 1. Resumen de Módulos y Cambios Principales

### A. Gobernanza de Etiquetas (Tag Governance Engine — `/governance/tags`)
1. **Auditoría Integral de Etiquetas y Políticas Globales**:
   - Evaluación en vivo de 4 políticas obligatorias (`Environment`, `Role`, `CostCenter`, `Department`).
   - Doble panel CMP: Auditoría de Recursos individuales y Auditoría de Grupos de Recursos (RG).
   - Inferencia inteligente de etiquetas con IA y autocompletado en 1-clic.
   - Herencia automática desde Resource Groups con política de Merge Seguro (no sobreescribe tags existentes).
   - Persistencia y actualización optimista inmediata en `LocalResourceTagsCache`.
   - 4 KPI Cards en escala estricta de azules (CERO naranja en números).

### B. Módulo de Limpieza de Nube (Cloud Waste Cleanup & Governance)
1. **Auditoría de Recursos Zombis y Huérfanos (`/cleanup/zombies`)**:
   - Omni-Scan de 25 tipos de recursos en Azure Resource Graph.
   - Clasificación en Hard Waste (impacto monetario) vs Soft Waste (gobernanza de tags).
   - Eliminación de sublíneas duplicadas en nombres de recursos.
   - Resolución dual de suscripciones (Management REST + Resource Graph) asegurando nombres legibles en toda la plataforma.

2. **Networking Zombies (`/cleanup/networking-zombies`)**:
   - Detección de VPN / ExpressRoute Gateways ociosos, IPs públicas huérfanas, Private Endpoints desconectados, NAT Gateways vacíos y Firewalls/App Gateways sin backends.
   - Diagnósticos específicos de Private Endpoints y playbooks de remediación en `z-[100]`.

3. **Time-To-Live (TTL) Enforcement (`/cleanup/ttl`)**:
   - Ciclo de vida y expiración de recursos efímeros de Sandbox y Dev/Test.
   - Tagging optimista con tag `ExpireOn`.
   - Semáforos (`CRITICAL`, `WARNING`, `ACTIVE`), prórrogas automáticas (+7d, +14d, +30d) y registro inmutable en `TtlDeletions`.

4. **Backups Huérfanos (`/cleanup/backup-orphans`)**:
   - Detección de instancias protegidas en Recovery Services Vaults cuyo recurso origen ya no existe en Azure.
   - Desglose de costo mensual (tarifa base + storage a $0.0224/GB).
   - Modal de purga con verificación estricta y aviso de Soft Delete de 14 días.
   - Drawer lateral de exención legal por compliance y modal para transferir a Archive (hasta 85% de ahorro).

### C. Estándar Obligatorio de Tablas CMP
- Redimensionamiento manual con `ResizableTh` (`col-resize`, 100px - 600px).
- Selector de columnas `Personalizar Columnas` (`IconColumns`) en `z-[100]`.
- Persistencia automática en `localStorage` por tenant y vista.
- Paleta 100% en tonos de azul empresarial (`#0078D4`, `#2563EB`, `#0284C7`, `#0054A6`), tipografía Montserrat `#1B2A41` y Tabler Icons sin fondos.


### D. Módulo de Gobernanza Operativa (refactor completo, 2026-08-22)

Seis páginas del módulo Gobernanza reconstruidas sobre la infraestructura existente. En cada caso el motor de
recolección ya existía y **no se duplicó**; lo que se agregó es la capa de dominio, los endpoints faltantes y
la UI, más la corrección de defectos de fondo.

| Página | Qué se agregó | Qué se corrigió |
|---|---|---|
| **Control de VMs** (`/governance/power`) | Motor de ahorro fuera de horario, resumen agregado, CPU en vivo, panel con programador y control masivo | Los tenants demo recibían 401: `/api/power` y `/api/power/schedule` no tenían rama mock |
| **Políticas Auto-Block** (`/governance/policies`) | Lectura real de `policyresources`, deploy y remediación de Azure Policy | La ruta anterior **fabricaba** el cumplimiento con `Math.floor(total * 0.25)` y caía al dataset demo en tres puntos del camino live |
| **Reporting de Gobernanza** (`/governance/reporting`) | Score de Seguridad Financiera ponderado, detección de SIDs huérfanos, export CSV/PDF | Guard antes del check de demo (401) y sin gate de tier pese a estar registrada como Enterprise |
| **Alta Disponibilidad** (`/governance/ha`) | Proyección de SLA a minutos de caída, costo de remediación, exenciones justificadas | Mismo problema de orden de guard y tier |
| **Credenciales Entra ID** (`/governance/credentials`) | Rotación vía Graph, reglas de alerta multi-umbral, dos pestañas | Mismo problema de orden de guard y tier |
| **Aprobaciones** (`/governance/approvals`) | Ejecución real en ARM, cuatro ojos, snapshot previo, traza de auditoría | **Aprobar sólo cambiaba el estado en MySQL**: el historial decía "Aprobado" y el recurso seguía facturando |

### E. Auditoría de cumplimiento del módulo de Limpieza

Seis desvíos encontrados, **tres dejaban la feature inoperante en tenants reales**. El más grave: tres paneles
no integraban MSAL, así que ni el GET ni ninguna de sus 12 mutaciones enviaban `Authorization: Bearer` y
devolvían 401 en todo tenant real — funcionaban únicamente en demo. Detalle en
[`docs/HANDOFF-2026-08-22.md`](docs/HANDOFF-2026-08-22.md) §3.

### F. Deuda registrada (no bloqueante)

- **Regla Cero parcial**: los servicios de limpieza suman costos con `number` + `.toFixed(2)` en vez de
  `decimal.js`. Patrón de 45 de los 57 servicios `azure*.service.ts`; sobre valores ya redondeados a dos
  decimales el error queda muy por debajo del centavo. Los servicios nuevos de gobernanza y analítica sí usan
  Decimal.
- **i18n**: los paneles nuevos tienen las cadenas embebidas en español (desvío de AGENTS.md #12). Misma deuda
  ya medida sobre el resto de los paneles; la paridad de claves de los tres diccionarios se mantiene.
- **Restricción reafirmada**: un componente cliente no puede importar de un servicio que toque la base de
  datos, ni siquiera una función pura alojada ahí — el grafo de imports arrastra `mysql2` al bundle del
  navegador. Lo detectó el build.

---

## 2. Infraestructura — inventario, saneo documental y pendiente abierto

Merge de `staging` a `main` (PR #109 → `b3b2abe`) con deploy verde: migraciones, revisión nueva y health
check en `success`. Después, inventario de Azure contrastado contra la documentación.

- **Suscripción `CSCloudSolution-Production` (`0beb7800`) dada de baja** — referencias eliminadas. **No
  confundir con el tenant `8b41364f`**, que sigue vigente como master tenant de la app y aparece en
  `superAdminBootstrap.ts`, `UsersPanel.tsx`, el naming de secretos del vault y `AZURE_TENANT_ID`.
- **Documentación que mandaba a recursos inexistentes** — el rollback de `deployment-guide.md` usaba
  `rg-cscs-finops-prod-us-core` / `ca-cscs-finops-prod-us-web`; los reales son `cscs-finops-prod-westus2-rg`
  / `-web`. Corregido. `infra/pipelines/` eliminado (plantillas superadas por los workflows vivos).
- **PENDIENTE ABIERTO — acceso público de los Key Vaults.** Terraform sabe cerrarlos, pero activarlo rompe
  el drift semanal y el apply: gestiona dos secretos en el plano de datos y los runners de GitHub no tienen
  ruta a la VNet. Opciones y costos en
  [`infra/docs/keyvault-network-hardening.md`](infra/docs/keyvault-network-hardening.md).
- **El repositorio es público** y `terraform.yml` dispara en `pull_request` sobre `infra/terraform/**`. Eso
  descarta el runner self-hosted dentro de la VNet y es el hallazgo de mayor impacto pendiente de decisión.

---

## 3. Documentación Detallada de Handoff
- **Documento extendido**: [`docs/HANDOFF-2026-08-22.md`](docs/HANDOFF-2026-08-22.md) — incluye la tabla completa de la auditoría de cumplimiento.
- **LLD**: [`docs/lld/00-lld-completo.md`](docs/lld/00-lld-completo.md) §29 — tabla de módulos, decisiones de modelado justificadas y cambios de esquema.
- **HLD**: [`docs/hld/00-hld-completo.md`](docs/hld/00-hld-completo.md) §12 — los dos dominios nuevos y el principio "prevenir antes que remediar".
- **Infra**: [`docs/lld/00-lld-completo.md`](docs/lld/00-lld-completo.md) §30 — inventario verificado de la suscripción y postura de red del Key Vault.
