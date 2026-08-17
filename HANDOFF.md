# Documento de Handoff — SaaS FinOps (CSCloudSolutions)

**Fecha:** 16 de Agosto de 2026  
**Rama de trabajo actual:** `staging`  
**Estado de la rama:** Limpia (`working tree clean`), 20 commits por delante de `origin/staging` (pendiente de `git push` a solicitud explícita del usuario según Directiva #6).  
**Validación:** `npm run typecheck` ✅ (0 errores) | `npm run test` ✅ (71 test files pasados, 691 tests pasados).

---

## 1. Commits Realizados en la Sesión

A continuación se detalla la secuencia de commits granulares con trazabilidad Co-authored:

| Commit Hash | Tipo & Alcance | Descripción |
|---|---|---|
| `c3a715b` | `docs` | Sincronizar manuales de usuario/superadmin (ES, EN, PT-BR), LLD completo, inventarios generados y regenerar todos los PDFs tras el módulo Virtual Machines. |
| `5befa23` | `feat` | Cockpit resolutivo de **Virtual Machines FinOps CMP** (`/intelligence/computo/avm`) con desglose cómputo vs. storage, detección de fugas en VMs apagadas, AHUB, métricas operativas y 5 playbooks de remediación. |
| `5b711e0` | `fix(tenants)` | Eliminar tenants demo obsoletos (*ACME Cloud*, *Prueba AWS*, *Cliente ACME*) mediante migración SQL idempotente y script de purga. |
| `d721ec1` | `docs` | Actualizar README.md, manuales de usuario/superadmin y regenerar PDFs tras la implementación de Function Apps y App Services. |
| `32f2e23` | `feat(compute)` | Cockpit resolutivo de **Function Apps FinOps CMP** (`/intelligence/computo/fapps`) con detección determinista de hosting plans (Consumption, Elastic Premium, Dedicated, Flex Consumption), métricas de ejecución (GB-s), auditoría de storage/logs y remediaciones. |
| `36f2269` | `fix(compute)` | Inyección de token de autorización MSAL (`getFreshIdToken`) en `AppServiceFinopsCmpBoard` para resolver error 401 Unauthorized en llamadas API tenant-scoped. |
| `5b4a864` | `feat(compute)` | Cockpit de **App Services & Web Apps FinOps CMP** (`/intelligence/computo/waas`) con gobernanza de densidad de aplicaciones (App Density), slots activos y playbooks de consolidación (App Packing). |
| `66f60b7` | `feat(compute)` | Disclaimers arquitectónicos y guías de troubleshooting en modales de remediación de VMSS (Spot y OS Disk). |
| `9aef041` | `fix(compute)` | Corrección del playbook de degradación de disco OS en VMSS para evitar error `PropertyChangeNotAllowed` en Azure. |
| `a9d3494` | `fix(ui)` | Estandarización de popovers informativos (`InfoTooltip.tsx`) azul empresarial `#1B2A41` 100% responsivos con detección de colisiones en viewport. |

---

## 2. Resumen de Módulos y Cambios Principales

### A. Cockpit FinOps de Azure Virtual Machines (`/intelligence/computo/avm`)
- **Desglose de Costo de Cómputo vs. Storage Persistente**:
  - Detección del mayor vector de fuga en VMs desasignadas (`PowerState/deallocated`): el cómputo pasa a $0.00 pero los discos administrados (**OS Disk** Premium SSD y **Data Disks**) continúan facturándose al 100% mensual.
- **Licenciamiento Híbrido & Red**:
  - Detección de **Azure Hybrid Benefit (AHUB)** (`licenseType: 'Windows_Server'`) para ahorro del 40% en VMs Windows Server.
  - Detección de IP pública fija facturable asignada a la NIC.
- **Métricas de Azure Monitor**:
  - CPU % Promedio y Percentil 95 (P95).
  - Memoria RAM en uso real calculada: `((TotalMemory - AvailableMemory) / TotalMemory) * 100`.
  - Uptime porcentual e IOPS.
- **5 Playbooks Resolutivos de Remediación**:
  1. *Rightsizing Inteligente hacia Serie B Burstable* (`Standard_B2s` / `Standard_D2s_v5`).
  2. *Mitigación de Fuga de Disco en VM Desasignada* (Degradar tier a `Standard_LRS`).
  3. *Programación de Apagado (Dev/Test Schedule 8x5)* con 65% de ahorro en cómputo.
  4. *Activación de Azure Hybrid Benefit (AHUB)* para licencias Windows con Software Assurance.
  5. *Descarte / Snapshot de VM Abandonada* (Snapshot de archivo y eliminación de VM inactiva > 60d).
- **Modal de Remediación Multitecnología (`VmRemediationModal.tsx`)**:
  - Pestañas interactivas con comandos ejecutables en **Azure CLI**, **Terraform (IaC)**, **PowerShell** e **Impacto & Riesgo**.
- **Tabla Estándar CMP & Detalle en 3 Columnas**:
  - Card *Detalle por Recurso* (Identidad & Estado, Hardware & Storage, Métricas FinOps & Licencias).
  - Tabla de ancho completo `w-full` con filtros superiores, paginación 15/30/45/60 y columnas redimensionables (`ResizableTh`).

### B. Cockpit FinOps de Azure Function Apps (`/intelligence/computo/fapps`)
- **Hosting Plan & Runtime**:
  - Resuelve planes `Consumption (Y1)`, `Elastic Premium (EP1/EP2/EP3)`, `Dedicated (App Service Plan)` y `Flex Consumption`, eliminando valores "Unknown" o "N/A".
- **Métricas Serverless de Ejecución**:
  - `FunctionExecutionCount` (Invocaciones MTD) y `FunctionExecutionUnits` (Consumo en GB-Segundos).
- **Auditoría de Costos Ocultos & Dependencias**:
  - Storage Account vinculada (`AzureWebJobsStorage`) y facturación de telemetría de Application Insights.
- **Remediaciones**:
  - Downgrade a Consumption Y1, Adaptive Sampling al 20% en `host.json` (ahorro del 80% en logs), Detención de Apps Zombies y optimización de Queue Polling.

### C. Limpieza y Purga de Tenants Demo
- Creada migración idempotente `migrations/20260816-001-eliminar-tenants-demo-acme-aws.sql`.
- Creado script `scripts/delete-demo-tenants.ts`.
- Eliminados los tenants obsoletos: `demo-acme-cloud` (ACME Cloud), `demo-aws-test` (Prueba AWS) y `demo-cliente-acme` (Cliente ACME).

### D. Documentación Sincronizada y PDFs Regenerados
- `README.md`: Novedades de cómputo y changelog 2026-08-16.
- `MANUAL_DE_USUARIO.md` y `docs/manual/MANUAL_USUARIO_{ES,EN,PT-BR}.md`: Sincronizados con los nuevos cockpits.
- `docs/manual/MANUAL_SUPERADMIN_{ES,EN,PT-BR}.md`: Sincronizados con los nuevos cockpits.
- `docs/lld/00-lld-completo.md` y `docs/lld/generated/*`: Inventarios actualizados con `node scripts/generate-lld.mjs`.
- PDFs regenerados con Playwright:
  - `docs/lld/LLD-FinOps-CSCloudSolutions.pdf`
  - `docs/manual/MANUAL_USUARIO_{ES,EN,PT-BR}.pdf` (y en `public/manual/`)
  - `docs/manual/MANUAL_SUPERADMIN_{ES,EN,PT-BR}.pdf`

---

## 3. Mapa de Archivos Clave

```
├── directivas/
│   ├── virtual_machines_finops_cmp_SOP.md      # SOP de arquitectura y remediación de VMs
│   ├── function_apps_finops_cmp_SOP.md         # SOP de arquitectura y remediación de Function Apps
│   └── app_services_finops_cmp_SOP.md          # SOP de App Services y densidad
├── src/
│   ├── lib/
│   │   └── computeWorkloadTypes.ts             # Tipos TypeScript de Compute Workloads
│   ├── app/
│   │   ├── api/intelligence/compute/workloads/route.ts  # Endpoint unificado de cómputo
│   │   └── [locale]/intelligence/computo/
│   │       ├── avm/page.tsx                    # Página de Virtual Machines Cockpit
│   │       ├── fapps/page.tsx                  # Página de Function Apps Cockpit
│   │       └── waas/page.tsx                   # Página de Web Apps / App Services
│   └── components/
│       ├── InfoTooltip.tsx                     # Popovers institucionales #1B2A41 responsivos
│       └── dashboard/
│           ├── VmFinopsCmpBoard.tsx            # Tablero FinOps de Virtual Machines
│           ├── VmRemediationModal.tsx          # Modal de remediación técnica de VMs
│           ├── FunctionAppFinopsCmpBoard.tsx   # Tablero FinOps de Function Apps
│           ├── FunctionAppRemediationModal.tsx # Modal de remediación de Function Apps
│           └── AppServiceFinopsCmpBoard.tsx    # Tablero FinOps de App Services
├── messages/
│   ├── es.json                                 # Strings en Español (con VmFinopsCmp)
│   ├── en.json                                 # Strings en Inglés (con VmFinopsCmp)
│   └── pt-BR.json                              # Strings en Portugués (con VmFinopsCmp)
└── migrations/
    └── 20260816-001-eliminar-tenants-demo-acme-aws.sql # Migración de purga de demo tenants
```

---

## 4. Estado de los Estándares de Diseño y Reglas del Proyecto

- **Regla #12 (i18n Paritario):** 100% de paridad de keys entre `es.json`, `en.json` y `pt-BR.json`.
- **Regla #18 (Marca):** Nombre oficial **CSCloudSolutions** sin espacios.
- **Regla #19 (Estándar Tablas CMP):** Filtros superiores, columnas base obligatorias (Recurso, Región, Tipo/SKU, RG, Suscripción), orden A-Z/Z-A/costo, paginado 15/30/45/60, resize y ancho completo `w-full`.
- **Regla #20 (Colores y Tipografías):** Títulos en azul profundo `#1B2A41` (`font-family: Montserrat`), azul de acción `#0054A6`, cian `#00AEEF`, e iconos oficiales de Tabler Icons (`@tabler/icons-react`).
- **Regla #21 (Botones Corporativos Clicables):** Fondo blanco puro (`bg-white` / `dark:bg-slate-900`), forma rectangular suave (`rounded-lg`), y color de borde exterior idéntico al texto/icono.
- **Regla #22 (Popovers Informativos):** Componente `InfoTooltip.tsx` con fondo `#1B2A41`, texto blanco nítido, sombra `shadow-2xl` y posicionamiento dinámico anti-colisión.

---

## 5. Siguientes Pasos Recomendados para el Siguiente IDE / Agente

1. **Revisión del Módulo Azure Red Hat OpenShift (ARO) (`/intelligence/computo/arhos`):**
   - Actualmente es la única pestaña del hub de cómputo que utiliza el componente base. Se puede aplicar el mismo patrón resolutivo (nodos master/worker, métricas de utilización de clúster, y remediaciones de reserved instances).
2. **Push a `staging` y Deploy:**
   - Cuando el usuario lo instruya, ejecutar `git push origin staging` para disparar el CI/CD en GitHub Actions.
