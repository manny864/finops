# Directivas Globales del Proyecto

## Restricciones y Patrones Estrictos

### 1. Nunca usar código hardcodeado (Hardcoded Data)
**Regla:** Queda terminantemente prohibido utilizar datos de prueba, *mock data* o valores estáticos *hardcodeados* en los componentes del Frontend o en la lógica del Backend que se ponga en producción, independientemente de si se solicita un "prototipo rápido" o la directiva de "Token Optimization Mode".
- **Por qué falló antes:** En el módulo de *Green FinOps (Sustainability)* se inyectaron valores estáticos (`730 * 10`) para simular consumo, lo que provocó que la interfaz no reaccionara a los cambios de Tenant o Suscripción, causando frustración en el usuario.
- **En su lugar hacer:** Toda métrica, por más preliminar que sea el módulo, DEBE estar respaldada por un endpoint de API que lea datos dinámicos (vía Azure Resource Graph, Cost Management o Bases de Datos), aunque la fórmula de cálculo sea básica o una estimación inicial.

### 2. Protocolo Estricto de Migración de Base de Datos
**Regla:** Todos los agentes (Frontend, Backend, DBA) que modifiquen esquemas de base de datos deben seguir rigurosamente el protocolo "STRICT DATABASE MIGRATION PROTOCOL".
- **Referencia:** Ver `directivas/agent_dba_SOP.md` para los detalles.
- **Acción Obligatoria:** Siempre se debe incluir el script `-- PRODUCTION DB MIGRATION SCRIPT ---` al final de la respuesta si se modifican estructuras (tablas, columnas, índices, restricciones). Las migraciones locales deben ser siempre seguras (`ALTER TABLE` con `try/catch`).

### 3. Documentación Obligatoria Post-Fix
**Regla:** Queda terminantemente prohibido dar por terminada la corrección de un bug o la implementación de una característica sin actualizar la documentación del proyecto.
- **Acción Obligatoria:** Después de cada fix o despliegue exitoso a staging/producción, SE DEBEN actualizar el `README.md` (sección Recent Major Updates) y el `MANUAL_DE_USUARIO.md` (si la corrección o característica afecta el flujo de usuario o los requisitos del sistema).

---

## 4. Directivas Maestras Obligatorias Comunes para Todos los Prompts

1. **Política de Acceso, Autenticación y Enrutamiento (Prevención Error 401):**
   - El backend DEBE implementar una validación de RBAC estricta mediante `requireTenantAccess(req, tenantId)` y tokens OAuth válidos antes de cualquier consulta a las APIs de Azure.
   - **Tenant Demo** (`isMockTenant === true` o `mock=true` o prefijo `demo-`/`mock-`): Servir datos sintéticos inmediatamente sin requerir autenticación OAuth ni tokens de Entra ID.
   - **ORDEN CRÍTICO:** El check `isMockTenant` DEBE evaluarse **ANTES** de `requireTenantAccess`. Nunca al revés.
   - **Tenant Real / Conectado:** Validación obligatoria de RBAC. **Tolerancia cero a fallbacks mock**: Si una consulta a Azure devuelve datos vacíos (`[]` o `$0.00`), la UI DEBE renderizar el estado real ($0.00 / Empty state legítimo). Prohibido inyectar mocks como rescate visual en un tenant real. Consumir exclusivamente endpoints vivos (ARG, Cost Management / FOCUS, Monitor).
   - **Prevención de Carrera de Hidratación MSAL (Error 401 a los 11ms):** El frontend DEBE condicionar el fetcher (`canFetch`) a que `inProgress === 'none'` y `(accounts.length > 0 || isDemo)` antes de despachar peticiones autenticadas.

2. **Lectura Correcta de Métricas de Costos (MTD, Anterior, Forecast):**
   - El backend DEBE consultar Cost Management (FOCUS dataset o Amortized Cost) mapeando `PreTaxCost` para MTD, gasto acumulado de los mismos días del mes anterior, y cálculo de `ML Forecast` para el cierre de mes por recurso individual para evitar registros en `$0.00` erróneos.

3. **Directiva de Ancho Máximo de Ventana (Full-Width 100%):**
   - El layout principal, contenedores de KPIs, gráficas, paneles de conectores y tablas DEBEN ocupar el ancho máximo de la ventana (`w-full max-w-full px-4 sm:px-6 lg:px-8`). Prohibido aplicar restricciones rígidas como `max-w-5xl`, `max-w-6xl` o `max-w-7xl`.

4. **Política de Iconografía Corporativa (Tabler Icons):**
   - Librería exclusiva `@tabler/icons-react`, color azul empresarial (`text-[#0078D4]` / `text-[#0054A6]`), trazo limpio (stroke 1.5/2), **estrictamente sin fondo** (`bg-transparent`).

5. **Gestión de Capas (Z-Index y Popovers):**
   - Modales y Drawers: backdrop `fixed inset-0 bg-black/50 z-50` y contenedor en `z-50` o `z-[100]`. Widgets flotantes (como el chat) deben permanecer en `z-40` o inferior.

6. **Diseño de Interfaz y Paleta en Tonos de Azul:**
   - Contenedores y KPI Cards: Fondos neutros limpios (`bg-white` o `bg-slate-50/50`) con bordes sutiles (`border border-slate-200`). Eliminar fondos verdes o amarillos planos.
   - Gráficas y barras de desglose (Recharts): Escala armónica en tonos de azul: Base/Real (`#0078D4`), Secundario/Forecast (`#2563EB`), Intermedio (`#0284C7`), Acento suave (`#38BDF8`), Neutral (`#94A3B8`).

7. **Preservación Estricta de Módulos y Botones Corporativos:**
   - Preservar todas las sub-pestañas y funcionalidades existentes.
   - Botones de acción corporativos: Fondo blanco puro (`bg-white dark:bg-slate-900`) con borde y texto coincidente según el estándar de la plataforma.
