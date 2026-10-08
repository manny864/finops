# Plan: adecuación al GDPR para clientes de la UE

> **Estado: preparado el 2026-10-07, NO ejecutado.** Documento para retomar
> después. Nada de lo que describe está aplicado.
>
> **Historial del alcance.** La primera versión (commit `36be2fe`) exigía un
> despliegue completo en Europa. **Manuel lo cambió el mismo día:** el GDPR no
> exige que los datos estén en la UE sino una base legal para transferirlos
> (Cap. V), así que el camino es **adecuarse al GDPR operando desde EE. UU.**
> El plan del stamp europeo quedó reducido al [apéndice](#apéndice-stamp-europeo-opcional);
> la versión larga sigue en `git show 36be2fe:docs/plan-despliegue-europa-gdpr-2026-10-07.md`.
>
> **Lo verificado y lo que no.** Lo que se dice del repo se revisó contra el
> código el 2026-10-07. Lo que se dice de la ley, del DPF y de terceros **no se
> verificó**: está en la [sección 6](#6-por-verificar-antes-de-actuar). Este
> documento no es asesoría legal; lo legal lo tiene que validar un abogado.

## 1. El criterio

Operar desde EE. UU. con clientes europeos es legal si cada transferencia tiene
base legal (Cap. V) y se cumple el resto del reglamento. Hoy ninguna de las dos
cosas está documentada, y el producto promete más de lo que tiene (sección 5).

Roles, para no mezclar obligaciones: el cliente europeo es **responsable** de
los datos de sus usuarios y CSCloudSolutions es su **encargado** (Art. 28). Los
subencargados (Azure, Paddle, WorkOS, Cloudflare, Gemini…) son encargados de
CSCloudSolutions. Paddle puede ser además responsable propio por ser
*merchant of record*: revisarlo con el abogado.

Aclaración comercial que sigue vigente (de `infra/docs/residencia-de-datos.md`):
algunos compradores empresariales europeos piden residencia en la UE aunque la
ley no la exija. Eso no se resuelve con esta adecuación; ver el apéndice.

## 2. Base legal de cada transferencia

Cadena: cliente UE → CSCloudSolutions (Argentina, acceso del equipo) → servidores
y subencargados en EE. UU.

| Flujo | Destino | Mecanismo candidato | Qué falta |
|---|---|---|---|
| Datos del tenant en Azure (cómputo, MySQL, Redis, Blob, logs) | Microsoft, EE. UU. (West US 2) | EU–US DPF si Microsoft está certificado; si no, SCCs + TIA. El DPA de Microsoft suele incluir SCCs | Verificar la certificación y archivar el DPA aceptado. El repo ya afirma que Microsoft está adherido: no está comprobado |
| Acceso del equipo desde Argentina | Argentina | Decisión de adecuación (Art. 45) | Verificar que sigue vigente; anotarlo en el registro de transferencias |
| Pagos y facturación | Paddle, EE. UU./Reino Unido | DPF o SCCs; Reino Unido tiene su propia decisión de adecuación | Verificar certificación y vigencia; aclarar el rol (¿responsable propio?) |
| SSO | WorkOS, EE. UU. | DPF o SCCs | Verificar; DPA firmado |
| CDN y WAF | Cloudflare, red global, origen en EE. UU. | DPF o SCCs | Ve el tráfico en claro: es subencargado de pleno derecho. Verificar |
| IA (opcional, con clave propia del cliente) | Google Gemini, EE. UU. | DPF o SCCs | Verificar; mantenerlo opt-in y avisado |
| IA de plataforma | Azure OpenAI | Igual que Azure | Hoy **no figura** como inferencia de IA en `SUBPROCESSORS_*.md`. Ver `docs/propuesta-capacidades-ia-2026-10-07.md` §4.5 punto 8 |
| Correo y notificaciones | Microsoft Graph | Igual que Azure | Revisar qué datos del tenant salen por correo |
| Hosting de MySQL | Figura como "MySQL Database Host", sin nombre | — | **Nombrarlo**: un subencargado sin nombre no sirve ante una auditoría. Hoy el MySQL es Azure Database for MySQL, así que probablemente la fila sobra o se fusiona con Azure |
| Fuentes de Google en el navegador | Google, desde el navegador del usuario | Consentimiento o autohospedar | `src/proxy.ts` referencia `fonts.googleapis`: autohospedar las fuentes evita la transferencia |

Si algún subencargado no tiene DPF ni SCCs aplicables, esa fila es un bloqueo:
se reemplaza o se excluye para tenants europeos.

## 3. Trabajo, por prioridad

**P0: papeles que hoy no existen** (no hace falta código; el abogado revisa)

| Artículo | Entregable |
|---|---|
| Art. 30 | Registro de actividades de tratamiento (como encargado: categorías por cliente, transferencias, medidas de seguridad) |
| Art. 35 | DPIA. El producto hace monitoreo sistemático; la actividad por usuario de M365 y Copilot (`M365UsersBoard`, `M365CopilotConfig`, `M365IndexLogs`) es monitoreo de empleados, y en algunos países exige consulta al comité de empresa |
| Arts. 44–46 | Evaluación de impacto de la transferencia (TIA) por cada destino sin adecuación; SCCs archivadas |
| Art. 28 | Revisar el DPA actual (`docs/trust-center/DPA_*.md`) contra el 28(3): instrucciones documentadas, confidencialidad, asistencia al responsable, subencargados con las mismas obligaciones, auditorías |
| Art. 27 | Representante en la UE. Probablemente hace falta (operador en Argentina, sin establecimiento en la UE) |
| Art. 37 | Decidir si hace falta DPO formal; hoy `privacy@cscloudsolutions.com.ar` figura como contacto del DPO |
| Arts. 33–34 | Protocolo de brecha: aviso al responsable sin demora indebida, para que cumpla las 72 h |

**P1: funcionalidades del producto**

1. **Derechos del interesado (Arts. 15–22).** El DPA promete atenderlos por
   correo, pero **no encontré endpoints** de exportación ni de borrado de datos
   personales. Hace falta, por tenant y por usuario: exportar (portabilidad,
   acceso), rectificar, borrar y restringir. El plazo del responsable es un mes
   (Art. 12(3)); CSCloudSolutions tiene que poder asistirlo dentro de ese plazo.
2. **Retención (Arts. 5(1)(e), 25).** `docs/legal-compliance.md` dice
   "Audit Logs (7-year retention)". Justificar esa retención o acortarla donde
   los logs tengan datos personales. Definir la del resto: tickets de soporte y
   adjuntos, snapshots, PITR de 14 días, logs de Log Analytics.
3. **Borrado al terminar el contrato** (DPA §8). El DPA promete "borrado
   criptográfico" en 30 días: **no verifiqué que esté implementado**. Comprobarlo
   o corregir la promesa.
4. **Cookies y consentimiento.** Existe `CookieConsent`; revisar categorías y que
   nada de terceros cargue antes de aceptar.
5. **Minimización en el monitoreo de usuarios de M365.** Evaluar mostrar
   agregados o seudonimizar por defecto, para sostener el DPIA.

**P2: documentación pública que hoy sobre-promete**

- `docs/legal-compliance.md` y la pantalla `/admin/compliance` muestran
  "GDPR ✓". Sin Art. 30, DPIA ni flujo de derechos, ese check no se sostiene
  ante una auditoría: bajarlo a "en curso" hasta cerrar P0 y P1.
- `SUBPROCESSORS_*.md`: nombrar al hosting de MySQL, sumar Azure OpenAI y
  aclarar por qué cada subencargado ve datos del tenant. El cambio de la lista
  exige aviso previo de 30 días a los clientes (`docs/aviso-cambio-subencargado-2026.md`
  es el molde).
- `docs/data-residency.md` describe una selección de región (EU/US/LATAM/APAC)
  como "lógica/declarada". El encabezado ya avisa que está apagada; conviene que
  el cuerpo también diga que hoy no hay residencia real en ninguna región.
- `infra/docs/residencia-de-datos.md`: cuenta 48 tablas (son 144) y su
  "refactor transversal a `resolveTenantPool`" ya no aplica (ver el apéndice).

## 4. Qué reutilizar

DPA (Art. 28), lista de subencargados y aviso de 30 días, `LegalAcceptances`
(aceptación versionada), banner de cookies, exportación del registro de
auditoría (`/admin/compliance`), `DataResidencyChanges`, Key Vault con private
endpoint, TLS, MFA, `requireTenantAccess` y el aislamiento por `tenant_id`
(108 de las 144 tablas llevan esa columna; el conteo sale de una regex sobre las
migraciones, es una heurística). Lo que ya está no hay que rehacerlo, solo
documentarlo en el registro del Art. 30.

## 5. Plan por fases

| Fase | Contenido | Hecho cuando |
|---|---|---|
| **0. Verificación y decisiones** | Sección 6 y 7 | Cada fila de la tabla 2 con certificación o SCCs comprobadas y archivadas |
| **1. Papeles (P0)** | Art. 30, DPIA, TIA, revisión del DPA, representante, protocolo de brecha | Los siete entregables existen y el abogado los revisó |
| **2. Producto (P1)** | Export/borrado por tenant y usuario, retención, borrado al cierre, cookies | Un pedido de acceso y uno de borrado de punta a punta, con tests, sobre un tenant de prueba |
| **3. Documentación pública (P2)** | Corregir lo que sobre-promete; aviso de 30 días de subencargados | Documentos en `en`, `es` y `pt-BR`, PDFs regenerados, aviso enviado |

Antecedentes de este repo que aplican:

- **El push a `main` despliega a producción**: lo que sea documentación en
  `docs/**` y `**.md` no dispara el deploy (`paths-ignore`), pero cualquier
  cambio de `src/` sí.
- **El borrado y la exportación tocan datos reales**: probarlos contra un tenant
  de prueba, nunca contra prod, y recordar que en demo un fetch sin sesión anda
  igual (`demo_oculta_errores_de_sesion`).

## 6. Por verificar antes de actuar

Nada de esto está comprobado:

- **EU–US Data Privacy Framework**: estado actual de la decisión de adecuación
  y de los recursos legales que la cuestionan. Que cada importador esté en la
  lista oficial del DPF (Microsoft, Paddle, WorkOS, Cloudflare, Google).
- **Argentina y Reino Unido**: que sus decisiones de adecuación sigan vigentes.
- **DPAs y SCCs de Microsoft**: qué versión está aceptada hoy para esta
  suscripción y qué cubre (incluida la inferencia de Azure OpenAI).
- **Art. 27**: confirmar con el abogado si aplica y quién puede ser el
  representante.
- **Rol de Paddle**: encargado o responsable.
- **Si hay tenants europeos hoy y qué datos personales guardan** (consulta a la
  base de prod).

## 7. Decisiones abiertas

1. ¿DPO formal o seguimos con un contacto?
2. ¿Quién es el representante en la UE?
3. ¿Qué hacemos si un subencargado no tiene base de transferencia? (¿reemplazo o
   exclusión para tenants europeos?)
4. ¿Gemini queda disponible para tenants europeos con clave propia?
5. ¿Acortamos los 7 años de logs de auditoría?
6. ¿Autohospedamos las fuentes?

## Apéndice: stamp europeo (opcional)

**No es requisito legal.** Se retoma sólo si un cliente o un contrato lo exige.
Lo que ya se sabe, para no repetir el análisis:

- El módulo `infra/terraform/modules/stamp/` ya despliega una celda regional
  completa, y `terraform.tfvars.example:114` trae el bloque `eu` comentado
  (`westeurope`, `10.51.0.0/16`).
- **No hace falta migrar los 369 archivos a `resolveTenantPool`.** Cada stamp
  trae su propia base (`DB_HOST = module.mysql.fqdn`, `modules/stamp/main.tf:342`),
  así que el pool único es correcto dentro de cada stamp. Falta un guard de
  región (`DATA_REGION` no existe en `src/`; hoy `data_region` sólo alimenta un
  atributo OTEL), ruteo por tenant y alta en el stamp correcto.
- **Front Door rutea por país del visitante, no por tenant**: para esto sirve un
  hostname regional (`eu.<dominio>`).
- Hay que decidir región (capacidad de MySQL en la suscripción: ya hubo
  `ProvisionNotSupportedForRegion`), sacar o regionalizar Cloudflare y WorkOS,
  y resolver el webhook de Paddle y las vistas cross-tenant del superadmin.
- Los applies de prod van sólo por CI (`terraform_apply_solo_por_ci`).

Detalle completo, con inventario de flujos y clasificación de las 36 tablas sin
`tenant_id`: `git show 36be2fe:docs/plan-despliegue-europa-gdpr-2026-10-07.md`.
