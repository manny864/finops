# Revision de seguridad perimetral web

**Fecha:** 2026-10-14.

**Estado:** auditoria estatica; recomendaciones pendientes de implementar.

**Entorno declarado:** Next.js App Router en Azure Container Apps detras de Cloudflare, TLS Full Strict.

No se realizaron escaneos, pruebas de carga, llamadas a produccion, cambios de infraestructura ni ejecucion de las propuestas de codigo. No se confirmaron hallazgos criticos ni explotacion en produccion. La confianza expresa evidencia del comportamiento del codigo, no certeza de que las precondiciones operativas existan.

## Alcance

- [Proxy](src/proxy.ts) y [configuracion Next.js](next.config.ts).
- [Webhook Paddle](src/app/api/webhooks/paddle/route.ts), [webhook Azure Marketplace](src/app/api/webhooks/marketplace/azure/route.ts), [activacion Marketplace](src/app/api/webhooks/marketplace/azure/activate/route.ts) y [verificador Marketplace](src/lib/marketplace/azure.ts).
- [Ingesta de metricas](src/app/api/unit-metrics/ingest/route.ts), [MCP](src/app/api/mcp/route.ts), [autenticacion API publica](src/lib/publicApiAuth.ts) y [claves MCP](src/services/mcpApiKey.service.ts).
- [Estado](src/app/api/status/route.ts), [health](src/app/api/health/route.ts), [SSO start](src/app/api/auth/sso/start/route.ts), [checkout](src/app/api/checkout/route.ts), [onboard](src/app/api/onboard/route.ts), [rate limiter](src/lib/rateLimiter.ts) y dependencias de Redis, MySQL, cache, uptime y ciclo de vida.
- En los ocho handlers de datos v1 se comprobaron llamadas de autenticacion, scopes y cuotas; se leyo completo [cost/summary](src/app/api/v1/cost/summary/route.ts). No se certifican todos los consumidores Azure ni todas las rutas del proyecto.

## Hallazgos

Las coordenadas corresponden a la revision y deben revalidarse antes de implementar.

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| PERIM-01 | 🟡 MEDIUM | [proxy.ts](src/proxy.ts), [next.config.ts](next.config.ts) | 29, 43-46; 70 | Nonce no propagado a Next; CSP efectiva permite scripts inline. No XSS demostrado. | 10/10 |
| PERIM-02 | 🟠 HIGH | [status/route.ts](src/app/api/status/route.ts) | 103-141 | Consultas MySQL por peticion publica sin cache de aplicacion ni presupuesto de trabajo. | 10/10 |
| PERIM-03 | 🟡 MEDIUM | [ingest/route.ts](src/app/api/unit-metrics/ingest/route.ts), [mcp/route.ts](src/app/api/mcp/route.ts), [publicApiAuth.ts](src/lib/publicApiAuth.ts) | 31-74; 257-305; 46-77 | Ingesta/MCP sin cuota por clave; autenticacion llega a MySQL antes de limites; cuerpos sin limite de bytes en aplicacion. | 10/10 |
| PERIM-04 | 🟡 MEDIUM | [onboard/route.ts](src/app/api/onboard/route.ts) | 12-15, 119-239 | Inicializacion antes de autenticacion y provisioning sin throttling. | 9/10 |
| PERIM-05 | 🟡 MEDIUM | [sso/start/route.ts](src/app/api/auth/sso/start/route.ts) | 33-35 | IP derivada del primer XFF potencialmente manipulable. Condicional. | 9/10 |
| PERIM-06 | 🟡 MEDIUM | [rateLimiter.ts](src/lib/rateLimiter.ts) | 74-118 | Fallback por replica y contador/expiracion no atomicos. Riesgo operativo condicionado. | 10/10 |
| PERIM-07 | 🟠 HIGH | [marketplace/azure.ts](src/lib/marketplace/azure.ts) | 208-214 | Audiencia JWT no comprobada si falta configuracion. Condicional. | 10/10 |
| PERIM-08 | 🟡 MEDIUM | [paddle/route.ts](src/app/api/webhooks/paddle/route.ts), [azure/route.ts](src/app/api/webhooks/marketplace/azure/route.ts) | 140-174, 350-365; 54-181 | Deduplicacion durable y control de orden insuficientes en mutaciones de suscripciones. | 9/10 |
| PERIM-09 | ⚪ LOW | [status/route.ts](src/app/api/status/route.ts), [activate/route.ts](src/app/api/webhooks/marketplace/azure/activate/route.ts), [mcp/route.ts](src/app/api/mcp/route.ts), [ingest/route.ts](src/app/api/unit-metrics/ingest/route.ts) | 113, 141; 35, 144; 60, 141, 336; 74 | Version/latencia internas y errores crudos en respuestas; no secretos concretos confirmados. | 10/10 |

### PERIM-01 - CSP

**Mecanismo e impacto:** el nonce se genera despues del middleware y se entrega solo en la respuesta Report-Only, no al renderer. La politica enforcing mantiene `unsafe-inline`; una inyeccion HTML, si apareciera, podria ejecutar scripts inline. No se identifico una fuente de XSS. No se acredito recoleccion central de reportes.

**Solucion:** propagar nonce y CSP en headers de request preservando next-intl; usar renderizado dinamico y pasar nonce a scripts propios/terceros. Mantener primero Report-Only, definir telemetria acotada y promover una unica politica enforcing tras verificar compatibilidad. Conservar baseline para rutas fuera del matcher. No compartir HTML con nonce entre solicitudes.

**Aceptacion:** nonce coincidente en HTML y politica, distinto por documento; script inline sin nonce bloqueado; login, routing, checkout sandbox/live y terceros funcionan.

### PERIM-02 - Estado publico

**Mecanismo e impacto:** una ejecucion anonima consulta DB, tenants, uptime e incidentes. `Cache-Control` HTTP no limita trabajo en origen; parametros variables o misses pueden competir por el pool. No se verificaron reglas WAF/cache ni un DoS real.

**Solucion:** servir snapshots sanitizados producidos por un job autorizado, con clave fija, TTL, single-flight, backoff ante errores y estado desconocido cuando los datos caducan. Preferir publicacion en almacenamiento/CDN para no conectar MySQL desde la ruta. No calcular salud en cada GET ni responder disponibilidad del 100% ante errores.

**Aceptacion:** parametros y rafagas no aumentan lecturas por TTL/replica; errores activan backoff/503; snapshots caducados no se presentan como actuales. Mantener health barato y sin dependencias.

### PERIM-03 - Ingesta, MCP y autenticacion de claves

**Mecanismo e impacto:** ingesta permite hasta 400 escrituras por lote sin cuota por clave; MCP ejecuta herramientas sin cuota. El body se parsea antes de limitar bytes. Una clave con prefijo admitido puede llegar a MySQL antes del rate limit; una clave valida tambien actualiza `last_used_at` antes de la cuota v1.

**Solucion:** presupuesto pre-auth por IP confiable, cuota compartida por clave antes de SQL de negocio/Azure, limites de bytes al consumir stream y esquemas del JSON parseado. Conservar `write:metrics` y tenant de la clave. Agrupar actualizaciones de uso, admitirlas despues del control y registrar fallos. Aplicar limites y tiempos de lectura en ingress.

**Aceptacion:** exceso no produce trabajo protegido; clave sin scope no escribe; cuerpo chunked sobredimensionado recibe 413; parseo invalido recibe 400; claves invalidas no provocan trabajo ilimitado.

### PERIM-04 - Onboarding

**Mecanismo e impacto:** llama inicializacion antes de verificar identidad y no limita provisioning repetido. Una request anonima puede iniciar migraciones en un proceso frio; la promesa deduplica y el exito se recuerda por proceso, por lo que no ocurre en cada request.

**Solucion:** autenticar y limitar por identidad verificada antes de inicializar/provisionar; presupuesto pre-auth antes de tareas costosas. Migrar esquema durante despliegue y limitar privilegios DDL del principal de ejecucion. Preservar body opcional y flujos legitimos de login.

**Aceptacion:** JWT invalido no inicializa DB; repeticion excedente no provisiona; login normal sigue funcionando y el body no otorga trials ni permisos.

### PERIM-05 - IP confiable

**Mecanismo e impacto:** SSO toma el primer elemento XFF. Si el edge conserva un prefijo aportado por el cliente, este puede rotarlo para evitar cuota. No se verifico la transformacion efectiva ni el acceso directo al origen.

**Solucion:** cerrar ingress al canal autorizado y verificar cabeceras sobrescritas por Cloudflare antes de usar `CF-Connecting-IP`; validar formato y no habilitar confianza solo porque el DNS este proxied. Alternativamente definir otro contrato verificable de proxies.

**Aceptacion:** cambiar XFF no altera identidad ni cuota; acceso directo no permite falsificar la cabecera confiable.

### PERIM-06 - Redis

**Mecanismo e impacto:** pipeline no es transaccion; expiracion posterior puede fallar y dejar un contador sin TTL hasta su reparacion. El fallback en memoria es intencional, no ausencia de limite; con N replicas puede admitir hasta N veces el presupuesto y se reinicia con procesos.

**Solucion:** INCR/PTTL/PEXPIRE en un script atomico Lua, validacion de resultados y politica explicita por consumidor. Conservar fallback compatible donde sea aceptable; rechazar con 503, no 429, cuando una ruta necesita cuota global y Redis no permite determinarla. Alertas acotadas sin IP/clave.

**Aceptacion:** concurrencia multirreplica respeta limites; resultados invalidos no producen NaN; fallback conserva cuota local; politica estricta falla sin trabajo protegido. Actualizar tests sin cambiar globalmente la disponibilidad sin aprobacion.

### PERIM-07 - JWT Marketplace

**Mecanismo e impacto:** si falta `AZURE_MARKETPLACE_AAD_APP_ID`, `audience: undefined` desactiva esa comprobacion. Un token firmado por issuer permitido para otra audiencia podria admitirse y usar mutaciones del handler. No se verifico ausencia de configuracion ni obtencion del token.

**Solucion:** audiencia obligatoria, verificador fail-closed, algoritmos permitidos y claims requeridos conforme al contrato real. Conservar allow-list de issuer; retirar bypasses expuestos. Distinguir 503 de configuracion de 401 de credencial sin revelar token.

**Aceptacion:** configuracion ausente no llega a DB; aud/issuer/algoritmo incorrectos, exp vencido y cabecera ausente fallan; token real del proveedor funciona. El JWT autentica al emisor, no firma el JSON del body.

### PERIM-08 - Replay y orden

**Mecanismo e impacto:** Paddle limita antiguedad de firma a cinco minutos, pero no deduplica evento ni controla su orden antes de actualizar suscripciones. Marketplace declara ID/timestamp pero no los valida para deduplicacion. Reentregas fuera de orden o un evento firmado capturado aun vigente pueden restaurar estado antiguo. No se demostro captura desde Internet.

**Mitigaciones existentes:** HMAC/timestamp de Paddle, idempotencia por transaccion/ajuste, capacidad fijada y descarte de transiciones consecutivas repetidas. No se afirma duplicacion de todos los pagos.

**Solucion:** inbox durable unico por proveedor/evento y control de concurrencia/orden por suscripcion y tipo de efecto; transicion y confirmacion en misma transaccion. Outbox para efectos externos con claves idempotentes. Implementar worker operativo antes de reemplazar ejecucion por recepcion 200. En Marketplace verificar operacion/estado autoritativo mediante Fulfillment; no confiar en timestamp o accion arbitrarios del body. No usar Redis temporal como unica garantia.

**Aceptacion:** duplicados concurrentes no duplican efectos; eventos antiguos no revierten nuevos; fallos/reintentos no pierden eventos; firma invalida no entra al inbox; timestamps iguales y efectos independientes tienen politica de conciliacion.

### PERIM-09 - Metadatos y errores

**Mecanismo e impacto:** status publica version/SHA y latencia de DB. Activacion, MCP e ingesta serializan mensajes internos. `errorMessage` extrae texto, no redacta secretos. Facilita fingerprinting y revela detalles si la excepcion los contiene; no se observo SAS/token real.

**Solucion:** DTO publico minimo, mensajes/codigos estables y correlacion para fallos internos; mantener validaciones accionables. Logs estructurados sin body, Authorization ni URLs sensibles. Herramientas MCP fallidas deben expresar error, no vacio con exito.

**Aceptacion:** secretos sinteticos, SQL y URLs firmadas no aparecen en respuestas/logs; diagnostico autorizado usa correlacion; la interfaz tolera campos eliminados y estado desconocido.

## Controles defensivos observados

- HSTS productivo, X-Frame-Options DENY, nosniff, frame-ancestors none y Referrer-Policy razonable. `preload` no acredita registro en la lista.
- CORS wildcard en status publico GET/OPTIONS sin credenciales no demuestra acceso indebido.
- Paddle verifica raw body HMAC-SHA256 con igualdad de longitud y `timingSafeEqual`; firma ausente/invalida y timestamp vencido fallan cerrado.
- Marketplace verifica firma JWKS e issuer; bypass deshabilitado en produccion; jose valida exp/nbf cuando existen.
- Claves con alta entropia almacenadas como SHA-256 y buscadas mediante SQL parametrizado. No se demostro timing attack por no comparar digests en aplicacion.
- Tenant deriva de clave en ingesta/MCP y scopes explicitos en ingesta/v1; checkout tiene identidad y cuota tenant/usuario.
- Health no consulta DB/Redis ni expone version. Pool MySQL tiene cola finita. Redis dispone de TLS verificado cuando esta configurado.

## Evidencia pendiente y cierre

Verificar ingress real, transformaciones de cabeceras, WAF/bots/cache/cuotas Cloudflare, valores de entorno y contrato de tokens del proveedor. La revision estatica no garantiza seguridad del despliegue ni ausencia de vulnerabilidades en rutas no examinadas.

Priorizar aislamiento del endpoint de estado, cobertura de cuotas y configuracion obligatoria Marketplace; despues cerrar replay/orden, CSP y redaccion. Cada elemento requiere responsable, implementacion, compilacion, pruebas negativas y de regresion en staging autorizado, configuracion desplegada, riesgos residuales y rollback. Ninguna recomendacion queda resuelta por esta documentacion.
