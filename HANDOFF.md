# Documento de Handoff — SaaS FinOps (CSCloudSolutions)

**Fecha:** 22 de Agosto de 2026  
**Rama de trabajo actual:** `staging`  
**Validación:** `npm run typecheck` ✅ (0 errores) | `npm run test` ✅ (20/20 unit tests pasados) | `npm run lint -- --quiet` ✅ (0 errores).

---

## 1. Resumen de Módulos y Cambios Principales

### Módulo de Limpieza de Nube (Cloud Waste Cleanup & Governance)
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

5. **Estándar Obligatorio de Tablas CMP**:
   - Redimensionamiento manual con `ResizableTh` (`col-resize`, 100px - 600px).
   - Selector de columnas `Personalizar Columnas` (`IconColumns`) en `z-[100]`.
   - Persistencia automática en `localStorage` por tenant y vista.
   - Paleta 100% en tonos de azul empresarial, tipografía Montserrat `#1B2A41` y Tabler Icons sin fondos.
