# Prompt de ejecución — MEJ-10: unificar los catálogos de precios y marcar el origen del ahorro

> Documento autocontenido para pasarle la tarea a otro IDE/agente. **No hace falta leer la conversación
> previa.** El contexto largo está en [`docs/MEJORAS-FUTURAS.md`](MEJORAS-FUTURAS.md) → MEJ-10.

---

## Prompt (copiar desde aquí)

Actuá como Arquitecto Azure y Desarrollador Full-Stack Senior con especialización FinOps sobre este
repositorio (Next.js 16 App Router, TypeScript, MySQL, `decimal.js`). Antes de escribir código leé
`AGENTS.md`, `CLAUDE.md`, `directivas/TODAS_LAS_DIRECTIVAS_CONSOLIDADAS.md` y
`directivas/rbac_auth_multitenancy_policy_SOP.md`.

### Tarea

Implementar **MEJ-10** de `docs/MEJORAS-FUTURAS.md`: eliminar el catálogo de precios fijos que vive en
`/api/dashboard/summary`, unificarlo con el catálogo único ya existente, y exponer en el payload si cada
cifra de ahorro fue **medida** contra Azure Cost Management o **estimada** por tipo de recurso.

### Contexto del defecto (verificado, no hipotético)

`src/app/api/dashboard/summary/route.ts` contiene, dentro de `mapAuditData`, un `resourceConfig` con un
costo mensual fijo por categoría de auditoría y este cálculo:

```ts
const estimatedMonthlyCost = Number(r.estimatedMonthlyCost || 0);
const diskSizeGB = Number(r.diskSizeGB || 0);
const sizeGB = Number(r.sizeGB || 0);
const fallbackSavings = diskSizeGB ? diskSizeGB * 0.15 : (sizeGB ? sizeGB * 0.05 : config.savings);
const potentialSavings = estimatedMonthlyCost || fallbackSavings;
```

Cuando el audit no devuelve `estimatedMonthlyCost` para el recurso, el número que la plataforma presenta
como "fuga financiera" es un literal de esa tabla (`ddos: 2944`, `appGateways: 180`, `vnetGateways: 130`,
`emptyAse: 300`, `stoppedVirtualMachines: 30`, …). Nada en el payload distingue ese caso de una medición
real.

Es el mismo patrón que ya se erradicó en tres módulos durante la sesión del 2026-08-23:

| Módulo | Qué se eliminó | Commit |
|---|---|---|
| Recursos | `estimateCostFromTypeAndSku` (default 20 USD; 95 USD para todo lo que contuviera `virtualmachines`, incluidas extensiones de VM) | `86b56f5` |
| Progreso Histórico | `SAVINGS_BY_ARM_TYPE` con fallback de 15 USD (un Azure Bastion declaraba 15 USD de ahorro) | `6594ee8` |
| Ahorro Capturado | literales 45 / 110 / 75 USD por tipo de acción | `0992086` |

En esos tres casos la solución fue la misma y **ya está en el repo**: un catálogo único
`AZURE_MONTHLY_BASELINE_BY_TYPE` + `baselineForResourceType()` en `src/lib/realizedSavings.ts`, que
devuelve `{ monthly, source }` con `source: 'cost_management' | 'retail_catalog' | 'type_baseline' | 'none'`,
y una UI que muestra `—` cuando no hay línea base en vez de un número inventado.

Hoy **los dos catálogos conviven y ya divergieron**:

| Tipo | `resourceConfig` (summary) | `AZURE_MONTHLY_BASELINE_BY_TYPE` |
|---|---:|---:|
| VM detenida | 30,00 | 70,00 (VM genérica) |
| App Service Environment | 300,00 | — (no catalogado) |
| Disco | `sizeGB × 0,15` | 19,71 (P10 128 GiB ≈ 0,154/GiB) |

### Por qué esta tarea es delicada

`totalSavings` de `/api/dashboard/summary` **no es local a un módulo**. Alimenta, como mínimo:

- KPI "Ahorro Potencial" y "Recursos Zombies" del **White Board** (`/api/intelligence/whiteboard`, que
  hace un self-fetch a `/api/dashboard/summary`).
- "Desperdicio Detectado" y la serie del gráfico de **Ahorro Capturado**
  (`src/services/azureCapturedSavings.service.ts`, vía los snapshots `dashboard_summary`).
- El módulo **Fugas Financieras** (`src/components/dashboard/FinancialLeaksBoard.tsx` + `CostPieChart`).
- Los snapshots diarios persistidos en `DailySnapshots` (`recordDailySnapshotAsync(tenantId,
  'dashboard_summary', …)` al final de la ruta), es decir el **histórico de 12 meses**.

Cambiar la semántica sin medir mueve los KPI de cuatro módulos y reescribe la interpretación del
histórico. Por eso el trabajo incluye una comparación antes/después obligatoria.

### Implementación pedida

1. **Unificar el catálogo.** `resourceConfig` deja de tener la propiedad `savings`. La línea base sale de
   `baselineForResourceType()` de `src/lib/realizedSavings.ts`. Completar allí lo que falte:
   - `App Service Environment` (hoy 300 en el config viejo, ausente en el catálogo).
   - **VM detenida como caso propio**: una VM apagada (deallocated) no paga cómputo, sólo discos e IP
     pública reservada. No debe usar la línea base de una VM encendida. Justificar el valor con la lista
     de precios y dejarlo comentado, como el resto de las entradas del catálogo.
   - Revisar que el cálculo por GiB de disco (`sizeGB × 0,15`) y la entrada `microsoft.compute/disks`
     (19,71) no se contradigan: elegir uno y documentar por qué.

2. **Exponer el origen.** Agregar `savingsSource: 'cost_management' | 'type_baseline'` a cada item de
   `mappedData`, y propagarlo en el payload de la ruta. Tipar el item (hoy es
   `Array<Record<string, unknown>>`) para que el contrato quede verificado por `tsc`.

3. **Consumir el origen en la UI**, con el criterio que ya usan Recursos y Ahorro Capturado: cifra normal
   si es medida, y `—` con tooltip explicativo si es estimación por tipo. Mínimo en:
   - `src/components/dashboard/FinancialLeaksBoard.tsx` (desglose por tipo).
   - `src/components/CostPieChart.tsx` (el donut agrega estimaciones: decidir si las incluye y, si lo
     hace, marcarlo en la leyenda).
   - `src/components/ZombieResourcesTable.tsx` (columna "Ahorro Est.").

4. **Decidir con el dato a la vista** si los KPI de desperdicio suman sólo lo medido o ambos con
   distinción visual. **No** tomar esta decisión antes del paso 5: primero medir.

5. **Comparación antes/después obligatoria.** Sobre el tenant real de validación
   `81ebe027-e6af-4e09-bc73-58c9012c6408` (es el que tiene consumo real):
   - Guardar la respuesta de `/api/dashboard/summary?tenantId=…&subscriptionId=All` antes del cambio.
   - Repetir después y producir una tabla: `totalSavings` antes/después, cuántos items pasan a
     `type_baseline`, y el delta por categoría de audit.
   - Incluir esa tabla en el commit de documentación. Si el delta supera el 20 % del total, **parar y
     consultar al usuario** antes de mergear: puede ser correcto, pero es una decisión de producto.

6. **Migración del histórico:** los snapshots ya escritos en `DailySnapshots` no tienen `savingsSource`.
   El código debe seguir aceptando puntos sin ese campo y tratarlos como `type_baseline` desconocido, sin
   romper la serie de 12 meses del módulo Ahorro Capturado. No reescribir filas históricas.

### Reglas que aplican

- **Regla Cero (AGENTS.md):** nada de floats para dinero. Usar `src/lib/money.ts` / `decimal.js` y
  `DECIMAL` en DB. En tests, comparar con `.toString()` / `.toNumber()`.
- **Cero fallbacks fabricados** (Directiva 24.1): si no hay línea base, el valor es 0 y la UI muestra `—`.
  Prohibido inventar un número para que la tarjeta "se vea llena".
- **RBAC:** no cambiar los guards de la ruta. `/api/dashboard/summary` ya exige Bearer o `X-Cron-Auth`;
  respetarlo (hay un self-fetch desde `/api/intelligence/whiteboard` que forwardea la credencial — no
  romperlo).
- **Mock-first:** mantener el short-circuit de `isMockTenant` y actualizar los mocks por tier para que la
  demo muestre el mismo contrato, incluido `savingsSource`.
- **i18n:** cualquier texto nuevo va a `messages/es.json`, `en.json` y `pt-BR.json` con paridad de claves.
- **No tocar la estructura visual** de las tarjetas ni de las tablas: la intervención es de datos y de
  etiquetado de origen.

### Definición de terminado

- `npm run lint -- --quiet`, `npm run typecheck` y `npm run test` en verde.
- Tests nuevos: al menos (a) `baselineForResourceType` cubre VM detenida y App Service Environment;
  (b) `mapAuditData` marca `savingsSource: 'cost_management'` cuando el audit trae
  `estimatedMonthlyCost` y `'type_baseline'` cuando no; (c) ningún item sin línea base devuelve un
  ahorro mayor que 0.
- `grep -rn "config.savings\|fallbackSavings" src/app/api/dashboard/summary/route.ts` no devuelve nada.
- La tabla de comparación antes/después del tenant real, en el commit de docs.
- `docs/MEJORAS-FUTURAS.md`: mover MEJ-10 a "Mejoras cerradas" con el commit.
- Actualizar `README.md` (changelog) y `docs/lld/00-lld-completo.md` si cambia el contrato del endpoint;
  regenerar el PDF del LLD con `node scripts/generate-lld-pdf.js`.
- Commits granulares con prefijo convencional y el trailer
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
- **No pushear** sin pedido explícito del usuario. Si se pide: primero `main:staging`, esperar CI verde,
  después `main:main` y monitorear el deploy.

### Archivos involucrados

| Archivo | Rol |
|---|---|
| `src/app/api/dashboard/summary/route.ts` | `resourceConfig`, `mapAuditData`, snapshot diario |
| `src/lib/realizedSavings.ts` | catálogo único `AZURE_MONTHLY_BASELINE_BY_TYPE`, `baselineForResourceType`, `safeSavingsPercentage` |
| `src/components/dashboard/FinancialLeaksBoard.tsx` | desglose por tipo y total |
| `src/components/CostPieChart.tsx` | donut y estados vacíos |
| `src/components/ZombieResourcesTable.tsx` | columna "Ahorro Est." |
| `src/services/azureCapturedSavings.service.ts` | consume `totalSavings` del snapshot |
| `src/app/api/intelligence/whiteboard/route.ts` | self-fetch a summary para KPI de zombies/carbono |
| `src/lib/mockData.ts` | mocks por tier del summary |

### Trampas conocidas (ya pisadas en esta sesión — no repetirlas)

1. **`if (res.ok)` sin rama `else`.** Fue la causa raíz de tres bugs distintos (snooze de Advisor, wizard
   de Madurez, y el POST de evaluación): un `fetch` de mutación sin cabecera `Authorization` contra una
   ruta con RBAC devuelve 401 y el error se traga en silencio. Si agregás una mutación, mandá el id token
   (`getFreshIdToken`) y mostrá el error.
2. **Animaciones de Recharts.** La animación corre sobre `requestAnimationFrame`, que el navegador pausa
   en pestañas en segundo plano: la serie queda en el frame 0 y el gráfico se ve vacío con el dato ya
   cargado. Si agregás una serie, `isAnimationActive={false}` (ver MEJ-02).
3. **Intercepciones demo de `TenantProvider`.** Parchea `window.fetch` para tenants mock. Seis de esas
   intercepciones devolvían un shape distinto al del contrato y dejaban paneles vacíos o absurdos; se
   quitaron. Si validás en demo y ves datos raros, revisá primero si la ruta está interceptada (ver
   MEJ-03) antes de culpar al backend.
4. **Colores de gráficas.** Los ejes y series de Recharts se pasan como props SVG, donde las clases
   `dark:` de Tailwind **no** aplican. Usar el hook `useChartTheme()` de `src/lib/chartTheme.ts`.

## (fin del prompt)
