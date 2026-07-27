# Plan de Mejora de Infraestructura — VPS Hostinger (bajo costo)

**Autor:** Arquitecto Azure/AWS FinOps (agente) · **Fecha:** 2026-07-02
**Objetivo:** endurecer, observar y hacer más resiliente el stack actual **sin subir el gasto de infraestructura**, priorizando cambios de costo $0 antes que cualquier upgrade de plan o servicio administrado.

---

## 1. Contexto actual (línea base verificada)

| Componente | Detalle real (repo/VPS) |
|---|---|
| **VPS** | Hostinger — 2 vCPU, 8 GB RAM, 100 GB SSD NVMe |
| **App** | Next.js standalone (`Dockerfile`, `node:22-alpine`), contenedor `finops-app`, `restart: always`, sin `mem_limit`/`cpus` |
| **Redis** | Contenedor `redis:alpine` en `docker-compose.yml`, **sin `requirepass`** (`.env.production: REDIS_PASSWORD=` vacío), sin `maxmemory`, sin persistencia configurada explícitamente |
| **MySQL** | ✅ **Topología confirmada (2026-07-04):** dockerizado en un compose project **separado** (`~/cscloud/database`, servicio `mysql`), fuera del `docker-compose.yml` de la app — evidencia en `scripts/prod-migrate-kv.sh` (`MYSQL_DIR`). `DB_HOST=127.0.0.1` funciona porque el contenedor publica el puerto al host. |
| **Red** | `proxy_network` es `external: true` — compartida con Traefik (y posiblemente otros stacks del mismo VPS) |
| **Deploy** | GitHub Actions (`deploy.yml`) hace SSH, `git reset --hard origin/main`, `docker compose stop finops-app`, `docker compose up -d --build` — **con downtime** durante el build |
| **Secretos Azure (Client ID/Secret por tenant)** | Ya en Azure Key Vault (`src/lib/secrets/tenantCredentials.ts`) ✅ |
| **Secretos de infraestructura** (`DB_PASSWORD`, `REDIS_PASSWORD`, `CRON_SECRET`) | En `.env` plano en el VPS, **no** en Key Vault |
| **Backups** | No hay backup automatizado y programado. Solo existe un `mysqldump` manual dentro de `scripts/prod-migrate-kv.sh` (para una migración puntual, no es un proceso recurrente) |
| **Observabilidad** | Ninguna (sin métricas de contenedores, sin alertas de caída, sin dashboard de recursos) |
| **Caches en memoria del proceso Node** | `auditCache`, `vmCache`, `priceCache` (Maps sin límite de tamaño ni TTL de purga) — riesgo de crecimiento no acotado en procesos de larga duración |

**Hallazgo de esta sesión relevante para el diseño:** el throttling de Azure Resource Graph (429) obligó a introducir un limitador global de concurrencia (`src/lib/argConcurrency.ts`) y cache Redis SWR. Esto ya reduce carga de CPU/red del propio contenedor `finops-app`, lo cual **ayuda** al presupuesto de recursos del VPS (menos reintentos, menos tiempo de CPU en vuelo).

---

## 2. Principios de diseño (para mantener el costo bajo)

1. **Nada de servicios administrados nuevos** (sin Azure Cache for Redis, sin Azure Database for MySQL, sin ElastiCache) mientras el VPS no muestre saturación sostenida real.
2. **Software libre / tiers gratuitos** para observabilidad y monitoreo externo.
3. **Límites de recursos por contenedor** antes que "más RAM" — la mayoría de los problemas de un VPS compartido son de *reparto*, no de *capacidad total*.
4. **Automatizar lo recurrente** (backups, rotación de logs) con `cron` nativo del VPS — cero costo adicional.
5. **Escalar verticalmente antes que horizontalmente**: un segundo VPS o servicio administrado solo se justifica con métricas reales de saturación (Fase 5), no de forma preventiva.

---

## 3. Fases de implementación

### Fase 0 — Endurecimiento inmediato (costo: **$0**, esfuerzo: 1-2 días)

**Objetivo:** evitar que un solo contenedor tumbe a los demás por memoria, y cerrar el hueco de auth de Redis.

- [x] **Límites de recursos** en `docker-compose.yml` (`mem_limit`/`cpus` en `finops-app` y `redis`, healthchecks, `logging` con rotación `json-file` max-size/max-file). Verificado localmente con `docker compose config` + arranque real del contenedor `redis`.
- [x] **Redis con contraseña**: `command` con `--requirepass "$REDIS_PASSWORD"` condicional (shell `${VAR:+...}`, no rompe si la variable no existe), `--maxmemory 512mb --maxmemory-policy allkeys-lru --appendonly yes`. Confirmado en producción: Redis del VPS ya corre con password: este cambio solo lo hace explícito/reproducible en el compose en vez de depender de configuración manual fuera de git.
- [x] **Rotación de logs de Docker** (`max-size: 10m`, `max-file: 5` en la app / `3` en Redis).
- [x] **Auditar exposición de puertos** — verificado en el VPS (2026-07-04, `docker ps`): `finops-app` (3000) y `redis` (6379) **no** publican puertos al host; MySQL bindea solo `127.0.0.1:3306`; lo único expuesto a internet es Traefik 80/443. `ufw` activo (allow: OpenSSH/80/443) + fail2ban jail `sshd` (bantime 600s, maxretry 5). **Hallazgo colateral:** fail2ban banea IPs de rangos Azure (de donde salen los runners de GitHub Actions) → deploys fallan intermitentemente con SSH timeout; los reintentos de `deploy.yml` (+45s/+90s) caen dentro del bantime de 10 min. Mitigación → Fase 4 (espaciar el reintento final a >10 min o re-run manual).
- [x] **Purga de caches en memoria no acotadas**: `auditCache` (`auditService.ts`), `priceCache` (`pricingService.ts`) y `vmCache` (`power/route.ts`) ahora son `Map` con eviction FIFO acotada (mismo patrón que `keyvault.ts`), en vez de crecer sin límite.

**Fase 0.1 — Secretos de infraestructura a Key Vault**
Ya existe la integración con Azure Key Vault para credenciales de tenant (`src/lib/secrets/tenantCredentials.ts`). Extendida a `DB_PASSWORD`, `REDIS_PASSWORD` y `CRON_SECRET`:
- [x] `src/lib/secrets/infraSecrets.ts`: resuelve cada secreto desde Key Vault (`infra-db-password`, `infra-redis-password`, `infra-cron-secret`) con fallback silencioso a `process.env` si KV no los tiene todavía o está deshabilitado.
- [x] `src/instrumentation.ts`: hook de arranque de Next.js que hidrata `process.env` desde Key Vault ANTES de que `db.ts`/`redis.ts` creen sus singletons (ambos leen `process.env` en su primer uso).
- [x] `scripts/migrate-infra-secrets-to-kv.ts` (`npm run migrate:infra-secrets`): script idempotente para correr **en el VPS** (donde están los valores reales) y poblar Key Vault sin sobreescribir secrets ya existentes. Soporta `--dry-run`.
- Costo: Key Vault ya está pagado (se usa para tenants); agregar 3 secrets más no cambia el tier de precio.

---

### Fase 1 — Backups y continuidad (costo: **$0 – ~$1/mes**, esfuerzo: 1 día)

Actualmente **no hay backups automatizados** — el mayor riesgo del diseño (VPS único, sin redundancia).

- [x] **Script de backup diario** (`scripts/backup-db.sh`) vía `mysqldump` con compresión (`gzip`), cron a las 03:00 local (fuera de horario de uso):
  ```cron
  0 3 * * * /home/manny/cscloud/finops/scripts/backup-db.sh >> /var/log/finops-backup.log 2>&1
  ```
- [x] **Retención local**: 7 diarios + 4 semanales (rotación simple con `find -mtime +N -delete`), acotado en disco (dumps comprimidos de una BD de este tamaño son pequeños, del orden de decenas de MB).
- [x] **Copia off-site**: decisión (2026-07-04) — **Azure Blob Storage** (Storage Account tier Cool + LRS + lifecycle 35 días, mismo ecosistema que el Key Vault existente; costo estimado < $0.05/mes). Upload vía `curl PUT` con **SAS de contenedor solo-escritura** (`cw` — un VPS comprometido no puede leer ni borrar backups). Sin `az` CLI en el VPS. Provisioning documentado en el runbook. ✅ **Verificado en producción (2026-07-04):** Storage Account creado, SAS en el `.env` del VPS, upload off-site exitoso desde el script.
- [x] **Runbook de restore** documentado: `docs/runbook-restore-mysql.md` (provisioning, instalación del cron, restore local/off-site, prueba en DB de test, troubleshooting). ✅ **Prueba de restore §4.3 ejecutada en el VPS (2026-07-04):** dump real restaurado en `finops_restore_test` — 63 tablas y 5 tenants OK, DB de prueba eliminada.
- [x] **Backup de volúmenes de Redis**: descartado explícitamente — hoy es 100% cache regenerable, no crítico de respaldar. Revisar solo si Redis pasa a guardar estado.

---

### Fase 2 — Observabilidad ligera (costo: **$0**, esfuerzo: 1-2 días)

Sin esto, cualquier degradación (como la tormenta de 429 de esta sesión) se detecta recién cuando el usuario se queja.

- [x] **Healthcheck de Docker Compose** por servicio — ya implementado bajo Fase 0 (ver `docker-compose.yml`: `finops-app` pega a `/api/health`, `redis` hace `redis-cli ping`). Este ítem quedó duplicado entre fases al escribir el plan; no hay nada más que hacer acá.
- [x] **Alertas de fallo de cron** (2026-07-27): `scripts/cron-ping.sh` — wrapper genérico que envuelve cualquier comando de cron y pinguea `https://hc-ping.com/<uuid>` en éxito/fallo (mismo patrón que `ping_health()` en `backup-db.sh`, generalizado). Aplicado a los 14 jobs HTTP de `/api/cron/*` en el "Ejemplo crontab VPS" del README, cada uno con su propia `*_HEALTHCHECK_URL` en `.env.example` (Fase 2). No-op mientras la URL esté vacía, así que es seguro desplegarlo antes de crear los checks.
  - **Justificación concreta (2026-07-05)**: `/api/cron/sync` estuvo documentado en el README como cron diario pero **ausente del crontab real** del VPS, dejando 3 tablas de costo vacías indefinidamente sin ningún error visible (ver README § Recent Major Updates). Un ping de healthchecks.io habría alertado el mismo día en que el job no corrió, en vez de descubrirse recién cuando el usuario reportó páginas sin datos.
  - **Pendiente (manual, fuera de este repo)**: crear las 14 checks en [healthchecks.io](https://healthchecks.io) (gratis hasta 20) y setear las URLs resultantes en el `.env` del VPS. Sin ese paso el wrapper sigue siendo no-op — el código no reemplaza la cuenta.
- [x] **Métricas de recursos del VPS sin agregar servicios pesados** (2026-07-27): `scripts/log-docker-stats.sh` — `docker stats --no-stream` cada 5 min por cron, log rotado por antigüedad (`STATS_RETENTION_DAYS`, default 14d), sin dependencias nuevas. Probado localmente contra contenedores reales. `netdata` (self-hosted, ~150-200MB RAM) sigue siendo la opción de mejor relación esfuerzo/valor si sobra RAM tras los límites de la Fase 0 y se quiere un dashboard en vez de un log plano — no implementado, evaluar solo si el log plano resulta insuficiente.
- [ ] **Monitoreo externo de disponibilidad**: UptimeRobot o Better Uptime (tier gratis, 50 monitores/5 min) apuntando a `https://finops.cscloudsolutions.com.ar/api/health` y a la landing pública. Alerta a email/Slack. **100% manual/externo** — requiere crear una cuenta propia, no hay nada codificable de este lado.

---

### Fase 3 — Resiliencia de aplicación (ya iniciada esta sesión, costo: **$0**)

Esto reduce la carga real de CPU/red sobre el VPS, no solo "arregla bugs":

- [x] Limitador global de concurrencia hacia Azure Resource Graph (`argConcurrency.ts`) — evita ráfagas de requests salientes que consumen CPU en reintentos.
- [x] Cache Redis SWR en `audit/full` y `audit/ttl` — de 30-60s a ~10ms en cache-hit, bajando drásticamente el uso de CPU del contenedor `finops-app` en cada refresh de dashboard.
- [ ] **Pendiente**: extender el mismo patrón SWR a los pocos endpoints pesados que aún no lo tienen (revisar `intelligence/*` restantes).
- [ ] **Pendiente**: lock idempotente en Redis (`SET NX EX`) para los cron jobs (`power-schedules`, `sync`, `prewarm-dashboard`), para que una ejecución larga no se solape con la siguiente si el VPS está momentáneamente lento — barato (una key de Redis) y evita picos de CPU duplicados.
- [ ] **Pendiente**: acotar el `ARG_MAX_CONCURRENT` y el `batchSize` de `auditService.ts` según CPU real disponible (2 vCPU) — hoy estos valores fueron ajustados pensando en throttling de Azure, pero también conviene revisarlos pensando en no saturar los 2 vCPU del VPS cuando varios tenants auditan a la vez.

---

### Fase 4 — CI/CD y despliegue sin downtime (costo: **$0**, esfuerzo: 1 día)

El `deploy.yml` actual apagaba `finops-app` **antes** de reconstruir la imagen — downtime igual a todo el tiempo de build.

- [x] **Build antes de detener** (2026-07-27): `scripts/deploy-vps.sh` — `docker compose build finops-app` con la app vieja todavía sirviendo tráfico, y recién con la imagen lista `docker compose up -d finops-app` (Docker reemplaza el contenedor casi instantáneo). Reduce el downtime de "minutos" a "segundos".
- [x] **Smoke test post-deploy**: mismo script — en vez de `curl http://localhost:3000/api/health` (no funciona: el puerto no se publica al host, solo es alcanzable vía la red de Traefik), se poll-ea `docker inspect -f '{{.State.Health.Status}}'` sobre el healthcheck que ya define `docker-compose.yml`, hasta 30s. Si no llega a `healthy`, corre `docker compose logs --tail=100 finops-app` para que el workflow muestre el diagnóstico.
- [x] **Rollback automático simple**: mismo script — tagea `finops-finops-app:previous` antes de buildear; si el smoke test falla, retagea `:previous` como `:latest`, hace `up -d` de nuevo, y sale con `exit 1` (para que `deploy.yml` lo trate como fallo y dispare su reintento existente).
- [x] Flujo `staging → CI → main → deploy` sin cambios (Directiva #15) — solo se endureció el script de deploy, invocado igual desde los 3 intentos de `deploy.yml`.
- [x] **Extra, hallazgo de Fase 0 resuelto de paso**: el "Wait before final retry" era `sleep 90`, menor al `bantime` de 600s de fail2ban en el VPS — dos intentos SSH fallidos seguidos podían dejar la IP del runner baneada, y el 3er intento repetía el mismo timeout sin nunca llegar a conectar. Se cambió a `sleep 660` (>600s).

---

### Fase 5 — Ruta de escalamiento (solo si las métricas lo piden, costo: **variable, a demanda**)

No implementar preventivamente. Disparadores concretos para pasar a esta fase:

| Señal (medida en Fase 2) | Acción de bajo costo primero | Acción de mayor costo (último recurso) |
|---|---|---|
| CPU sostenida >80% por >30 min repetido | Revisar/afinar `ARG_MAX_CONCURRENT`, batch sizes, y cache hit-rate antes que nada | Subir plan VPS a 4 vCPU (Hostinger permite upgrade in-place) |
| RAM sostenida >85% | Revisar fugas (`Map` sin límite), bajar `mem_limit` de contenedores no críticos | Subir plan VPS a 16 GB |
| MySQL con `Threads_connected` cerca de `max_connections` | Ajustar pool de conexiones de la app (`src/modules/storage/db.ts`) | Separar MySQL a un VPS/instancia dedicada |
| Picos de tráfico multi-tenant simultáneos | Cloudflare gratis delante de Traefik (cachea estáticos, absorbe DDoS) | Segundo VPS + load balancer (solo si el negocio lo justifica) |

**Regla de oro:** cada escalón de esta tabla debe estar respaldado por datos de la Fase 2 (no por intuición), y siempre se prueba primero la columna de "bajo costo".

---

## 4. Presupuesto estimado

| Fase | Costo mensual adicional | Esfuerzo |
|---|---|---|
| 0 — Endurecimiento | $0 | 1-2 días |
| 1 — Backups | $0 – ~$1 (si se usa B2/R2 off-site) | 1 día |
| 2 — Observabilidad | $0 (tiers gratuitos) | 1-2 días |
| 3 — Resiliencia app | $0 (ya en curso) | continuo |
| 4 — CI/CD | $0 | 1 día |
| 5 — Escalamiento | Variable, solo a demanda y con datos | según señal |

**Total para Fases 0-4: prácticamente $0/mes**, financiado enteramente con tiempo de implementación, no con gasto de infraestructura nuevo.

---

## 5. Riesgos si no se actúa

- **Sin backups (Fase 1)**: cualquier `docker compose up -d --build` fallido, corrupción de disco o error humano en producción es una pérdida de datos irrecuperable — este es el riesgo más grave del diseño actual.
- **Redis sin password (Fase 0)**: cualquier contenedor comprometido en la red compartida `proxy_network` tiene acceso de lectura/escritura total al cache (incluye MTD cost cacheado y locks en vuelo).
- **Sin límites de memoria (Fase 0)**: un pico de tráfico o una fuga en un `Map` sin cota puede hacer que el contenedor de la app consuma toda la RAM del VPS y tumbe MySQL/Redis con él (OOM killer del kernel decide qué proceso matar, no necesariamente el correcto).
- **Sin observabilidad (Fase 2)**: los problemas se detectan por queja del usuario, no proactivamente — como pasó esta sesión con el throttling de Resource Graph, que llevaba tiempo ocurriendo sin alertas.
- **Deploy con downtime (Fase 4)**: cada release visible interrumpe el servicio; a medida que crezca la base de tenants, esto se vuelve más costoso en confianza del cliente.

---

## 6. Checklist resumido (orden recomendado de ejecución)

1. [ ] Confirmar topología real de MySQL (¿dockerizado con `network_mode: host` o nativo en el VPS?).
2. [ ] Fase 0: límites de recursos + Redis con password + rotación de logs + auditoría de puertos expuestos.
3. [ ] Fase 1: backup diario automatizado + copia off-site + runbook de restore.
4. [ ] Fase 2: healthchecks de Docker (✅ ya en Fase 0) + `cron-ping.sh`/`log-docker-stats.sh` (✅ código listo 2026-07-27) — falta crear cuentas UptimeRobot + healthchecks.io e instalar en el crontab real del VPS.
5. [x] Fase 4: build-antes-de-stop + smoke test + rollback simple en `deploy.yml` (`scripts/deploy-vps.sh`, 2026-07-27).
6. [ ] Fase 3: cerrar los pendientes de cache SWR y locks de cron.
7. [ ] Fase 5: solo si las métricas de la Fase 2 muestran saturación sostenida.
