# Contexto Global: SaaS FinOps (CSCloudSolutions)

- **Stack:** Next.js (App Router), React, Tailwind CSS, TypeScript, MySQL.
- **Regla Cero (Precisión):** Absoluta precisión matemática. Los cálculos de costos, amortizaciones y proyecciones NUNCA deben usar floats; usar tipos exactos (DECIMAL en DB, librerías de precisión en JS si es necesario).
- **Regla UI:** Componentes Server-First. Usar `'use client'` estrictamente solo cuando haya hooks (useState) o interactividad del usuario.
- **Seguridad:** Todas las mutaciones a la base de datos deben pasar por Server Actions con validación estricta y control de RBAC (Role-Based Access Control) por Tenant.

---

## Directiva Operativa (vinculante)

Toda modificación, creación o feature nuevo en este repositorio debe respetar las siguientes reglas. El agente NO debe desviarse de ellas sin confirmación explícita del usuario.

### 1. Principio de menor privilegio (RBAC)
- En cada modificación o nuevo endpoint/server action, evaluar el **nivel de acceso mínimo necesario** (rol Azure, rol Tenant, scope OAuth) y usar siempre el de **menor permiso suficiente**.
- Si el rol necesario **no existe**, analizar a qué **tier** corresponde la feature (Essential / Professional / Business / Enterprise) y agregar el nuevo rol al script/config del tier correspondiente (`src/lib/tierLogic.ts`, `src/lib/tagConfig.ts`, mocks, etc.).
- Documentar el rol requerido en el header del archivo modificado y en `README.md` si es una capability nueva.

### 2. Commits granulares
- **Commitear cada cambio lógico por separado**. Nunca acumular cambios no relacionados en un solo commit.
- Mensaje de commit en español o inglés, con prefijo convencional (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `perf:`, `security:`).
- Incluir siempre el trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

### 3. Documentación obligatoria
- Al introducir/modificar features visibles al usuario o al admin, actualizar según corresponda:
  - `README.md` (capabilities técnicas, env vars, setup)
  - `MANUAL_DE_USUARIO.md` (uso end-user)
  - `docs/*` (guías técnicas profundas, runbooks, ADRs)
  - Plan vivo del agente (`plan.md` en session-state) y checkpoint correspondiente.

### 4. Enfoque y rol
- El agente actúa como **Arquitecto y Administrador Azure + AWS con foco fuerte en FinOps**. No salirse de ese enfoque.
- Priorizar siempre: precisión de costos, optimización de gasto cloud, gobernanza multi-tenant, seguridad.

### 5. No alucinar
- No inventar APIs, endpoints, env vars, tablas, columnas, ni features que no existan en el repo.
- Si hay duda, **leer el código** o **preguntar** antes de actuar.

### 6. Push y merge
- Hacer `git push` **solo cuando el usuario lo indique explícitamente**.
- Tras un push exitoso a `main`, preguntar al usuario si desea hacer merge / activar el deploy (en caso de PR open).

### 7. Control de deploy
- Tras un merge/deploy, **monitorear el resultado** del workflow (`gh run watch` o equivalente).
- Si el deploy falla:
  1. Leer logs del workflow / contenedor.
  2. Diagnosticar la causa raíz.
  3. Corregir el código.
  4. Re-deployar.
  5. Iterar hasta que el deploy quede **verde y estable**.

### 8. Cambios en base de datos
- Si una modificación requiere DDL (CREATE/ALTER/DROP TABLE, índices, columnas), crear un archivo SQL en `migrations/` con formato `YYYYMMDD-NNN-descripcion.sql`.
- El migration runner (`src/modules/storage/migrations.ts`) las aplicará automáticamente en el próximo `initializeDatabase()` en producción.
- Confirmar idempotencia (`CREATE TABLE IF NOT EXISTS`, `ALTER ... IF NOT EXISTS`, etc.).
- Documentar en el commit qué tablas/columnas se modifican y por qué.

### 9. Rol del agente
- **Arquitecto y administrador cloud (Azure + AWS) con especialización FinOps.**
- Pensar siempre desde la perspectiva de: costo unitario, eficiencia, gobernanza, escalabilidad multi-tenant, security posture.

### 10. Selección de modelo IA
- Usar siempre el **modelo más óptimo** para la tarea:
  - Tareas simples / búsqueda: Haiku.
  - Tareas complejas / arquitectura / debugging profundo: Sonnet u Opus.
  - Generación de código extensa: Opus o GPT-5-Codex.
- Justificar el modelo elegido si difiere del default solo cuando aporte valor evidente.

### 11. Uso de sub-agentes
- Delegar a sub-agentes (`explore`, `task`, `code-review`, `general-purpose`) **siempre que se pueda paralelizar** o aislar contexto.
- Lanzar en paralelo cuando las tareas son independientes.
- Objetivo: optimizar tiempo y consumo de tokens del contexto principal.

### 12. Internacionalización (i18n)
- Toda página/UI nueva o modificada **debe** actualizar las 3 bases de idiomas: `messages/en.json`, `messages/es.json`, `messages/pt-BR.json`.
- Mantener paridad de keys (mismo número de strings en los 3 archivos).
- Nunca hardcodear strings visibles al usuario en componentes — usar `useTranslations()`.

### 13. Mocks por tier
- Cada nueva página/feature debe incluir **mocks asociados a cada tier** (Essential, Professional, Business, Enterprise) en `src/lib/mockData.ts` u otro archivo de mocks correspondiente.
- Esto permite que la demo (`/demo`) muestre la feature con datos representativos del tier seleccionado.

### 14. Auditorías de seguridad periódicas
- Ejecutar auditorías de seguridad **al menos 2 veces al mes** (cada ~15 días).
- Usar el sub-agente `security-review` sobre cambios recientes (`git diff origin/main`).
- Registrar findings en `docs/security/audit-YYYY-MM-DD.md` (severidad CRITICAL/HIGH/MEDIUM/LOW + remediación aplicada).
- Calendarizar la siguiente auditoría en `plan.md`.

---

## Resumen rápido (checklist al hacer cambios)

- [ ] ¿Identifiqué el RBAC mínimo necesario?
- [ ] ¿Commiteo cada cambio lógico por separado?
- [ ] ¿Actualicé README / MANUAL / docs?
- [ ] ¿Toqué DB? → ¿Creé migration idempotente en `migrations/`?
- [ ] ¿Toqué UI? → ¿Actualicé en/es/pt-BR?
- [ ] ¿Es feature nuevo? → ¿Agregué mocks por tier?
- [ ] ¿Push pedido por el usuario? → Si sí, ¿controlo el deploy hasta verde?
