# Ingesta de costos, acceso delegado y gate de tier (2026-09-04)

Este documento describe una sesión de trabajo completa: qué estaba roto, la causa
raíz de cada cosa, y qué quedó pendiente con su criterio de verificación.
Pensado para poder retomarse desde otro IDE sin el contexto de la conversación
original.

**Rama:** `main` · commits `a018e25` → `bc6ba84`
**Suite de tests:** 2224 pasando (2128 al inicio de la sesión)

---

## Resumen ejecutivo

Se cerraron cuatro frentes: la ingesta de costos, el acceso delegado por Azure
Lighthouse, la gestión de suscripciones y el gate de tier de la administración.

**El hilo común de casi todos los hallazgos: nada fallaba ruidosamente.** Los
defectos se manifestaban como éxitos — un apply en verde que no aplicaba, una
delegación activa que no otorgaba acceso, un panel que mostraba cuatro
suscripciones de las que dos no aportaban un dato. Ese patrón se repitió lo
suficiente como para tratarlo como criterio de diseño y no como coincidencia.

**Un punto abierto y crítico:** la ingesta de costos sigue sin funcionar. Se
midió y se actuó, pero la verificación es la corrida de mañana.

---

## 1. Ingesta de costos — ABIERTO, verificación pendiente

### El estado

```
2026-09-01  ok=1/4  colgados=3  filas=114
2026-09-02  ok=1/4  colgados=3  filas=116
2026-09-03  ok=0/5  colgados=4  filas=0
2026-09-04  ok=0/5  colgados=4  filas=0
```

Cuatro días con la mayoría de los tenants sin ingerir, los dos últimos sin
ingerir nada. No estaba reportado en ninguna alerta.

### La causa

**Contención sobre Cost Management**, no volumen. En la media hora del barrido,
Resource Graph registró 5 respuestas 429 y Cost Management 314, con pico de 122
en un tramo de cinco minutos. La diferencia no eran las cuotas: ARG tenía una
cola global con pausa compartida y Cost Management no. Un backoff por llamada es
insuficiente por construcción — mientras un llamador espera, los demás siguen
golpeando y renuevan la penalidad.

### Lo hecho

- **Cola global** (`src/lib/apiThrottle.ts`). La mecánica se extrajo de
  `argConcurrency.ts` a un limitador genérico con estado por instancia; las 28
  llamadas en 8 archivos la ganan sin tocarlas. **Resultado medido: los 429
  bajaron de 314 a 153.**
- **Techo por tenant de 6 a 10 minutos.** La cola era necesaria y volvió el techo
  insuficiente: al frenar a todos los llamadores agregó tiempo de reloj, así que
  hasta el único tenant que terminaba (320-330s) pasó a vencer.
- **Dev server local apagado** después de nueve días levantado. Con una pestaña
  abierta consumía la misma cuota del tenant.

### Tres bugs encontrados al escribir los tests de la cola

Los tres reales, ninguno hipotético:

1. La pausa se fijaba en el `catch`, o sea después de que el rechazo arrancara la
   próxima consulta. Por cada 429 se colaba una más.
2. Se medía con `Date.now()`, que un ajuste de NTP hacia atrás dejaría frenado.
   Va sobre `performance.now()`.
3. Un `fn` que lanza sincrónicamente filtraba el turno: a los `maxConcurrent`
   errores la cola se trababa entera hasta un reinicio del proceso.

### Verificación

Corrida de mañana a las 06:00 UTC. Los tres desenlaces y su lectura:

| Resultado | Significa | Paso siguiente |
|---|---|---|
| `ok=5/5` | Resuelto | Nada |
| Parcial | El techo alcanza para algunos | Mirar el `listo en Nms`: si el que vence está en ~11 min, subir un poco; si está en 20, es volumen |
| `ok=0/5` | No era el techo | Partir el trabajo entre corridas. **No** seguir subiendo: 12 min × 5 tenants = los 3600s del `replicaTimeout` |

---

## 2. Azure Lighthouse — funcional, pendiente de validación end-to-end

La delegación se creaba, se registraba, la suscripción aparecía en la lista, y
después todas las consultas se autenticaban con el modelo anterior. **No servía
para nada.**

### La raíz

`getAzureCredential()` construía la credencial contra el tenant del cliente.
Lighthouse invierte eso: el service principal vive en nuestro directorio y el
token se emite contra el nuestro. Autenticar contra el del cliente no falla con
un mensaje útil — falla porque nuestro SP no existe ahí.

### Lo hecho

- `Tenants.access_model` (migración `20260904-001`), default `app_registration`
  para que ningún tenant existente cambie de comportamiento.
- `lighthouseAccess.ts` y `lighthouseVerification.service.ts`. La verificación
  contra Resource Graph es el único lugar que enciende el modelo: hacerlo al
  emitir la plantilla dejaría al tenant sin datos hasta que el cliente la
  desplegara.
- **Restringido a Enterprise**, con el gate en las rutas de API. Un bloqueo
  visual se saltea con un `fetch`.
- Botón de baja de delegaciones, con la distinción explícita de que borra nuestro
  registro y no la delegación.
- Destacado en la página de precios, fuera de la lista colapsable donde estaba
  como ítem 20 de 34.

### Cinco bugs del generador de plantillas, los cinco silenciosos

1. **`principalId` inventado.** Rellenaba GUIDs falsos cuando no venía en el
   body — y no venía nunca, porque ningún panel lo manda. Lighthouse no verifica
   que el principal exista al desplegar, así que la plantilla entraba en verde y
   no otorgaba acceso a nadie.
2. **`managedByTenantId` era el del request.** Un cliente generaba una plantilla
   que delegaba hacia su propio tenant.
3. La asignación no era idempotente: cada re-despliegue creaba una nueva.
4. "Sugerir con IA" rellenaba `Owner: CloudOps@company.com` y
   `CostCenter: Core-Infrastructure` — valores inexistentes, listos para
   aplicarse sobre recursos reales con un click.
5. La tabla mostraba nuestro tenant en la columna "Tenant gestionado": las tres
   fuentes del dato eran del administrador, no del cliente.

### Pendiente

Verificar la delegación desde el panel y mirar los cockpits de ese tenant. De ahí
sale si los **84 sitios de Resource Graph sin `subscriptions` explícito** son un
problema real — no se tocaron a ciegas.

---

## 3. Gestión de suscripciones

- **La baja no llegaba a todo.** La exclusión se aplicaba en una de dos vías de
  descubrimiento; la que no filtraba tiene 68 llamadores. Además quedaban los
  horarios de encendido/apagado, el contador de cuota y los cachés de Redis.
- **La página de horarios se caía al eliminar.** Los tres handlers devolvían
  filas crudas de MySQL donde el panel esperaba la forma mapeada.
- **Botón de revincular.** El `POST` existía desde el principio y no había forma
  de llegar a él; las excluidas se filtraban de la tabla, así que no quedaba ni
  fila donde poner el botón.
- **Suscripciones fuera del tope, visibles.** El truncado ordenaba por GUID y
  tomaba los primeros N: determinístico pero arbitrario. La tabla mostraba las
  cuatro con la misma apariencia mientras dos no alimentaban un dato.

---

## 4. Gate de tier de la administración

`routeTiers` declaraba el tier de cada ruta de administración y esa declaración
**no se aplicaba a ninguna**: desde que estas páginas pasaron a ser pestañas de
un hub, `RouteTierGate` resuelve el tier por el pathname del hub.

**Trece pestañas declaradas Business o Enterprise, ninguna gateada**: SSO SAML,
Onboarding Lighthouse, Partner Markup, Copilot M365, MCP API Keys, API Pública,
Workbooks, Power BI Templates y los tres reportes.

Y una declaración estaba mal: `/admin/cloud-accounts` figuraba como Enterprise
mientras su panel está construido para Professional y Business —el banner de
cuota se renderiza sólo cuando el tier no es Enterprise— y la página de precios
le promete suscripciones a esos dos tiers. Aplicar el gate tal cual les habría
escondido su única forma de administrar el cupo.

---

## 5. Otros hallazgos de esta sesión

**Etiquetas FinOps: tres vocabularios que no coincidían.** Un recurso con las
cuatro etiquetas de la política pero sin `Owner` —que no es obligatoria en
ninguna— salía "100% Compliant" en una pantalla y "Sin Etiquetas FinOps" en la
otra al mismo tiempo. Y remediarlo desde el modal no lo arreglaba: escribía las
tres que no eran. El botón de remediar sólo aparecía para una de las dos claves
que muestran ese badge.

**El disparo manual de sincronización.** Self-fetch contra el dominio público
que moría en hairpin NAT; `.catch` sin mirar `res.ok`, así que un 401 dejaba al
tenant en `syncing` para siempre; y `/api/cron/sync` ignoraba el `tenantId` que
recibía desde siempre.

**El resultado del sync se escribía donde nadie lo lee.** `updateTenantHealth`
escribía en `tenant_health`; el panel lee `Tenants.sync_status` — que es, textual,
lo que la migración `20260728-002` llama "el estado denormalizado del último
sync". Esa denormalización nunca se había cableado.

**Dos empates permanentes con Azure en Terraform**, que bloqueaban todos los
applies del stamp y no sólo el módulo de backup. El `start_time` de un schedule
diario que Azure adelanta y Terraform retrocede, y el `runbook_type` que el
provider lee mal y viaja dentro de cada update.

**Staging destruido** a pedido: 74 recursos, los dos resource groups. El Key
Vault quedó en soft-delete hasta el **2026-10-04**; recrear staging con el mismo
nombre antes de esa fecha requiere purgarlo.

---

## 6. Documentación

HLD (Addendum 15, con diagrama de los dos modelos de acceso), LLD (Addendum 36),
README (sección de los dos modelos con las cinco variables) y los seis manuales
en tres idiomas. Ocho PDFs regenerados.

Dos cifras se corrigieron verificándolas contra el código antes de publicarlas.

---

## 7. Pendiente

### Requiere acción en Azure

| Qué | Por qué |
|---|---|
| Sacar `179.36.184.41` de la allowlist del Key Vault de producción | El vault tiene que quedar cerrado; el pipeline se agrega y se quita la IP por corrida |
| Consolidar permisos entre las dos cuentas del directorio | Los permisos están repartidos entre la cuenta miembro y la invitada; cortó el destroy de staging a la mitad y costó media hora en Key Vault |
| Auditoría de seguridad | Vence según la cadencia de AGENTS.md (cada ~15 días, última el 2026-08-21) |

### Requiere validación

- Verificar la delegación de Lighthouse y revisar los cockpits del tenant
  delegado.
- Corrida del barrido de mañana 06:00 UTC.

### Deuda de código

- **MEJ-32**: tres catálogos de precios divergentes.
- **MEJ-03**: ~59 claves de mock sin tipar, 79 intercepciones redundantes.
- ~1294 literales en español en 106 archivos.
- Manuales EN y PT-BR: la sección de soporte quedó varada a mitad de archivo por
  rondas anteriores, y los índices no listan las secciones 13 en adelante.
- `SsoPanel` y las otras pestañas ya quedaron gateadas, pero conviene revisar que
  cada declaración de `routeTiers` coincida con lo que su panel realmente
  necesita — `cloud-accounts` no era la única candidata a estar mal.

---

## Nota sobre el nombre y el envío

Se pidió por correo. No hay camino de envío disponible desde el entorno de
trabajo: `emailHelper.ts` usa Graph con credenciales que viven en Key Vault y en
el entorno de producción.

Tampoco va con el prefijo `HANDOFF-`: `.gitignore:150` excluye
`docs/HANDOFF*.md`, junto con `AGENTS.md`, `CLAUDE.md` y `docs/PROMPT*.md` — el
bloque de archivos de trabajo de asistentes, que el equipo decidió no versionar.
Sigue en cambio el patrón fechado de `docs/` (`demo-mode-fix-2026-07-08.md`,
`dashboard-improvements-2026-07-09.md`), que sí está en el repo.
