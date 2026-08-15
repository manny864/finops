# Directiva: Ingesta Escalable vía Azure Cost Management Exports a Blob Storage

## Descripción del Objetivo
Establecer el protocolo de arquitectura para mitigar y eliminar de forma definitiva las limitaciones de cuota (HTTP 429 - Too Many Requests) de la Azure Cost Management Query API mediante la ingesta asíncrona por **Cost Management Exports a Azure Blob Storage** (formato FOCUS 1.0 / CSV).

---

## 1. Contexto del Problema y Cuotas de Microsoft
- **Limitación de Azure:** Microsoft impone un límite de **12 a 60 llamadas/minuto** en la API de consultas analíticas (`/providers/Microsoft.CostManagement/query`).
- **Cadencia de Actualización:** Azure actualiza la facturación interna cada **4 a 8 horas**, por lo que consultas sincrónicas repetidas saturan la cuota sin aportar mayor frescura.

---

## 2. Arquitectura de Ingesta Asíncrona (Enterprise FinOps)

### A. Recursos Requeridos en Azure
1. **Azure Storage Account:**
   - SKU: Standard LRS (Hot/Cool tier).
   - Contenedor dedicado: `finops-cost-exports`.
   - Costo estimado: < $0.20 USD/mes por almacenamiento de blobs comprimidos (gzip/parquet/csv).
2. **Cost Management Export Programado (Scheduled Export):**
   - Ámbito (Scope): Suscripción o Management Group.
   - Tipo de Métrica: *Amortized Cost* o *Actual Cost (FOCUS 1.0)*.
   - Frecuencia: Diaria (Daily Export de MTD) y Mensual (Historical Export).
   - Formato de salida: CSV / FOCUS v1.0 comprimido.

---

## 3. Estrategia de Mitigación en Backend (Caché & Coalescing)

1. **TTL de Caché Unificado:**
   - La clave compartida `cost:mtd:shared:v1:${tenantId}:${subscriptionId}:${metricType}` en Redis mantiene un TTL de **30 minutos** (`1800s`).
   - Respuestas vacías o degradadas usan un TTL corto de **60 segundos** para reintento rápido.
2. **Request Coalescing (Deduplicación en Vuelo):**
   - El mapa `COST_INFLIGHT` deduplica solicitudes concurrentes entre el Dashboard, el Whiteboard y Presupuestos: si varias peticiones llegan simultáneamente, solo se ejecuta **una única llamada a Azure** y se comparte el resultado.
3. **Escalonamiento Multi-Suscripción (Staggered Execution):**
   - Se introduce un delay de **350ms** entre llamadas por suscripción con concurrencia máxima de 2 y reintentos con backoff exponencial basados en el header `retry-after`.
4. **Pipeline en 3 Capas:**
   - Capa 1: Redis Fast Cache (sub-milisegundo).
   - Capa 2: Tabla MySQL `CostSnapshots` (sincronizada).
   - Capa 3: Live Azure Query API con reintentos y deduplicación.

---

## 4. Trampas Conocidas / Restricciones
- **No ignorar el header `retry-after`:** Si Azure devuelve un 429, se debe esperar el tiempo indicado por Microsoft antes del siguiente reintento.
- **No duplicar capas de caché con distintos TTLs:** El resultado del backend debe alinearse para que todas las vistas del dashboard muestren la misma cifra acumulada.
