# Redis Realtime Metrics SOP

## Objetivo
Este SOP define la arquitectura y el procedimiento para habilitar telemetría en tiempo real (Live Metrics) para `redistest` (Azure Cache for Redis).

## Entradas
- API de Azure Monitor Metrics (`Microsoft.Insights/metrics`).
- Endpoint `/src/app/api/intelligence/databases/redis-metrics/route.ts`.
- Componente `/src/components/dashboard/RedisTestBoard.tsx`.

## Lógica y Pasos

1. **Consulta de Granularidad de Tiempo Real en Azure Monitor**:
   - Cambiar o parametrizar el llamado a Azure Monitor a `timespan=PT1H` con `interval=PT1M` (última 1 hora con resolución por minuto - 60 puntos de telemetría en vivo).
   - Formatear las marcas de tiempo a minuto exacto (`HH:mm`).

2. **Bypass de Caché para Live Streaming**:
   - Cuando se consulta con `realtime=true` o `bust=1`, la API backend omite la lectura de la caché de Redis (`readDiagnosticsCache`) y consulta directamente a Azure Management API para obtener la métrica en vivo.

3. **Auto-Refresh en Frontend**:
   - En `RedisTestBoard.tsx`, implementar un temporizador de actualización automática (Auto-Refresh) cada 30 segundos cuando el modo "Tiempo Real" esté activo.
   - Añadir una insignia visual en la cabecera con un indicador animado en verde (`Live Telemetry`) e i18n habilitado.

## Trampas Conocidas / Restricciones
- **Límites de Rate Limit de Azure**: Para evitar saturar las cuotas de Azure Resource Manager, el intervalo mínimo de auto-refresh recomendado en frontend es de 30 segundos.
- **Marca**: Mantener strictly el nombre **CSCloudSolutions**.
